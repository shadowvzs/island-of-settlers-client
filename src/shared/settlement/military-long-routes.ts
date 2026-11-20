import { DMath } from "../math/deterministic-math";
import { WALK_COST } from "../world/generation/walkability";
import { isOnCompletedBridgeDeck } from "./bridge-deck-navigation";
import { firstCorridorStandingPoint, isBuildingCorridorEdgeClear } from "./building-navigation-corridor";
import type { SavedEntries } from "./military-field-save";
import { type RiderTiles, riderTiles } from "./military-rider-tiles";
import { connectivityRevision, routeRevision } from "./military-route-revision";
import { activeNavigationSession, recordCellOpenRead, withNavigationSession } from "./navigation-change-journal";
import { hasBuildingNavigationNearby } from "./settlement-building-navigation";
import { isMountedNavigationClear, isNavigationClear,isTerrainClear } from "./settlement-navigation";
import { createPathFrontier } from "./settlement-path-frontier";
import { createTransientMap } from "./settlement-transient-state";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

export { type RiderTiles, riderTiles } from "./military-rider-tiles";
export { connectivityRevision, routeRevision } from "./military-route-revision";

/**
 * Longest stretch planned with the fine half-tile search at once. Longer marches follow a coarse
 * whole-tile corridor, walked in legs of this many corridor tiles.
 */
export const MILITARY_LEG_LENGTH = 16;
/** Standing point candidates around a corridor tile centre whose middle holds a trunk or rock. */
const STANDING_OFFSETS = [[0, 0], [.3, 0], [-.3, 0], [0, .3], [0, -.3], [.3, .3], [-.3, -.3], [.3, -.3], [-.3, .3]];
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;

/** Search scratch reused between calls (one island at a time), so long searches allocate nothing. */
let scratch = { cost: new Float64Array(0), parent: new Int32Array(0), stamp: new Uint32Array(0), generation: 0 };
const searchScratch = (cells: number) => {
  if (scratch.cost.length !== cells) scratch = { cost: new Float64Array(cells), parent: new Int32Array(cells),
    stamp: new Uint32Array(cells), generation: 0 };
  scratch.generation++;
  return scratch;
};

/**
 * Walking cost of a whole tile for corridors and flow fields: the terrain cost, or open ground where
 * a completed bridge deck carries the tile centre over a river cell (B08: group orders cross bridges).
 */
export const corridorWalkCost = (context: SettlementContext, x: number, z: number) => {
  const { world } = context.options, cost = world.walkCost[z * world.cellsX + x]!;
  if (cost || !isOnCompletedBridgeDeck(context, { x: x + .5, z: z + .5 })) return cost;
  return WALK_COST.open;
};
const computeCellOpen = (context: SettlementContext, cell: number, x: number, z: number) => {
  if (!corridorWalkCost(context, x, z)) return false;
  const point = { x: x + .5, z: z + .5 };
  return isTerrainClear(context, point) || (hasBuildingNavigationNearby(context, point) &&
    firstCorridorStandingPoint(context, point, false) !== undefined);
};
/**
 * `isCellOpen` answers of the open navigation session (`sessions[cell]` holds the session that wrote
 * `open[cell]`): nothing a predicate reads changes inside one session, so a flood that asks for a
 * tile from each of its neighbours computes it once.
 */
