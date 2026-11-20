import { wrapAngle } from "../../render-common/wildlife/nav/nav-steering";
import { DMath } from "../math/deterministic-math";
import { sameMaskBytes } from "../world/mask-bytes";
import type { WorldData } from "../world/world-data";
import { findSeaRoute, refreshSeaMask, trackSeaMaskSource } from "./settlement-sea-navigation";
import { createSeaRouteFailures } from "./settlement-sea-route-failures";
import {
  createShipClearanceMasks, ENVELOPE_REACH, shipHullFitsSea, type ShipObstacle,
shipsOverlap} from "./settlement-ship-clearance";
import { createShipGridCollisionQueries } from "./settlement-ship-grid-collision";
import { SHIP_TURN_RADIUS } from "./settlement-ship-kinematics";
import { findDriftPortal, findTurningPortal, type ShipPortal, turningPortalObstacles } from "./settlement-ship-portal";
import type { SettlementPoint } from "./settlement-types";

/**
 * A course point. Without `yaw` it is an open-water waypoint the helmsman pursues. With `yaw` it is
 * a manoeuvre pose sailed exactly: an arc ahead (or `astern`, turning `curvature` radians per tile
 * sailed, negative astern) ending on this heading, or with `pivot`
 * a slow swing to this heading round the keel point `pivot` tiles ahead of the centre (oars or a
 * spring line). `drift`: a hull that does not fit where it lies (old saves, terrain edits) is eased
 * straight out holding its heading. `settle`: the hull settles exactly onto this point from where its
 * open-water run stopped, before a manoeuvre starting there.
 */
export interface ShipRoutePoint extends SettlementPoint {
  astern?: boolean; curvature?: number; drift?: boolean; pivot?: number; settle?: boolean; yaw?: number;
  /** A first swing's heading at the start (its ease-in), when no leg before it gives one. */
  fromYaw?: number;
}
/**
 * A destination; with `yaw` the hull lines up with that heading (either way) before it stops. A berth
 * in tight water is entered on exactly that heading, or with `eitherWay` bow first from whichever side
 * the ship comes from (its pier works on both).
 */
export interface ShipDestination extends SettlementPoint { eitherWay?: boolean; yaw?: number }
/** Longest straightened leg; keeps the line-of-sight checks cheap on long voyages. */
const MAX_LEG = 24;
const LEG_SAMPLE = .5;
/** A straightened waypoint this close to the exact goal is the goal cell itself. */
const GOAL_CELL = 1.5;
/** Straight final run onto a berth or anchorage, lined up with it (tiles). */
const APPROACH = 6;
/** In narrow water the run may be shorter. */
const APPROACH_LENGTHS = [APPROACH, APPROACH / 2];
/** A berth's other way in is taken while the near one is blocked only when it costs at most this share more. */
const DETOUR_SHARE = 1.3;
/** Tiles per manoeuvre leg in a berth's way in (the manoeuvre search sails one tile per arc). */
const KEEL_STEP_ESTIMATE = 1;
/** Ways out of tight water remembered per berth pose. */
const EXIT_CACHE = 256;
/** Charting tests many coastal poses; retain their tiny point/null proofs without route arrays. */
const PROOF_CACHE = 16_384;
const poseKey = (pose: ShipObstacle) => [pose.x, pose.z, pose.yaw]
  .map(value => Object.is(value, -0) ? "-0" : String(value)).join(",");
const copyPortal = (portal: ShipPortal | null): ShipPortal | null => portal &&
  ({ point: { ...portal.point }, path: portal.path.map(point => ({ ...point })) });
/** Proof that a berth has a way out: open water along the keel, else a short manoeuvre search. */
const PROOF_REACH = 12;
const PROOF_STEP = .5;
const PROOF_EXPANSIONS = 512;
/** The bow-first way in to a berth is searched once per berth; a berth proved by PROOF_EXPANSIONS fits well within. */
const WAY_IN_EXPANSIONS = 2000;

