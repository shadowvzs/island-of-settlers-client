import { DMath } from "../math/deterministic-math";
import { BLOCKING, type WorldData } from "../world/world-data";
import type { BoatWaterClasses } from "./boat-fishing-water";
import { boatWaterDepth } from "./boat-fishing-water";
import { isInBridgeFootprint } from "./bridge-masonry";
import {
  BOAT_FOUR_NEIGHBOURS, BOAT_MASK_JOIN_REACH, BOAT_NET_DRY_CENTRE_REACH, BOAT_NET_MAX_ROW, BOAT_NET_MIN_DEPTH,
  BOAT_NET_MIN_ROW, BOAT_NET_SPACING, BOAT_SITE_NETS
} from "./constants";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

const centreOf = (world: WorldData, cell: number): SettlementPoint =>
  ({ x: cell % world.cellsX + .5, z: Math.floor(cell / world.cellsX) + .5 });

/** The skiff-clear cell of `component` nearest to `point`, within the join reach. */
export const nearestClearCell = (world: WorldData, classes: BoatWaterClasses, point: SettlementPoint) => {
  const cellX = Math.floor(point.x), cellZ = Math.floor(point.z);
  const own = classes.component[cellZ * world.cellsX + cellX] ?? -1;
  let best = -1, bestDistance = Infinity;
  for (let dz = -BOAT_MASK_JOIN_REACH; dz <= BOAT_MASK_JOIN_REACH; dz++)
    for (let dx = -BOAT_MASK_JOIN_REACH; dx <= BOAT_MASK_JOIN_REACH; dx++) {
      const x = cellX + dx, z = cellZ + dz;
      if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) continue;
      const cell = z * world.cellsX + x;
      if (!classes.clear[cell] || classes.component[cell] !== own) continue;
      const distance = DMath.hypot(x + .5 - point.x, z + .5 - point.z);
      if (distance < bestDistance) { best = cell; bestDistance = distance; }
    }
  return best;
};

/** Breadth-first rowing steps over skiff-clear cells, up to the longest net row. */
const rowingSteps = (world: WorldData, classes: BoatWaterClasses, start: number) => {
  const steps = new Map<number, number>([[start, 0]]), queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!, step = steps.get(cell)!;
    if (step >= BOAT_NET_MAX_ROW) continue;
    const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    for (const [dx, dz] of BOAT_FOUR_NEIGHBOURS) {
      const nx = x + dx, nz = z + dz, next = nz * world.cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ) continue;
      if (!classes.clear[next] || steps.has(next)) continue;
      steps.set(next, step + 1);
      queue.push(next);
    }
  }
  return steps;
};

const isOpenWater = (world: WorldData, centre: SettlementPoint) => {
  const reach = Math.ceil(BOAT_NET_DRY_CENTRE_REACH);
  const cellX = Math.floor(centre.x), cellZ = Math.floor(centre.z);
  for (let z = cellZ - reach; z <= cellZ + reach; z++) for (let x = cellX - reach; x <= cellX + reach; x++) {
    if (DMath.hypot(x + .5 - centre.x, z + .5 - centre.z) > BOAT_NET_DRY_CENTRE_REACH) continue;
    if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return false;
    if (world.blocking[z * world.cellsX + x] !== BLOCKING.water) return false;
  }
  return true;
};

const isFreeOfStructures = (context: SettlementContext, centre: SettlementPoint) => {
  const { world } = context.options;
  const cell = Math.floor(centre.z) * world.cellsX + Math.floor(centre.x);
  return !context.occupied[cell] && !isInBridgeFootprint(context, centre);
};

const isSpaced = (point: SettlementPoint, others: readonly SettlementPoint[]) =>
  others.every(other => DMath.hypot(other.x - point.x, other.z - point.z) >= BOAT_NET_SPACING);

/**
 * Up to four net points rowed to from `launch` (FISHER-BOAT §1.2 rule 3): deep, open water of the
 * launch's own component, 3–8 rowing tiles out, clear of structures, spaced from `reserved` nets.
 */
export const findBoatNetPoints = (
  context: SettlementContext,
  classes: BoatWaterClasses,
  launch: SettlementPoint,
  reserved: readonly SettlementPoint[] = []
) => {
  const { world } = context.options;
  const start = nearestClearCell(world, classes, launch);
  if (start < 0) return [];
  const candidates = [...rowingSteps(world, classes, start)]
    .filter(([, step]) => step >= BOAT_NET_MIN_ROW)
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const nets: SettlementPoint[] = [];
  for (const [cell] of candidates) {
    if (nets.length >= BOAT_SITE_NETS) break;
    const centre = centreOf(world, cell);
    if (!isSpaced(centre, nets) || !isSpaced(centre, reserved)) continue;
    if (boatWaterDepth(world, centre.x, centre.z) < BOAT_NET_MIN_DEPTH) continue;
    if (!isOpenWater(world, centre) || !isFreeOfStructures(context, centre)) continue;
    nets.push(centre);
  }
  return nets;
};