interface CellOpenMemo { open: Uint8Array; sessions: Int32Array }
const cellOpenMemos = createTransientMap<CellOpenMemo>();
const cellOpenMemoOf = (context: SettlementContext) => {
  const { cellsX, cellsZ } = context.options.world;
  const known = cellOpenMemos.get(context);
  if (known?.open.length === cellsX * cellsZ) return known;
  const memo = { open: new Uint8Array(cellsX * cellsZ), sessions: new Int32Array(cellsX * cellsZ) };
  cellOpenMemos.set(context, memo);
  return memo;
};
const sessionCellOpen = (context: SettlementContext, cell: number, x: number, z: number) => {
  const session = activeNavigationSession(context);
  if (!session) return computeCellOpen(context, cell, x, z);
  const memo = cellOpenMemoOf(context);
  if (memo.sessions[cell] === session) return memo.open[cell] === 1;
  const open = computeCellOpen(context, cell, x, z);
  memo.open[cell] = open ? 1 : 0;
  memo.sessions[cell] = session;
  return open;
};
/** A whole tile a corridor may pass: walkable, and its centre (or a standing point beside a building) is clear. */
export const isCellOpen = (context: SettlementContext, x: number, z: number) => {
  const { world } = context.options;
  if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return false;
  const cell = z * world.cellsX + x, open = sessionCellOpen(context, cell, x, z);
  recordCellOpenRead(cell, open);
  return open;
};

/**
 * Passable tile of a corridor. A rider's body reaches about a tile around it, so for riders the
 * tile centre needs a horse's clearance from water, buildings, trunks and rocks (`riders`).
 */
const isCellPassable = (context: SettlementContext, x: number, z: number, riders: RiderTiles | null) => {
  if (!isCellOpen(context, x, z)) return false;
  return !riders || riders.clear(z * context.options.world.cellsX + x);
};

const octile = (dx: number, dz: number) => {
  const ax = Math.abs(dx), az = Math.abs(dz);
  return Math.max(ax, az) + (Math.SQRT2 - 1) * Math.min(ax, az);
};

/** One whole-tile step: into a passable tile, diagonals only past two open side tiles. */
export const isCorridorStep = (context: SettlementContext, x: number, z: number, dx: number, dz: number,
  riders: RiderTiles | null) => {
  const { world } = context.options;
  const nx = x + dx, nz = z + dz;
  if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ) return false;
  if (dx && dz && (!isCellOpen(context, x + dx, z) || !isCellOpen(context, x, z + dz))) return false;
  return isCellPassable(context, nx, nz, riders) && isBuildingCorridorEdgeClear(context,
    { x: x + .5, z: z + .5 }, { x: nx + .5, z: nz + .5 }, riders !== null);
};

const tracePath = (parent: Int32Array, goal: number) => {
  const cells: number[] = [];
  for (let cell = goal; cell >= 0; cell = parent[cell]!) cells.push(cell);
  return cells.reverse();
};

/** Whole-tile A* (8 neighbours, no corner cutting, terrain walking cost); tile indices start to goal. */
const searchCorridorCells = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint,
  mounted: boolean) => withNavigationSession(context, () => searchCorridorCellsIn(context, from, to, mounted));
const searchCorridorCellsIn = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint, mounted: boolean) => {
  const { world } = context.options;
  const width = world.cellsX;
  const start = Math.floor(from.z) * width + Math.floor(from.x);
  const goal = Math.floor(to.z) * width + Math.floor(to.x);
  const goalX = goal % width, goalZ = Math.floor(goal / width);
  const { cost, generation, parent, stamp } = searchScratch(world.cellsX * world.cellsZ);
  const riders = mounted ? riderTiles(context) : null;
  const frontier = createPathFrontier();
  stamp[start] = generation; cost[start] = 0; parent[start] = -1;
  frontier.push(start, 0, octile(goalX - start % width, goalZ - Math.floor(start / width)));
  for (let entry = frontier.pop(); entry; entry = frontier.pop()) {
    const current = entry.id;
    if (entry.cost !== cost[current]) continue;
    if (current === goal) return tracePath(parent, goal);
    const x = current % width, z = Math.floor(current / width);
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx, nz = z + dz, next = nz * width + nx;
      if (nx < 0 || nz < 0 || nx >= width || nz >= world.cellsZ) continue;
      if (next !== goal && !isCorridorStep(context, x, z, dx, dz, riders)) continue;
      const step = (dx && dz ? Math.SQRT2 : 1) * corridorWalkCost(context, nx, nz) / 10;
      const total = entry.cost + step;
      if (stamp[next] === generation && cost[next]! <= total) continue;
      stamp[next] = generation; cost[next] = total; parent[next] = current;
      frontier.push(next, total, total + octile(goalX - nx, goalZ - nz));
    }
  }
  return null;
};

