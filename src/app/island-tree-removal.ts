import { refreshCanopyField } from "../render-common/canopy-field";
import type { TerrainRenderer } from "../render-common/renderer-contract";
import { listRegionChunks } from "../render-common/terrain-chunks";
import { removePropsAt } from "../shared/world/editing/prop-removal";
import { explainWorldNavigationChange, propTileRect } from "../shared/world/navigation-change-log";
import { bumpBuildRevision } from "../shared/world/save/world-change-journal";
import { PROP_REMOVED, type WorldData } from "../shared/world/world-data";

/** Harvesting leaves neither a stump nor a tree in saves, canopy shading or placement. */
export const removeHarvestedTree = (world: WorldData, renderer: TerrainRenderer, id: number) => {
  if (world.props.types[id] === PROP_REMOVED) return;
  const x = Math.floor(world.props.x[id]!);
  const z = Math.floor(world.props.z[id]!);
  const region = {
    minX: Math.max(0, x - 3), minZ: Math.max(0, z - 3),
    maxX: Math.min(world.cellsX - 1, x + 3), maxZ: Math.min(world.cellsZ - 1, z + 3)
  };
  // Navigation changes only on the stump's own tile (its walk cost and trunk bucket; journal, A03).
  explainWorldNavigationChange(world, propTileRect(world, id), () => {
    removePropsAt(world, [id]);
    refreshCanopyField(world, region);
    renderer.mapEdit?.removeProps([id], region);
    renderer.mapEdit?.refreshChunks(listRegionChunks(world, region), false);
    bumpBuildRevision(world, null);
  });
  return region;
};
