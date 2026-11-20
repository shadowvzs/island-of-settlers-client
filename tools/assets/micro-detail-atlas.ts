import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { MicroDetailAtlasManifest } from "../../src/render-common/materials/micro-detail";
import { bakeMicroDetailAtlas, encodeMicroDetailAtlas, MICRO_DETAIL_SEED } from "./micro-detail/atlas-bake";
import { writeMicroDetailPreviews } from "./micro-detail/atlas-preview";

/**
 * Offline bake of the original ground micro-detail atlas (card T06a): grass blades, soil crumbs,
 * sand/gravel grains and snow crust. Writes one linear RGBA8 KTX2 file with an explicit mip chain
 * (zlib supercompressed) and its manifest. Deterministic: a rebuild is byte-identical.
 *
 * Usage (from island-of-settlers-client): npm run micro-detail-atlas [-- --preview <dir>]
 */

const OUTPUT = resolve(import.meta.dirname, "../../assets/textures/terrain");
const MICRO_DETAIL_FILE = "micro-detail-atlas.ktx2";
const MANIFEST_VERSION = 1;

const main = () => {
  const started = performance.now();
  const atlas = bakeMicroDetailAtlas();
  const bytes = encodeMicroDetailAtlas(atlas.levels);
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(join(OUTPUT, MICRO_DETAIL_FILE), bytes);
  const manifest: MicroDetailAtlasManifest = {
    classes: atlas.stats,
    file: {
      bytes: bytes.length,
      file: MICRO_DETAIL_FILE,
      gpuBytes: atlas.levels.reduce((sum, level) => sum + level.data.length, 0),
      levels: atlas.levels.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: atlas.levels[0]!.width
    },
    seed: MICRO_DETAIL_SEED,
    version: MANIFEST_VERSION
  };
  writeFileSync(join(OUTPUT, "micro-detail-atlas.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const previewAt = process.argv.indexOf("--preview");
  if (previewAt >= 0) writeMicroDetailPreviews(atlas, resolve(process.argv[previewAt + 1] ?? "micro-detail-preview"));
  console.log(`Micro-detail atlas baked in ${Math.round(performance.now() - started)} ms -> ${OUTPUT}`);
};

main();