const footCorridorBatches = new WeakMap<SettlementContext, Map<string, number[] | null>>();
/** A synchronous group return shares only static foot corridors; mounted staging stays independent. */
export const withMilitaryFootCorridorBatch = <T>(context: SettlementContext, operation: () => T): T => {
  const previous = footCorridorBatches.get(context);
  footCorridorBatches.set(context, new Map());
  try { return operation(); }
  finally {
    if (previous) footCorridorBatches.set(context, previous);
    else footCorridorBatches.delete(context);
  }
};
const corridorCells = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint, mounted: boolean) => {
  const batch = !mounted && footCorridorBatches.get(context);
  if (!batch) return searchCorridorCells(context, from, to, mounted);
  const width = context.options.world.cellsX;
  const start = Math.floor(from.z) * width + Math.floor(from.x), goal = Math.floor(to.z) * width + Math.floor(to.x);
  const key = `${routeRevision(context)}:${start}/${goal}`;
  const known = batch.get(key);
  if (known !== undefined) return known;
  const cells = searchCorridorCells(context, from, to, false);
  batch.set(key, cells);
  return cells;
};

/** A standing point inside the corridor tile that the fine search (and a rider) accepts. */
export const standingPointIn = (context: SettlementContext, cell: number, mounted: boolean) => {
  const width = context.options.world.cellsX;
  const centre = { x: cell % width + .5, z: Math.floor(cell / width) + .5 };
  for (const [dx, dz] of STANDING_OFFSETS) {
    const point = { x: centre.x + dx!, z: centre.z + dz! };
    if (!isNavigationClear(context, point)) continue;
    if (mounted && !isMountedNavigationClear(context, point)) continue;
    return point;
  }
  return null;
};

/**
 * Standing points along the coarse corridor from `from` to `to`, one per tile after the first
 * (tiles without a clear standing point are left out), ending at `to` itself; null when no corridor
 * connects the two. Soldiers follow them in legs, pulled straight wherever the ground is open.
 */
export const corridorPoints = (context: SettlementContext, from: SettlementPoint,
  to: SettlementPoint, mounted = false): SettlementPoint[] | null => {
  const cells = corridorCells(context, from, to, mounted);
  if (!cells) return null;
  const points = cells.slice(1, -1).flatMap(cell => standingPointIn(context, cell, mounted) ?? []);
  points.push({ x: to.x, z: to.z });
  return points;
};

/** A reverse flood advanced only until the requested start is reached. Shared by the group. */
const corridorFlood = (context: SettlementContext, to: SettlementPoint, mounted: boolean) => {
  const { world } = context.options;
  const width = world.cellsX, height = world.cellsZ;
  // The flood is advanced lazily, possibly over later ticks: it keeps its own epoch's rider tiles.
  const reached = new Uint8Array(width * height), riders = mounted ? riderTiles(context, true) : null;
  const goal = Math.floor(to.z) * width + Math.floor(to.x);
  const queue = [goal];
  let head = 0;
  if (goal >= 0 && goal < reached.length) reached[goal] = 1;
  const contains = (from: SettlementPoint) => {
    const x = Math.floor(from.x), z = Math.floor(from.z);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < width && nz < height && reached[nz * width + nx]) return true;
    }
    return false;
  };
  return (from: SettlementPoint) => withNavigationSession(context, () => {
    if (contains(from)) return true;
    while (head < queue.length) {
      const cell = queue[head++]!, x = cell % width, z = Math.floor(cell / width);
      let changed = false;
      for (const [dx, dz] of NEIGHBOURS) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
        const next = nz * width + nx;
        if (reached[next] || (cell !== goal && !isCorridorStep(context, nx, nz, -dx, -dz, riders))) continue;
        reached[next] = 1; queue.push(next); changed = true;
      }
      if (changed && contains(from)) return true;
    }
    return false;
  });
};

