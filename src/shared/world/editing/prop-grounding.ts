import { getWaterlineFoot, LILY_FLOAT } from "../generation/water-plants";
import { type CellRegion,isRegionEmpty, sampleBilinear, sampleSmooth } from "../grid-geometry";
import { PROP, PROP_REMOVED, type WorldData } from "../world-data";

/** Re-anchor existing props only: never erase invalid habitat or change identity/appearance.
 * Cubic terrain sampling uses a two-vertex halo; changed cell regions include their far vertices.
 * Current stamp boulders use the same zero-offset smooth-ground anchor.
 */
export const reanchorPropsAfterTerrainEdit = (world: WorldData, cells: CellRegion, only?: ReadonlySet<number>): number[] => {
  if (isRegionEmpty(cells)) return [];
  const moved: number[] = [], props = world.props;
  const minX = Math.max(0, cells.minX - 2), maxX = Math.min(world.cellsX, cells.maxX + 3);
  const minZ = Math.max(0, cells.minZ - 2), maxZ = Math.min(world.cellsZ, cells.maxZ + 3);
  // Only candidate metadata is scanned; terrain/water interpolation and writes stay in the dirty halo.
  for (let id = 0; id < props.count; id++) {
    if (props.types[id] === PROP_REMOVED || only && !only.has(id)) continue;
    const x = props.x[id]!, z = props.z[id]!;
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
    const ground = sampleSmooth(world, world.heights, x, z);
    const kind = props.types[id];
    let y = ground;
    if (kind === PROP.waterLily) y = Math.max(ground, sampleBilinear(world, world.waterSurface, x, z)) + LILY_FLOAT;
    if (kind === PROP.reeds || kind === PROP.cattail)
      y = getWaterlineFoot(ground, sampleBilinear(world, world.waterSurface, x, z));
    if (!Number.isFinite(y) || Math.abs(props.y[id]! - y) < .00001) continue;
    props.y[id] = y; moved.push(id);
  }
  return moved;
};
