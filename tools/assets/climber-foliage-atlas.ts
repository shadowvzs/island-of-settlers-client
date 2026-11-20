import { bakeClimberFoliageAtlas } from "./climber-foliage/atlas-bake";
import { writeClimberFoliagePreviews } from "./climber-foliage/atlas-preview";
import { previewDirectory, writeFoliageAtlas } from "./climber-foliage/atlas-writer";

/**
 * Offline bake of the original climber foliage atlas (card D04a): rose leaves, petals, buds,
 * calyx and blooms, ivy leaves and clusters. Writes uncompressed RGBA8 KTX2 files with explicit
 * coverage-preserving mip chains (zlib supercompressed) and the tile manifest.
 *
 * Usage (from island-of-settlers-client): npm run climber-foliage-atlas [-- --preview <dir>]
 */
const started = performance.now();
const atlas = bakeClimberFoliageAtlas();
const preview = previewDirectory("climber-foliage-preview");
if (preview) writeClimberFoliagePreviews(atlas, preview);
const output = writeFoliageAtlas({ atlas, prefix: "climber-foliage",
  writer: "island-of-settlers climber-foliage-atlas v1" });
console.log(`Climber foliage atlas baked in ${Math.round(performance.now() - started)} ms -> ${output}`);