/** One lazy flood per movement type; unused parts of the island are never explored. */
export const createCorridorReach = (context: SettlementContext, to: SettlementPoint) => {
  const floods = new Map<boolean, ReturnType<typeof corridorFlood>>();
  return (from: SettlementPoint, mounted: boolean) => {
    let flood = floods.get(mounted);
    if (!flood) { flood = corridorFlood(context, to, mounted); floods.set(mounted, flood); }
    return flood(from);
  };
};

/** Within this distance of its leg's end a soldier already heads on (no stop between legs). */
const LEG_HANDOFF = 3;

/** `first`..`last`: the corridor points of the leg being walked. */
interface MarchRoute {
  first: number;
  last: number;
  points: SettlementPoint[];
  revision: string;
  target: SettlementPoint;
}
/**
 * The revision is a string of island counters a load restarts, so a route saves only whether it is
 * `stale` (planned before the last connectivity change; an empty one is searched again).
 */
type SavedMarchRoute = Omit<MarchRoute, "revision"> & { stale?: true };
export type MilitaryMarchRoutesSave = SavedEntries<SavedMarchRoute>;
/** Never equal to a real connectivity revision. */
const STALE_REVISION = "stale";
/** A loaded current route: it takes the revision the island has once the whole load is done. */
const LOADED_REVISION = "loaded";
interface MarchMember { goal: SettlementPoint; mounted: boolean; start: SettlementPoint; uid: number }
/** The leg to walk now: its end, and the corridor points leading there (just the target when near). */
export interface MarchLeg { goal: SettlementPoint; via: readonly SettlementPoint[] }

/** Lane shares tried, widest first: where the corridor narrows, the lanes close in on its middle. */
export const LANE_SHARES = [1, .75, .5, .25];

/** A member's own lane beside a corridor point: its offset in the block, narrowed where needed. */
const lanePoint = (context: SettlementContext, point: SettlementPoint, offset: SettlementPoint, mounted: boolean) => {
  for (const share of LANE_SHARES) {
    const moved = { x: point.x + offset.x * share, z: point.z + offset.z * share };
    if (isNavigationClear(context, moved) && (!mounted || isMountedNavigationClear(context, moved))) return moved;
  }
  return point;
};

const nearestIndex = (points: readonly SettlementPoint[], from: SettlementPoint) => {
  const distance = (point: SettlementPoint) => DMath.hypot(point.x - from.x, point.z - from.z);
  return points.reduce((best, point, index) => distance(point) < distance(points[best]!) ? index : best, 0);
};

/** Is `to` within a single leg of `from` (planned directly, without corridor points)? */
export const isSingleLeg = (from: SettlementPoint, to: SettlementPoint) =>
  DMath.hypot(to.x - from.x, to.z - from.z) <= MILITARY_LEG_LENGTH * 1.5;

const newRoute = (target: SettlementPoint, points: SettlementPoint[], revision: string): MarchRoute =>
  ({ first: 0, last: Math.min(MILITARY_LEG_LENGTH, points.length) - 1, points, revision,
    target: { ...target } });

/** Moves the route on to its next leg; false when the leg was its last. */
const advanceLeg = (route: MarchRoute) => {
  if (route.last >= route.points.length - 1) return false;
  route.first = route.last + 1;
  route.last = Math.min(route.last + MILITARY_LEG_LENGTH, route.points.length - 1);
  return true;
};

/**
 * Long marches leg by leg: each soldier keeps its corridor points and plans only the leg ahead,
 * so a whole army ordered across the island spreads its route planning over the march.
 */
