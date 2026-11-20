import { TERRAIN_GROUND_VARIANTS, type TerrainGroundVariant } from "@shared/catalog";

import { MATERIAL_COUNT } from "./world-data";

/**
 * Render-only ground variants (GROUND-PALETTE step 2): photo tiles laid over the splat ground by a per-pixel
 * mask; no splat channel and no gameplay rule reads them. The map editor paints them into `groundVariants`
 * (one byte per variant per vertex) as tile choices numbered after the splat materials. The first four have their
 * own photo tile (GROUND_VARIANT_TILE_IDS); tilled garden soil (step 6) furrows the island's dirt tile.
 * The ids are content data (`TERRAIN_GROUND_VARIANTS`, shared with the nation terrain affinity).
 */
const TILLED_SOIL_ID = "tilled-soil";
type GroundVariantTileId = Exclude<TerrainGroundVariant, typeof TILLED_SOIL_ID>;

export const GROUND_VARIANT_TILE_IDS: readonly GroundVariantTileId[] =
  TERRAIN_GROUND_VARIANTS.filter((id): id is GroundVariantTileId => id !== TILLED_SOIL_ID);
export const GROUND_VARIANT_TILE_COUNT = GROUND_VARIANT_TILE_IDS.length;
export const GROUND_VARIANT_IDS = TERRAIN_GROUND_VARIANTS;
export const GROUND_VARIANT_COUNT = GROUND_VARIANT_IDS.length;
/** Paint channel of the tilled garden soil. */
export const TILLED_SOIL_VARIANT = GROUND_VARIANT_IDS.indexOf(TILLED_SOIL_ID);
/**
 * Render-only crown litter tiles (GROUND-PALETTE steps 3–4), laid by the trees' litter field only (no editor
 * paint, no save data); their array layers follow the variants'.
 */
export const GROUND_LITTER_IDS = ["pine-needles", "leaf-litter"] as const;
export const GROUND_LITTER_COUNT = GROUND_LITTER_IDS.length;
/**
 * Render-only detail tiles laid by the climate masks (GROUND-PALETTE step 5: basalt on the basalt rock palette;
 * step 6: rounded pebbles of river beds, banks, fall pools and stony shores); no editor paint, no save data; their
 * array layers follow the litter's.
 */
export const GROUND_DETAIL_IDS = ["basalt", "river-pebbles"] as const;
export const GROUND_DETAIL_COUNT = GROUND_DETAIL_IDS.length;

/** Editor tile value of a variant (after the splat materials) and back. */
export const toGroundVariantTile = (variant: number) => MATERIAL_COUNT + variant;
export const getGroundVariantOfTile = (tile: number) => (tile >= MATERIAL_COUNT ? tile - MATERIAL_COUNT : -1);
