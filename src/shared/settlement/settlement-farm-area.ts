import { DMath } from "../math/deterministic-math";
import type { WorldData } from "../world/world-data";
import type { SettlementBuilding, SettlementPoint } from "./settlement-types";

/** Integer cell bounds, inclusive on all four sides. */
export interface FarmAreaBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}
export interface FarmArea extends FarmAreaBounds {
  custom: boolean;
}
// Rounded reduced range requested by the owner on 2026-10-11.
export const DEFAULT_FARM_RADIUS = 8;
const MAX_FARM_RADIUS = DEFAULT_FARM_RADIUS;
export const defaultWorkArea = (
  world: WorldData,
  origin: SettlementPoint,
  radius: number
): FarmArea => ({
  minX: Math.max(0, Math.floor(origin.x - radius)),
  minZ: Math.max(0, Math.floor(origin.z - radius)),
  maxX: Math.min(world.cellsX - 1, Math.ceil(origin.x + radius) - 1),
  maxZ: Math.min(world.cellsZ - 1, Math.ceil(origin.z + radius) - 1),
  custom: false
});
export const defaultFarmArea = (world: WorldData, building: SettlementBuilding) =>
  defaultWorkArea(world, building.access ?? building, DEFAULT_FARM_RADIUS);
export const validWorkAreaBounds = (
  world: WorldData,
  origin: SettlementPoint,
  bounds: FarmAreaBounds,
  radius: number
) => {
  const values = [bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ];
  if (
    values.some((value) => !Number.isSafeInteger(value)) ||
    bounds.minX > bounds.maxX ||
    bounds.minZ > bounds.maxZ ||
    bounds.minX < 0 ||
    bounds.minZ < 0 ||
    bounds.maxX >= world.cellsX ||
    bounds.maxZ >= world.cellsZ
  )
    return false;
  return [bounds.minX, bounds.maxX].every((x) =>
    [bounds.minZ, bounds.maxZ].every(
      (z) => DMath.hypot(x + 0.5 - origin.x, z + 0.5 - origin.z) <= radius
    )
  );
};
export const inFarmRange = (building: SettlementBuilding, point: SettlementPoint) =>
  DMath.hypot(
    point.x - (building.access ?? building).x,
    point.z - (building.access ?? building).z
  ) <= MAX_FARM_RADIUS;
export const inFarmArea = (bounds: FarmAreaBounds, point: SettlementPoint) => {
  const x = Math.floor(point.x),
    z = Math.floor(point.z);
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
};
