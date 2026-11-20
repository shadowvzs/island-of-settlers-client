import { DMath } from "../math/deterministic-math";
import { corridorWalkCost, isCorridorStep, riderTiles, routeRevision, standingPointIn } from "./military-long-routes";
import { isLineClear } from "./military-routing";
import {
  createNavigationReads,
  freshNavigationStamp,
  haloRect,
  type NavigationReads,
  withNavigationReads,
  withNavigationSession
} from "./navigation-change-journal";
import { createPathFrontier } from "./settlement-path-frontier";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Flow fields of army moves (military AI mode 2, docs/archive/dated/military-motion-2026-10-13.md section 8):
 * one Dijkstra flood from a group's target over whole tiles (8 neighbours, no corner cutting, the
 * terrain walking cost; riders need a horse's room), bounded to the box round the group and its
 * target. Every tile then knows its next tile towards the target, so a whole army is routed by one
 * search instead of one A* per soldier (a shared group flow field). Soldiers walk to
 * the furthest tile of the next few in a clear straight line, so they move straight across open
 * ground and round walls where needed.
 */
export interface MilitaryFlowField {
  /** Bounds in tiles (the field covers `minX`..`minX + width - 1`, same for z). */
  minX: number;
  minZ: number;
  width: number;
  height: number;
  goal: SettlementPoint;
  mounted: boolean;
  /** Route revision the field was last built or confirmed for. */
  revision: string;
  /** Walking cost to the goal per field cell (Infinity: unreachable). */
  cost: Float64Array;
  /** Field cell of the next tile towards the goal (-1: the goal itself or unreachable). */
  next: Int32Array;
  /** Change journal revision the field is fresh as of (A03 local invalidation). */
  stamp: number;
  /** The build opened the rider tile store (a mounted field with its goal on the field). */
  riderGate: boolean;
  /** Everything the build read, per tile of the box (open cells, rider tiles, walk cost, edges). */
  reads: NavigationReads;
}

/** Tiles of room round the group and its target that the flood covers (detours round lakes). */
const FLOW_MARGIN = 24;
/** Tiles of the flow followed ahead of a soldier when it looks for its next straight stretch. */
const LOOKAHEAD = 10;
/** Tiles skipped between straight-line checks (each check samples the whole line). */
const SIGHT_STRIDE = 3;
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

/** The box (tiles) round `points` widened by `FLOW_MARGIN`, inside the world. */
export const flowBounds = (context: SettlementContext, points: readonly SettlementPoint[]) => {
  const { cellsX, cellsZ } = context.options.world;
  let lowX = Infinity, highX = -Infinity, lowZ = Infinity, highZ = -Infinity;
  for (const point of points) {
    const x = Math.floor(point.x), z = Math.floor(point.z);
    lowX = Math.min(lowX, x); highX = Math.max(highX, x); lowZ = Math.min(lowZ, z); highZ = Math.max(highZ, z);
  }
  const minX = clamp(lowX - FLOW_MARGIN, 0, cellsX - 1), maxX = clamp(highX + FLOW_MARGIN, 0, cellsX - 1);
  const minZ = clamp(lowZ - FLOW_MARGIN, 0, cellsZ - 1), maxZ = clamp(highZ + FLOW_MARGIN, 0, cellsZ - 1);
  return { height: maxZ - minZ + 1, minX, minZ, width: maxX - minX + 1 };
};

/** Field cell of a world point (-1 outside the field). */
const flowCell = (field: MilitaryFlowField, point: SettlementPoint) => {
  const x = Math.floor(point.x) - field.minX, z = Math.floor(point.z) - field.minZ;
  return x < 0 || z < 0 || x >= field.width || z >= field.height ? -1 : z * field.width + x;
};

/** World tile centre of a field cell. */
export const flowCellCentre = (field: MilitaryFlowField, cell: number) =>
  ({ x: field.minX + cell % field.width + .5, z: field.minZ + Math.floor(cell / field.width) + .5 });

/** The tiles a field's answers read: its box and the predicate halo round it. */
export const flowFieldRegion = (context: SettlementContext, bounds: ReturnType<typeof flowBounds>) =>
  haloRect(context, bounds.minX, bounds.minZ, bounds.minX + bounds.width - 1, bounds.minZ + bounds.height - 1);