export const createMilitaryMarchRoutes = (context: SettlementContext) => {
  const routes = new Map<number, MarchRoute>();
  const routeTo = (uid: number, from: SettlementPoint, target: SettlementPoint, mounted: boolean) => {
    const known = routes.get(uid), revision = connectivityRevision(context);
    if (known && DMath.hypot(known.target.x - target.x, known.target.z - target.z) < .01 &&
      (known.points.length > 0 || known.revision === revision)) return known;
    // An unreachable target is remembered only while connectivity is unchanged, so a new road,
    // decoration or prop can reopen the route.
    const route = newRoute(target, corridorPoints(context, from, target, mounted) ?? [], revision);
    routes.set(uid, route);
    return route;
  };
  return {
    /** The leg to walk now (null: no corridor leads to the target). */
    nextLeg: (actor: SettlementActor, target: SettlementPoint): MarchLeg | null => {
      if (isSingleLeg(actor, target)) { routes.delete(actor.uid); return { goal: target, via: [target] }; }
      const route = routeTo(actor.uid, actor, target, Boolean(actor.mounted));
      if (!route.points.length) return null;
      const end = () => route.points[route.last]!;
      while (DMath.hypot(end().x - actor.x, end().z - actor.z) < LEG_HANDOFF && advanceLeg(route));
      return { goal: end(), via: route.points.slice(route.first, route.last + 1) };
    },
    /**
     * A group ordered together shares one corridor; each soldier follows it shifted by its own
     * place in the block, so side by side they keep their spacing instead of meeting on one line.
     * True when the group marches on such a shared corridor (a long march).
     */
    shareCorridor: (members: readonly MarchMember[], destination: SettlementPoint) => {
      if (members.length < 2) return false;
      const centre = { x: members.reduce((sum, member) => sum + member.start.x, 0) / members.length,
        z: members.reduce((sum, member) => sum + member.start.z, 0) / members.length };
      if (isSingleLeg(centre, destination)) return false;
      const corridor = corridorPoints(context, centre, destination, members.some(member => member.mounted));
      if (!corridor) return false;
      for (const { goal, mounted, start, uid } of members) {
        const offset = { x: goal.x - destination.x, z: goal.z - destination.z };
        const lane = corridor.slice(0, -1).map(point => lanePoint(context, point, offset, mounted));
        // The lane is joined at its point nearest the soldier, never walked back to its beginning.
        const shifted = lane.slice(nearestIndex(lane, start));
        routes.set(uid, newRoute(goal, [...shifted, { x: goal.x, z: goal.z }], connectivityRevision(context)));
      }
      return true;
    },
    /** A leg that cannot be walked is skipped: the march continues with the following one. */
    skipLeg: (uid: number) => {
      const route = routes.get(uid);
      return Boolean(route && advanceLeg(route));
    },
    forget: (uid: number) => routes.delete(uid),
    clear: () => routes.clear(),
    save: (): MilitaryMarchRoutesSave => {
      const revision = connectivityRevision(context);
      return [...routes].map(([uid, { first, last, points, revision: planned, target }]) => [uid, {
        first, last, points: structuredClone(points), target: { ...target },
        ...(planned === revision || planned === LOADED_REVISION ? {} : { stale: true as const }) }]);
    },
    restore: (saved: MilitaryMarchRoutesSave | undefined) => {
      routes.clear();
      for (const [uid, { first, last, points, stale, target }] of saved ?? [])
        routes.set(uid, { first, last, points: structuredClone(points),
          revision: stale ? STALE_REVISION : LOADED_REVISION, target: { ...target } });
    },
    /** After a load (its road and navigation repairs bump revisions): current routes take today's revision. */
    adoptLoadedRevision: () => {
      const revision = connectivityRevision(context);
      for (const route of routes.values()) if (route.revision === LOADED_REVISION) route.revision = revision;
    }
  };
};
