import { DMath } from "../math/deterministic-math";
import {
  buildingNavigationCells, isLegacyNavigationBuilding, searchBuildingVolumes
} from "./settlement-building-navigation";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * Building geometry of the horse clearance fast path (`mounted-clearance-fast-path.ts`), all inside one open
 * navigation search: every volume a building query tests as a padded world box, and which occupied tiles
 * the yard rule accepts at every point.
 */
/** Absorbs rounding of the box transforms and of the footprint's ring probes (DMath is last-bit exact). */
export const CLEARANCE_MARGIN = 1e-4;

type SearchVolumes = NonNullable<ReturnType<typeof searchBuildingVolumes>>;
const addBox = (boxes: number[], minX: number, minZ: number, maxX: number, maxZ: number) => {
  boxes.push(minX - CLEARANCE_MARGIN, minZ - CLEARANCE_MARGIN, maxX + CLEARANCE_MARGIN, maxZ + CLEARANCE_MARGIN);
};
/** World box of a building-local box (the building turns by quarter turns: local = R(world - centre)). */
const addLocalBox = (boxes: number[], building: SettlementBuilding, geometry: SearchVolumes,
  local: readonly [number, number, number, number]) => {
  const { cosine, sine } = geometry;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const lx of [local[0], local[2]]) for (const lz of [local[1], local[3]]) {
    const x = lx * cosine + lz * sine, z = lz * cosine - lx * sine;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  addBox(boxes, building.x + minX, building.z + minZ, building.x + maxX, building.z + maxZ);
};
/**
 * Padded boxes round every volume the open search tests for `building` (its plot for a site under
 * construction): minX, minZ, maxX, maxZ per box. A volume (box or ellipse) lies inside its box, and its
 * clearance is the distance to the volume or more, so a point outside a box clears that volume.
 */
export const buildingClearanceBoxes = (context: SettlementContext, building: SettlementBuilding) => {
  const boxes: number[] = [];
  // A legacy compound refuses a point only on an occupied cell, which the yard checks cover.
  if (isLegacyNavigationBuilding(building)) return boxes;
  if (building.construction < 1) {
    addBox(boxes, building.x - building.width / 2, building.z - building.depth / 2,
      building.x + building.width / 2, building.z + building.depth / 2);
    return boxes;
  }
  const geometry = searchBuildingVolumes(context, building)!;
  for (const volume of geometry.volumes) {
    const cx = (volume.min[0] + volume.max[0]) / 2, cz = (volume.min[2] + volume.max[2]) / 2;
    const rx = (volume.max[0] - volume.min[0]) / 2, rz = (volume.max[2] - volume.min[2]) / 2;
    const cosine = Math.abs(DMath.cos(volume.yaw ?? 0)), sine = Math.abs(DMath.sin(volume.yaw ?? 0));
    const ex = rx * cosine + rz * sine, ez = rx * sine + rz * cosine;
    addLocalBox(boxes, building, geometry, [cx - ex, cz - ez, cx + ex, cz + ez]);
  }
  return boxes;
};

/** The boxes some point of the rectangle comes within `reach` of (the others never refuse one there). */
export const boxesNear = (boxLists: readonly (readonly number[])[], minX: number, minZ: number, maxX: number,
  maxZ: number, reach: number) => {
  const near: number[] = [];
  for (const boxes of boxLists) for (let index = 0; index < boxes.length; index += 4) {
    if (boxes[index]! - maxX >= reach || minX - boxes[index + 2]! >= reach ||
      boxes[index + 1]! - maxZ >= reach || minZ - boxes[index + 3]! >= reach) continue;
    near.push(boxes[index]!, boxes[index + 1]!, boxes[index + 2]!, boxes[index + 3]!);
  }
  return near;
};

/**
 * Every point of tile (x, z) lies inside the plot of `building` (`inPlot`: strictly inside). Plots are
 * whole tiles, so their edges are integers and the comparison is exact; the low edge itself is outside.
 */
const plotClaimsTile = (building: SettlementBuilding, x: number, z: number) => {
  const minX = building.x - building.width / 2, maxX = building.x + building.width / 2;
  const minZ = building.z - building.depth / 2, maxZ = building.z + building.depth / 2;
  return Number.isInteger(minX) && Number.isInteger(maxX) && Number.isInteger(minZ) && Number.isInteger(maxZ) &&
    x >= minX + 1 && x + 1 <= maxX && z >= minZ + 1 && z + 1 <= maxZ;
};
/** No point of occupied tile (x, z) is refused by the yard rule: a plot claims it, no legacy mask covers it. */
export const isOccupiedTileClaimed = (context: SettlementContext, x: number, z: number) => {
  const nearby = buildingNavigationCells(context).get(z * context.options.world.cellsX + x) ?? [];
  return !nearby.some(isLegacyNavigationBuilding) && nearby.some(building => plotClaimsTile(building, x, z));
};
