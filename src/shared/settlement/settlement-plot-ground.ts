import { blendTowardMaterial } from "../world/editing/ground-paint";
import { readSplatWeights, writeSplatWeights } from "../world/ground-buffer";
import { markWorldChanged } from "../world/save/world-change-journal";
import { MATERIAL, MATERIAL_COUNT, type WorldData } from "../world/world-data";
import type { SettlementBuilding } from "./settlement-types";

/** A cleared yard is part of the terrain, without a second surface or changes to height/ore. */
export const paintBuildingPlotDirt = (
  world: WorldData, building: Pick<SettlementBuilding, "x" | "z" | "width" | "depth">
) => {
  const weights = new Float32Array(MATERIAL_COUNT);
  const halfWidth = building.width / 2, halfDepth = building.depth / 2;
  const minX = Math.max(0, Math.floor(building.x - halfWidth - 1));
  const minZ = Math.max(0, Math.floor(building.z - halfDepth - 1));
  const maxX = Math.min(world.cellsX, Math.ceil(building.x + halfWidth + 1));
  const maxZ = Math.min(world.cellsZ, Math.ceil(building.z + halfDepth + 1));
  markWorldChanged(world, { maxX, maxZ, minX, minZ });
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    const vertex = z * (world.cellsX + 1) + x;
    if (world.waterDepth[vertex]! > 0) continue;
    const inset = Math.min(halfWidth - Math.abs(x - building.x), halfDepth - Math.abs(z - building.z));
    const cover = Math.max(0, Math.min(1, inset / 0.25));
    if (!cover) continue;
    readSplatWeights(world.splat, vertex, weights);
    blendTowardMaterial(weights, MATERIAL.dirt, cover * cover * (3 - 2 * cover));
    writeSplatWeights(world.splat, vertex, weights);
  }
};
