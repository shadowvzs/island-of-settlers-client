import { DMath } from "../math/deterministic-math";
import { isStandingBlocker } from "../world/build-class";
import { createPropCellIndex } from "../world/prop-cell-index";
import { PROP, type WorldData } from "../world/world-data";

export const navigationTrunks = new Set<number>([
  PROP.cedarTree,
  PROP.walnutTree,
  PROP.mahoganyTree,
  PROP.hardwoodTree,
  PROP.broadleafTree, PROP.coniferTree, PROP.palmTree, PROP.birchTree, PROP.sapling
]);
const isObstacleType = (type: number) => navigationTrunks.has(type) || type === PROP.largeRock;
/**
 * Trunks and boulders per cell (S12): kept across felling, stump removal and planting through the
 * navigation epoch; felled and removed props stay filed and are filtered out at query time.
 */
const obstacles = createPropCellIndex(isObstacleType);

export const navigationPropRadius = (world: WorldData, index: number) => {
  const scale = world.props.scale[index]!;
  return Math.min(1.2, world.props.types[index] === PROP.largeRock ? .25 + scale * .25 : .14 + scale * .16);
};

/**
 * Calls `visit` for every standing trunk and boulder in the cells `minX..maxX` × `minZ..maxZ`
 * (clamped to the world), cell by cell in index order; true once `visit` returns true.
 */
export const someObstacleInCells = (world: WorldData, minX: number, minZ: number, maxX: number, maxZ: number,
  visit: (index: number) => boolean) =>
  obstacles.someInRect(world, { maxX, maxZ, minX, minZ }, index =>
    isObstacleType(world.props.types[index]!) && isStandingBlocker(world, index) && visit(index));

/** The same within `reach` whole cells of the cell (`cellX`, `cellZ`). */
export const someObstacleNear = (world: WorldData, cellX: number, cellZ: number, reach: number,
  visit: (index: number) => boolean) =>
  someObstacleInCells(world, cellX - reach, cellZ - reach, cellX + reach, cellZ + reach, visit);

/** World-only geometry is shared by base camp placement and the actor navigation overlay. */
export const isBaseWorldNavigationClear = (world: WorldData, x: number, z: number, radius: number) => {
  if (x - radius < .12 || z - radius < .12 || x + radius >= world.cellsX - .12 || z + radius >= world.cellsZ - .12)
    return false;
  for (let nz = Math.floor(z - radius); nz <= Math.floor(z + radius); nz++)
    for (let nx = Math.floor(x - radius); nx <= Math.floor(x + radius); nx++) {
      const px = Math.max(nx, Math.min(nx + 1, x)), pz = Math.max(nz, Math.min(nz + 1, z));
      if ((px - x) * (px - x) + (pz - z) * (pz - z) > radius * radius) continue;
      if (!world.walkCost[nz * world.cellsX + nx]) return false;
    }
  return !someObstacleNear(world, Math.floor(x), Math.floor(z), Math.ceil(1.2 + radius), id =>
    DMath.hypot(x - world.props.x[id]!, z - world.props.z[id]!) < navigationPropRadius(world, id) + radius);
};
