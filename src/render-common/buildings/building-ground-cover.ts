import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingNavigationVolume } from "./building-navigation-types";

/**
 * Ground-cover footprint of building solids: every cell whose square a grounded volume touches
 * (plus a small margin for leaning grass) stays bare. Sampling cell corners is not enough: small
 * crates, barrels, posts and stock pieces can sit in the middle of a cell edge and slip between
 * the samples, and building-owned props may overhang the nominal plot entirely.
 */
export const BUILDING_GROUND_COVER_MARGIN = .2;

export interface GroundCoverOrigin {
  /** Building rotation in quarter turns (0-3). */
  rotation: number;
  x: number;
  z: number;
}

interface WorldRectangle {
  centerX: number;
  centerZ: number;
  /** Half extents along the rectangle's own axes. */
  halfX: number;
  halfZ: number;
  /** World-space axes of the rectangle's local x and z. */
  axisX: [number, number];
  axisZ: [number, number];
}

const worldRectangle = (
  volume: BuildingNavigationVolume, origin: GroundCoverOrigin, margin: number
): WorldRectangle => {
  const yaw = volume.yaw ?? 0, yawCos = DMath.cos(yaw), yawSin = DMath.sin(yaw);
  // The volume's own x/z axes in the building's local frame (same yaw convention as
  // buildingVolumeClearance: local = R(+yaw) * delta).
  const localAxisX: [number, number] = [yawCos, -yawSin];
  const localAxisZ: [number, number] = [yawSin, yawCos];
  const angle = origin.rotation * Math.PI / 2, cos = DMath.cos(angle), sin = DMath.sin(angle);
  const toWorld = ([x, z]: [number, number]): [number, number] => [cos * x + sin * z, -sin * x + cos * z];
  const centerLocalX = (volume.min[0] + volume.max[0]) / 2;
  const centerLocalZ = (volume.min[2] + volume.max[2]) / 2;
  return {
    axisX: toWorld(localAxisX),
    axisZ: toWorld(localAxisZ),
    centerX: origin.x + cos * centerLocalX + sin * centerLocalZ,
    centerZ: origin.z - sin * centerLocalX + cos * centerLocalZ,
    halfX: (volume.max[0] - volume.min[0]) / 2 + margin,
    halfZ: (volume.max[2] - volume.min[2]) / 2 + margin
  };
};

/**
 * Separating-axis test of an axis-aligned unit cell square against the (possibly yawed) rectangle.
 * Rectangles also bound ellipses conservatively: a round prop can only clear fewer corner cells.
 */
const rectangleTouchesCell = (rectangle: WorldRectangle, cellX: number, cellZ: number) => {
  const { axisX, axisZ, centerX, centerZ, halfX, halfZ } = rectangle;
  const dx = cellX + .5 - centerX, dz = cellZ + .5 - centerZ, cellHalf = .5;
  const axisXRadius = halfX * Math.abs(axisX[0]) + halfZ * Math.abs(axisZ[0]);
  const axisZRadius = halfX * Math.abs(axisX[1]) + halfZ * Math.abs(axisZ[1]);
  if (Math.abs(dx) > cellHalf + axisXRadius) return false;
  if (Math.abs(dz) > cellHalf + axisZRadius) return false;
  const alongX = Math.abs(dx * axisX[0] + dz * axisX[1]);
  const alongZ = Math.abs(dx * axisZ[0] + dz * axisZ[1]);
  const projectedCellX = cellHalf * (Math.abs(axisX[0]) + Math.abs(axisX[1]));
  const projectedCellZ = cellHalf * (Math.abs(axisZ[0]) + Math.abs(axisZ[1]));
  return alongX <= projectedCellX + halfX && alongZ <= projectedCellZ + halfZ;
};

/**
 * Cells the volumes keep free of field cover, in world cell indices. The scan follows each
 * volume's own world bounds, so props overhanging the nominal plot are included, while a plot's
 * empty exterior pockets stay uncovered and keep their grass.
 */
export const groundCoverCellsForVolumes = (
  volumes: readonly BuildingNavigationVolume[],
  origin: GroundCoverOrigin,
  cellsX: number,
  cellsZ: number,
  margin = BUILDING_GROUND_COVER_MARGIN
) => {
  const cells = new Set<number>();
  for (const volume of volumes) {
    if (!volume.min.every(Number.isFinite) || !volume.max.every(Number.isFinite)) continue;
    const rectangle = worldRectangle(volume, origin, margin);
    const { axisX, axisZ, centerX, centerZ, halfX, halfZ } = rectangle;
    const extentX = halfX * Math.abs(axisX[0]) + halfZ * Math.abs(axisZ[0]);
    const extentZ = halfX * Math.abs(axisX[1]) + halfZ * Math.abs(axisZ[1]);
    const minX = Math.max(0, Math.floor(centerX - extentX));
    const maxX = Math.min(cellsX - 1, Math.floor(centerX + extentX));
    const minZ = Math.max(0, Math.floor(centerZ - extentZ));
    const maxZ = Math.min(cellsZ - 1, Math.floor(centerZ + extentZ));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      if (rectangleTouchesCell(rectangle, x, z)) cells.add(z * cellsX + x);
    }
  }
  return [...cells];
};
