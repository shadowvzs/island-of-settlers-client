import { type CellRegion, forEachRegionCell } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { createFieldCoverContext, getCoverAcceptance } from "./field-cover";
import { getFieldCropSoilCells } from "./field-cover-exclusions";

/**
 * RG8 per cell (texel centres on the cell centres): R the cover acceptance, G the cultivated soil of crop plots
 * (field-cover-exclusions.ts; the ground draws tilled soil there, softened by the linear filter).
 */
export interface CoverField {
  height: number;
  pixels: Uint8Array;
  width: number;
}

const fullRegion = (world: WorldData): CellRegion => ({
  maxX: world.cellsX - 1,
  maxZ: world.cellsZ - 1,
  minX: 0,
  minZ: 0
});

/** Rebuilds the cover acceptance for a region (the whole map by default). */
export const patchCoverField = (field: CoverField, world: WorldData, requested: CellRegion) => {
  const region = {
    maxX: Math.min(world.cellsX - 1, requested.maxX),
    maxZ: Math.min(world.cellsZ - 1, requested.maxZ),
    minX: Math.max(0, requested.minX),
    minZ: Math.max(0, requested.minZ)
  };
  if (region.minX > region.maxX || region.minZ > region.maxZ) return;
  const context = createFieldCoverContext(world, region);
  const crops = getFieldCropSoilCells(world);
  forEachRegionCell(world, region, (cell, cellX, cellZ) => {
    const acceptance = Math.min(1, Math.max(0, getCoverAcceptance(context, cellX + 0.5, cellZ + 0.5)));
    field.pixels[cell * 2] = Math.round(255 * acceptance);
    field.pixels[cell * 2 + 1] = crops?.has(cell) ? 255 : 0;
  });
};

/** Builds the whole-map cover field as an R8 texture payload. */
export const buildCoverField = (world: WorldData, region: CellRegion = fullRegion(world)): CoverField => {
  const field = {
    height: world.cellsZ,
    pixels: new Uint8Array(world.cellsX * world.cellsZ * 2),
    width: world.cellsX
  };
  patchCoverField(field, world, region);
  return field;
};