/**
 * Straightens the grid route into legs through turning-clear water (string pulling), so the ship
 * sails diagonals instead of a staircase and only turns where the course really changes.
 */
export const straightenSeaRoute = (from: SettlementPoint, route: readonly SettlementPoint[],
  clear: (from: SettlementPoint, to: SettlementPoint) => boolean) => {
  const legs: SettlementPoint[] = [];
  let anchor = from, index = 0;
  while (index < route.length) {
    let reach = index;
    while (reach + 1 < route.length) {
      const next = route[reach + 1]!;
      if (DMath.hypot(next.x - anchor.x, next.z - anchor.z) > MAX_LEG || !clear(anchor, next)) break;
      reach++;
    }
    anchor = route[reach]!; legs.push(anchor); index = reach + 1;
  }
  return legs;
};

/** Starts of the final run lined up with `to.yaw` (either way when allowed), longest run and nearest end first. */
const approachCandidates = (from: SettlementPoint, to: ShipDestination, bothWays: boolean) =>
  APPROACH_LENGTHS.flatMap(length => (bothWays ? [to.yaw!, to.yaw! + Math.PI] : [to.yaw!])
    .map(yaw => ({ x: to.x - DMath.sin(yaw) * length, z: to.z - DMath.cos(yaw) * length }))
    .sort((a, b) => DMath.hypot(a.x - from.x, a.z - from.z) - DMath.hypot(b.x - from.x, b.z - from.z)));

const neighbours = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

/** Rough cost (tiles) of a change of course: sailed round the turning radius, sharp ones slowly. */
const turnCost = (turn: number) => Math.abs(turn) * SHIP_TURN_RADIUS * (1 + Math.abs(turn));

/** Connected regions of a mask (flood fill, 4-neighbour): region index per cell, -1 outside. */
const labelRegions = (world: WorldData, mask: Uint8Array) => {
  const labels = new Int32Array(mask.length).fill(-1), queue = new Int32Array(mask.length);
  let region = 0;
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || labels[seed]! >= 0) continue;
    let head = 0, tail = 0;
    queue[tail++] = seed; labels[seed] = region;
    while (head < tail) {
      const cell = queue[head++]!, x = cell % world.cellsX, z = (cell - x) / world.cellsX;
      for (const [dx, dz] of neighbours) {
        const nx = x + dx, nz = z + dz, next = nz * world.cellsX + nx;
        if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ || !mask[next] || labels[next]! >= 0) continue;
        labels[next] = region; queue[tail++] = next;
      }
    }
    region++;
  }
  return labels;
};

