import { refreshMineVertexField } from "../../render-common/mine-field";
import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { listRegionChunks } from "../../render-common/terrain-chunks";
import type { CellRegion } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";

/** Discovery and depletion update the cached ground ore field as well as gameplay state. */
export const createIslandMineHooks = (world: WorldData, renderer: Pick<TerrainRenderer, "mapEdit">) => {
  const refresh = (cells: CellRegion) => {
    refreshMineVertexField(world, cells);
    renderer.mapEdit?.refreshChunks(listRegionChunks(world, cells), true);
  };
  return {
    onSurveyDeposit: (zoneId: number) => {
      const cells = { minX: world.cellsX, minZ: world.cellsZ, maxX: -1, maxZ: -1 };
      for (let cell = 0; cell < world.mineZone.length; cell++) {
        if (world.mineZone[cell] !== zoneId) continue;
        const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
        cells.minX = Math.min(cells.minX, x); cells.maxX = Math.max(cells.maxX, x);
        cells.minZ = Math.min(cells.minZ, z); cells.maxZ = Math.max(cells.maxZ, z);
      }
      if (cells.maxX >= 0) refresh({ minX: Math.max(0, cells.minX - 2), minZ: Math.max(0, cells.minZ - 2),
        maxX: Math.min(world.cellsX - 1, cells.maxX + 2), maxZ: Math.min(world.cellsZ - 1, cells.maxZ + 2) });
    },
    onOreChanged: (cell: number) => {
      const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
      refresh({ minX: Math.max(0, x - 2), minZ: Math.max(0, z - 2),
        maxX: Math.min(world.cellsX - 1, x + 2), maxZ: Math.min(world.cellsZ - 1, z + 2) });
    }
  };
};
