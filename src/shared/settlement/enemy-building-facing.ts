import { DMath } from "../math/deterministic-math";
import type { WorldData } from "../world/world-data";
import type { SettlementPoint } from "./settlement-types";

const QUARTER_TURNS = [0, 1, 2, 3] as const;
/**
 * Facing ranks (slices of `turnsFacing`) tried per search pass: the best turn on every candidate
 * plot first, then the three others only when no plot allows the best one.
 */
export const FACING_PASSES = [[0, 1], [1, 4]] as const;

/** Mean position of every walkable cell centre: the island's centre point. */
export const islandCentre = (world: WorldData): SettlementPoint => {
  let sumX = 0, sumZ = 0, count = 0;
  for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++) {
    if (!world.walkCost[z * world.cellsX + x]) continue;
    sumX += x + .5; sumZ += z + .5; count++;
  }
  if (!count) return { x: world.cellsX / 2, z: world.cellsZ / 2 };
  return { x: sumX / count, z: sumZ / count };
};

/** World direction of a building's front (door side) after `turns` quarter turns. */
export const doorDirection = (turns: number): SettlementPoint => {
  const angle = turns * Math.PI / 2;
  return { x: DMath.sin(angle), z: DMath.cos(angle) };
};

/** Angle (radians) between a building's front and the direction from `from` to `target`. */
export const doorAngleTo = (turns: number, from: SettlementPoint, target: SettlementPoint) => {
  const door = doorDirection(turns);
  const bearing = DMath.atan2(target.x - from.x, target.z - from.z);
  const facing = DMath.atan2(door.x, door.z);
  const difference = Math.abs(bearing - facing) % (Math.PI * 2);
  return difference > Math.PI ? Math.PI * 2 - difference : difference;
};

/** Quarter turns, the door closest to facing `target` first (ties keep the lower turn). */
export const turnsFacing = (from: SettlementPoint, target: SettlementPoint): number[] =>
  QUARTER_TURNS.map(turns => ({ angle: doorAngleTo(turns, from, target), turns }))
    .sort((first, second) => first.angle - second.angle || first.turns - second.turns)
    .map(entry => entry.turns);