export const createShipRoutePlanner = (world: WorldData, sea: Uint8Array) => {
  refreshSeaMask(world, sea);
  trackSeaMaskSource(world, sea);
  let revision = world.terrainRevision ?? 0;
  let geometrySea = sea.slice();
  let masks = createShipClearanceMasks(world, sea);
  const staticRoutes = new Map<string, ShipRoutePoint[] | null>();
  const portals = new Map<string, ShipPortal | null>();
  const turningPortals = new Map<string, ShipPortal | null>();
  const failures = createSeaRouteFailures(world);
  const gridCollisions = createShipGridCollisionQueries();
  const refresh = () => {
    const next = world.terrainRevision ?? 0;
    if (next === revision) return false;
    refreshSeaMask(world, sea);
    revision = next;
    // Every geometric sailing test below depends on this mask. Land-only grading cannot change
    // a route or offshore proof when the complete mask is byte-for-byte identical.
    if (sameMaskBytes(geometrySea, sea)) return false;
    geometrySea = sea.slice();
    masks = createShipClearanceMasks(world, sea); revision = next; regions = null;
    exits.clear(); proofs.clear(); staticRoutes.clear(); portals.clear(); turningPortals.clear(); failures.clear(); return true;
  };
  const turnable = (point: SettlementPoint) => point.x >= 0 && point.z >= 0 && point.x < world.cellsX &&
    point.z < world.cellsZ && Boolean(masks.turning[Math.floor(point.z) * world.cellsX + Math.floor(point.x)]);
  /** The pose's envelope overlaps one of the blocked hulls (far ones are skipped cheaply). */
  const hits = (pose: ShipObstacle, blocked: readonly ShipObstacle[]) => blocked.some(other =>
    Math.abs(other.x - pose.x) < ENVELOPE_REACH && Math.abs(other.z - pose.z) < ENVELOPE_REACH &&
    shipsOverlap(pose, other));
  const legClear = (blocked: readonly ShipObstacle[]) => (a: SettlementPoint, b: SettlementPoint) => {
    const yaw = DMath.atan2(b.x - a.x, b.z - a.z);
    const samples = Math.ceil(DMath.hypot(b.x - a.x, b.z - a.z) / LEG_SAMPLE);
    for (let sample = 0; sample <= samples; sample++) {
      const t = samples ? sample / samples : 0;
      const point = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw };
      if (!turnable(point) || hits(point, blocked)) return false;
    }
    return true;
  };
  /** Turning-clear water from `from` to `to`, straightened, ending exactly on `to`. */
  const openWater = (from: SettlementPoint, to: SettlementPoint, blocked: readonly ShipObstacle[]) => {
    if (failures.unreachable(from, to, blocked)) return null;
    const query = gridCollisions.open(world, masks.turning, blocked);
    let cells: SettlementPoint[] | null;
    try {
      cells = findSeaRoute(world, masks.turning, from, to, query.clear,
        reachable => failures.record(from, blocked, reachable), query.clearGrid);
    } finally { query.release(); }
    if (!cells) return null;
    const clear = legClear(blocked), legs: SettlementPoint[] = straightenSeaRoute(from, cells, clear);
    // The goal cell's centre is no waypoint of its own: a last leg ending just short of (or past) the
    // exact goal would read as a sharp bend.
    const last = legs.at(-1), anchor = legs.at(-2) ?? from;
    if (last && DMath.hypot(last.x - to.x, last.z - to.z) < GOAL_CELL && clear(anchor, to)) legs.pop();
    legs.push({ x: to.x, z: to.z });
    return legs;
  };
  /**
   * The open-water course, ending on a straight run lined up with the destination when it has a heading.
   * The run itself is only checked against the shore: ships in it now are under way, and the helm's
   * look-ahead deals with them, while waiting spots are chosen clear of these runs.
   */
  const course = (from: SettlementPoint, to: ShipDestination, blocked: readonly ShipObstacle[], bothWays = true) => {
    if (to.yaw === undefined || DMath.hypot(to.x - from.x, to.z - from.z) < APPROACH * 1.5)
      return openWater(from, to, blocked);
    const clear = legClear([]);
    for (const approach of approachCandidates(from, to, bothWays)) {
      if (!clear(approach, to)) continue;
      const legs = openWater(from, approach, blocked);
      if (legs) return [...legs, { x: to.x, z: to.z }];
    }
    return openWater(from, to, blocked);
  };
  /** Connected turning-clear water, labelled once per terrain revision. */
  let regions: Int32Array | null = null;
  const regionOf = (point: SettlementPoint) => {
    if (!turnable(point)) return -1;
    regions ??= labelRegions(world, masks.turning);
    return regions[Math.floor(point.z) * world.cellsX + Math.floor(point.x)]!;
  };
  /** Both points lie in the same body of turning-clear water (a voyage between them exists). */
  const connected = (a: SettlementPoint, b: SettlementPoint) => {
    refresh();
    const region = regionOf(a);
    return region >= 0 && region === regionOf(b);
  };
  /** Ways out of tight water searched without other ships, per pose (berths are searched again and again). */
  const exits = new Map<string, ShipPortal | null>();
  /** `sternFirst`: the way out of a berth that ships come in by bow first (it is sailed backwards). */
  const wayOut = (pose: ShipObstacle, sternFirst = false) => {
    refresh();
    const key = `${pose.x},${pose.z},${pose.yaw},${sternFirst}`;
    if (!exits.has(key)) {
      if (exits.size >= EXIT_CACHE) exits.delete(exits.keys().next().value!);
      exits.set(key, findTurningPortal({ blocked: [], masks, sea, sternFirst, world }, pose,
        sternFirst ? WAY_IN_EXPANSIONS : undefined));
    }
    return exits.get(key)!;
  };
  /** The cached way out still holds when no ship lies across it or near where it ends. */
  const wayStillClear = (exit: ShipPortal, from: ShipObstacle, blocked: readonly ShipObstacle[]) =>
    [from, ...exit.path].every(point => !hits({ ...point, yaw: point.yaw ?? from.yaw }, blocked));
  const turningPortal = (search: Parameters<typeof findTurningPortal>[0], from: ShipObstacle, maxExpansions?: number) => {
    const nearby = turningPortalObstacles(from, search.blocked);
    const key = `${poseKey(from)}:${Boolean(search.roomy)}:${Boolean(search.sternFirst)}:` +
      `${maxExpansions ?? "default"}:${nearby.map(poseKey).join(";")}`;
    if (turningPortals.has(key)) return copyPortal(turningPortals.get(key)!);
    const found = findTurningPortal({ ...search, blocked: nearby }, from, maxExpansions);
    if (turningPortals.size >= EXIT_CACHE) turningPortals.delete(turningPortals.keys().next().value!);
    turningPortals.set(key, copyPortal(found));
    return found;
  };
  /** The manoeuvre from `from` out to open water, or the drift out of a hull that does not fit. */
  const searchPortal = (from: ShipObstacle, blocked: readonly ShipObstacle[], roomy: boolean) => {
    // Beside a ship lying close (a neighbouring berth), the way out leads to water clear of it for a
    // turn, so the hull never swings its stern into the neighbour's rigging when it comes round.
    const crowded = roomy || (!turnable(from) && blocked.some(other =>
      DMath.hypot(other.x - from.x, other.z - from.z) < ENVELOPE_REACH));
    const search = { blocked, masks, roomy: crowded, sea, world };
    if (!shipHullFitsSea(world, sea, from)) return findDriftPortal(search, from);
    const cached = crowded ? null : wayOut(from);
    if (cached && wayStillClear(cached, from, blocked)) return cached;
    return turningPortal(search, from) ?? (crowded && !roomy ? turningPortal({ ...search, roomy: false }, from)
      : null) ?? findDriftPortal(search, from);
  };
  const portal = (from: ShipObstacle, blocked: readonly ShipObstacle[], roomy: boolean) => {
    // Portal geometry is independent of the voyage goal. Collision shapes are canonical fixed
    // ship envelopes; their ordered exact poses and the requested mode fully specify this query.
    // Search budgets here are fixed by searchPortal/wayOut, never supplied by the caller.
    const key = `${poseKey(from)}:${roomy}:${blocked.map(poseKey).join(";")}`;
    if (portals.has(key)) return copyPortal(portals.get(key)!);
    const result = searchPortal(from, blocked, roomy);
    if (portals.size >= EXIT_CACHE) portals.delete(portals.keys().next().value!);
    // Null means only the identical bounded query returned null; it proves no larger region.
    portals.set(key, copyPortal(result));
    return result;
  };
  /**
   * The way in to a berth in tight water: the berth's own way out, sailed backwards (arcs ahead become
   * arcs astern, swings swing back), after a slow swing in open water onto the heading it starts with.
   */
  const wayIn = (berth: ShipObstacle, exit: ShipPortal): ShipRoutePoint[] => {
    const poses: ShipObstacle[] = [berth, ...exit.path.map(point => ({ ...point, yaw: point.yaw ?? berth.yaw }))];
    const outer = poses.at(-1)!, legs: ShipRoutePoint[] = [{ settle: true, x: outer.x, yaw: outer.yaw, z: outer.z },
      { pivot: 0, x: outer.x, yaw: outer.yaw, z: outer.z }];
    for (let index = poses.length - 1; index > 0; index--) {
      const out = exit.path[index - 1]!, back = poses[index - 1]!, pose = { x: back.x, yaw: back.yaw, z: back.z };
      if (out.pivot !== undefined) legs.push({ ...pose, pivot: out.pivot });
      else legs.push(out.astern ? { ...pose, curvature: out.curvature } : { ...pose, astern: true, curvature: out.curvature });
    }
    return legs;
  };
  /** `roomy`: a jammed ship first manoeuvres to water where it can swing clear of every other ship. */
  const route = (from: ShipObstacle, to: ShipDestination, blocked: readonly ShipObstacle[] = [], roomy = false) => {
    refresh();
    // Anchorage lanes and busy ships' ways out are queried repeatedly at exactly the same poses.
    // Only terrain-only routes qualify; live obstacle routes always run the current search.
    const key = blocked.length ? null : [from.x, from.z, from.yaw, to.x, to.z, to.yaw,
      to.eitherWay, roomy].map(value => Object.is(value, -0) ? "-0" : String(value)).join(":");
    if (key !== null && staticRoutes.has(key)) return staticRoutes.get(key)?.map(point => ({ ...point })) ?? null;
    const path = plannedRoute(from, to, blocked, roomy);
    // A swing first thing eases in from the heading the ship lies on now (no sudden swing).
    if (path?.[0]?.pivot !== undefined) path[0] = { ...path[0], fromYaw: from.yaw };
    if (key !== null) {
      if (staticRoutes.size >= EXIT_CACHE) staticRoutes.delete(staticRoutes.keys().next().value!);
      // A caller owns its returned legs and may edit them; never expose the cached value.
      staticRoutes.set(key, path?.map(point => ({ ...point })) ?? null);
    }
    return path;
  };
  const plannedRoute = (from: ShipObstacle, to: ShipDestination, blocked: readonly ShipObstacle[], roomy: boolean) => {
    const start = portal(from, blocked, roomy);
    if (!start) return null;
    if (turnable(to)) {
      const legs = course(start.point, to, blocked);
      return legs && [...start.path, ...legs] as ShipRoutePoint[];
    }
    if (to.yaw === undefined) return null;
    // Bow first from the side the ship comes from. While a ship lies across that way in (it is
    // usually leaving), the other side is taken only when it is hardly longer: waiting is quicker.
    const [best, other] = (to.eitherWay ? [to.yaw, wrapAngle(to.yaw + Math.PI)] : [to.yaw])
      .map(yaw => ({ x: to.x, yaw, z: to.z }))
      .map(berth => ({ berth, estimate: berthEstimate(start.point, berth) }))
      .filter(option => option.estimate < Infinity).sort((a, b) => a.estimate - b.estimate);
    if (!best) return null;
    const path = berthRoute(start, best.berth, blocked);
    if (path || !other) return path;
    // A ship lying across the way in itself (at a neighbouring berth) stays for its whole load.
    const longWait = !wayInClear(best.berth, blocked);
    return longWait || other.estimate <= best.estimate * DETOUR_SHARE ? berthRoute(start, other.berth, blocked) : null;
  };
  const wayInClear = (berth: ShipObstacle, blocked: readonly ShipObstacle[]) => {
    const exit = wayOut(berth, true);
    return Boolean(exit) && !hits(berth, blocked) && wayStillClear(exit!, berth, blocked);
  };
  /**
   * Rough cost of coming in to a berth (no shore or ships considered): sailing to the start of the
   * lined-up run, turning onto it, the run and the way in.
   */
  const berthEstimate = (from: SettlementPoint, berth: ShipObstacle) => {
    const exit = wayOut(berth, true), outer = exit?.path.at(-1);
    if (!exit || outer?.yaw === undefined) return Infinity;
    const run = { x: exit.point.x - DMath.sin(outer.yaw) * APPROACH, z: exit.point.z - DMath.cos(outer.yaw) * APPROACH };
    const bearing = DMath.atan2(run.x - from.x, run.z - from.z);
    return DMath.hypot(run.x - from.x, run.z - from.z) + turnCost(wrapAngle(outer.yaw - bearing)) + APPROACH +
      exit.path.length * KEEL_STEP_ESTIMATE;
  };
  /** A berth in tight water: sail to where its way out ends, then come in along that way. */
  const berthRoute = (start: ShipPortal, berth: ShipObstacle, blocked: readonly ShipObstacle[]) => {
    const exit = shipHullFitsSea(world, sea, berth) && !hits(berth, blocked) ? wayOut(berth, true) : null;
    if (!exit || !exit.path.length || !wayStillClear(exit, berth, blocked)) return null;
    const outer = exit.path.at(-1)!;
    // Arriving on the heading the way in starts with leaves only a small swing before going in.
    const legs = course(start.point, { x: exit.point.x, yaw: outer.yaw, z: exit.point.z }, blocked, false);
    return legs && [...start.path, ...legs, ...wayIn(berth, exit)] as ShipRoutePoint[];
  };
  /** Cheap proofs that a hull lying at a pose can get out to open water (berth placement asks often). */
  const proofs = new Map<string, SettlementPoint | null>();
  /** Open water straight ahead or astern along the keel, within PROOF_REACH tiles. */
  const keelProof = (pose: ShipObstacle) => {
    for (const direction of [1, -1]) for (let distance = PROOF_STEP; distance <= PROOF_REACH; distance += PROOF_STEP) {
      const point = { x: pose.x + DMath.sin(pose.yaw) * distance * direction, yaw: pose.yaw,
        z: pose.z + DMath.cos(pose.yaw) * distance * direction };
      if (!shipHullFitsSea(world, sea, point)) break;
      if (turnable(point)) return { x: point.x, z: point.z };
    }
    return null;
  };
  /** Where a hull lying at `pose` reaches open water (no other ships considered), or null. */
  const offshore = (pose: ShipObstacle) => {
    refresh();
    if (turnable(pose)) return { x: pose.x, z: pose.z };
    const key = `${pose.x},${pose.z},${pose.yaw}`;
    if (!proofs.has(key)) {
      if (proofs.size >= PROOF_CACHE) proofs.delete(proofs.keys().next().value!);
      const fits = shipHullFitsSea(world, sea, pose);
      proofs.set(key, fits ? keelProof(pose) ??
        findTurningPortal({ blocked: [], masks, sea, sternFirst: true, world }, pose, PROOF_EXPANSIONS)?.point ?? null : null);
    }
    return proofs.get(key)!;
  };
  /**
   * A ship can leave the berth and come back in bow first (on one of its headings) past the ships
   * in `blocked`: the local manoeuvres and the lined-up run only, not a whole voyage.
   */
  const berthAccess = (to: ShipDestination, blocked: readonly ShipObstacle[]) => {
    refresh();
    if (to.yaw === undefined) return false;
    const headings = to.eitherWay ? [to.yaw, wrapAngle(to.yaw + Math.PI)] : [to.yaw];
    const berths = headings.map(yaw => ({ x: to.x, yaw, z: to.z }));
    const leaves = berths.some(berth => Boolean(portal(berth, blocked, false)));
    return leaves && berths.some(berth => {
      const exit = wayOut(berth, true), outer = exit?.path.at(-1);
      if (!exit || outer?.yaw === undefined || !wayStillClear(exit, berth, blocked)) return false;
      return approachCandidates(exit.point, { x: exit.point.x, yaw: outer.yaw, z: exit.point.z }, false)
        .some(approach => legClear(blocked)(approach, exit.point));
    });
  };
  return { berthAccess, connected, get masks() { refresh(); return masks; }, offshore, refresh, route };
};