const floodField = (context: SettlementContext, goal: SettlementPoint, mounted: boolean,
  bounds: ReturnType<typeof flowBounds>, reads: NavigationReads): MilitaryFlowField => {
  const size = bounds.width * bounds.height;
  const field: MilitaryFlowField = { ...bounds, cost: new Float64Array(size).fill(Infinity),
    goal: { ...goal }, mounted, next: new Int32Array(size).fill(-1), reads,
    revision: routeRevision(context), riderGate: false, stamp: reads.stamp };
  const start = flowCell(field, goal);
  if (start < 0) return field;
  field.riderGate = mounted;
  const riders = mounted ? riderTiles(context) : null, frontier = createPathFrontier();
  field.cost[start] = 0;
  frontier.push(start, 0, 0);
  for (let entry = frontier.pop(); entry; entry = frontier.pop()) {
    if (entry.cost !== field.cost[entry.id]) continue;
    const x = entry.id % field.width, z = Math.floor(entry.id / field.width);
    const worldX = x + field.minX, worldZ = z + field.minZ;
    const stepCost = corridorWalkCost(context, worldX, worldZ) / 10;
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= field.width || nz >= field.height) continue;
      if (entry.id !== start && !isCorridorStep(context, worldX + dx, worldZ + dz, -dx, -dz, riders)) continue;
      const neighbour = nz * field.width + nx, total = entry.cost + (dx && dz ? Math.SQRT2 : 1) * stepCost;
      if (field.cost[neighbour]! <= total) continue;
      field.cost[neighbour] = total; field.next[neighbour] = entry.id;
      frontier.push(neighbour, total, total);
    }
  }
  return field;
};

/** The walking cost of every box cell as it is now (the flood reads it per popped tile). */
const snapshotWalkCost = (context: SettlementContext, bounds: ReturnType<typeof flowBounds>, target: Uint8Array) => {
  const { cellsX, walkCost } = context.options.world;
  for (let z = 0; z < bounds.height; z++) {
    const row = (bounds.minZ + z) * cellsX + bounds.minX;
    target.set(walkCost.subarray(row, row + bounds.width), z * bounds.width);
  }
};

/**
 * Floods the field from `goal` (steps reversed: a tile joins when the step from it into the
 * current tile is walkable), cheapest first. The field records every value it read and is fresh
 * as of the oldest cached one among them.
 */
export const buildFlowField = (context: SettlementContext, goal: SettlementPoint, mounted: boolean,
  bounds: ReturnType<typeof flowBounds>): MilitaryFlowField => withNavigationSession(context, () => {
  const stamp = freshNavigationStamp(context, flowFieldRegion(context, bounds));
  const reads = createNavigationReads(stamp, bounds, context.options.world.cellsX);
  const field = withNavigationReads(reads, () => floodField(context, goal, mounted, bounds, reads));
  snapshotWalkCost(context, bounds, reads.walkCost);
  field.stamp = reads.stamp;
  return field;
});

/** Walking cost from `point` to the goal (Infinity off the field). */
export const flowCost = (field: MilitaryFlowField, point: SettlementPoint) => {
  const cell = flowCell(field, point);
  return cell < 0 ? Infinity : field.cost[cell]!;
};

/** The tiles ahead of `cell` along the flow (at most `LOOKAHEAD`, the goal tile last). */
const chainFrom = (field: MilitaryFlowField, cell: number) => {
  const chain: number[] = [];
  for (let next = field.next[cell]!; next >= 0 && chain.length < LOOKAHEAD; next = field.next[next]!) chain.push(next);
  return chain;
};

/** Standing point of a chain tile (the goal itself on the goal tile). */
const chainPoint = (context: SettlementContext, field: MilitaryFlowField, cell: number) => {
  if (field.next[cell] === -1) return { ...field.goal };
  const centre = flowCellCentre(field, cell);
  const worldCell = Math.floor(centre.z) * context.options.world.cellsX + Math.floor(centre.x);
  return standingPointIn(context, worldCell, field.mounted);
};

/**
 * The next point to walk to from `from`: the furthest of the next tiles along the flow that is in
 * a clear straight line (searched from the far end); the neighbouring tile when none is; null off
 * the field.
 */
export const flowWaypoint = (context: SettlementContext, field: MilitaryFlowField, from: SettlementPoint) => {
  const cell = flowCell(field, from);
  if (cell < 0 || field.cost[cell] === Infinity) return null;
  const chain = chainFrom(field, cell);
  if (!chain.length) return { ...field.goal };
  for (let index = chain.length - 1; index > 0; index -= SIGHT_STRIDE) {
    const point = chainPoint(context, field, chain[index]!);
    if (point && isLineClear(context, from, point, field.mounted)) return point;
  }
  // Nothing far ahead in sight: the nearest tile ahead with a standing point (a trunk may fill one).
  for (const cell of chain) {
    const point = chainPoint(context, field, cell);
    if (point) return point;
  }
  return null;
};

/** Flow direction of a field cell (unit vector towards its next tile; zero at the goal or off the field). */
export const flowDirection = (field: MilitaryFlowField, cell: number) => {
  const next = field.next[cell]!;
  if (next < 0) return { x: 0, z: 0 };
  const dx = next % field.width - cell % field.width;
  const dz = Math.floor(next / field.width) - Math.floor(cell / field.width);
  const length = DMath.hypot(dx, dz);
  return { x: dx / length, z: dz / length };
};
