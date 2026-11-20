import { VERGE_FOLIAGE_TILES } from "../../src/render-common/road-verges/verge-foliage-atlas-layout";
import { bakeFoliageAtlas } from "./climber-foliage/atlas-bake";
import { type Linear, linearOf, writeFoliagePreviews } from "./climber-foliage/atlas-preview";
import { previewDirectory, writeFoliageAtlas } from "./climber-foliage/atlas-writer";
import { VERGE_TILE_RECIPES } from "./verge-foliage/verge-tiles";

/**
 * Offline bake of the original road-verge foliage atlas (card V-R02a): plantain, dandelion,
 * red clover, meadow grass, ox-eye daisy and yarrow parts plus their Minimal whole-plant cards.
 * Same pipeline and channel contract as the climber atlas (D04a).
 *
 * Usage (from island-of-settlers-client): npm run verge-foliage-atlas [-- --preview <dir>]
 */
const LEAF = linearOf(0x5a8c2c), NONE: Linear = [1, 1, 1];
const PREVIEW_TINTS: Linear[] = VERGE_FOLIAGE_TILES.map(id =>
  /leaf|blades|rosette|clump/.test(id) ? LEAF : NONE);

const started = performance.now();
const atlas = bakeFoliageAtlas({ ids: VERGE_FOLIAGE_TILES, recipes: VERGE_TILE_RECIPES });
const preview = previewDirectory("verge-foliage-preview");
if (preview) writeFoliagePreviews(atlas, preview, { green: PREVIEW_TINTS });
const output = writeFoliageAtlas({ atlas, prefix: "verge-foliage",
  writer: "island-of-settlers verge-foliage-atlas v1" });
console.log(`Verge foliage atlas baked in ${Math.round(performance.now() - started)} ms -> ${output}`);
