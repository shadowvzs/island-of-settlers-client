import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

import type { AtlasMip } from "../../../src/render-common/baker/atlas-mips";
import { encodeKtx2Rgba8 } from "../../../src/render-common/baker/ktx2-rgba8";
import { FOLIAGE_ATLAS_ALPHA_CUTOFF, type FoliageAtlasFile,
  type FoliageAtlasManifest } from "../../../src/render-common/plants/foliage-atlas-layout";
import type { BakedFoliageAtlas } from "./atlas-bake";

const OUTPUT = resolve(import.meta.dirname, "../../../assets/textures/decorations");
const MANIFEST_VERSION = 1;

export interface FoliageAtlasOutput {
  atlas: BakedFoliageAtlas;
  /** File prefix, e.g. `climber-foliage` -> climber-foliage-high-albedo.ktx2 and climber-foliage-atlas.json. */
  prefix: string;
  /** Stable KTX2 writer id (part of the bytes, so the bake stays byte-identical). */
  writer: string;
}

/**
 * Writes uncompressed RGBA8 KTX2 files with the explicit coverage-preserving mip chains (zlib
 * supercompressed) and the tile manifest. Minimal ships the High chain from level 1 on.
 */
export const writeFoliageAtlas = ({ atlas, prefix, writer }: FoliageAtlasOutput) => {
  if (atlas.problems.length > 0) throw new Error(`Atlas not written:\n${atlas.problems.join("\n")}`);
  mkdirSync(OUTPUT, { recursive: true });
  const writeTexture = (file: string, levels: AtlasMip[], srgb: boolean): FoliageAtlasFile => {
    const bytes = encodeKtx2Rgba8(levels, { compress: data => deflateSync(data, { level: 9 }), srgb, writer });
    writeFileSync(join(OUTPUT, file), bytes);
    return { bytes: bytes.length, file, gpuBytes: levels.reduce((sum, level) => sum + level.data.length, 0),
      levels: levels.length, sha256: createHash("sha256").update(bytes).digest("hex"), size: levels[0]!.width };
  };
  const manifest: FoliageAtlasManifest = {
    alphaCutoff: FOLIAGE_ATLAS_ALPHA_CUTOFF,
    files: {
      high: {
        albedo: writeTexture(`${prefix}-high-albedo.ktx2`, atlas.albedo, true),
        normal: writeTexture(`${prefix}-high-normal.ktx2`, atlas.normal, false),
        orm: writeTexture(`${prefix}-high-orm.ktx2`, atlas.material, false)
      },
      minimal: {
        albedo: writeTexture(`${prefix}-minimal-albedo.ktx2`, atlas.albedo.slice(1), true),
        orm: writeTexture(`${prefix}-minimal-orm.ktx2`, atlas.material.slice(1), false)
      }
    },
    levelCoverage: atlas.levelCoverage,
    tiles: atlas.tiles,
    version: MANIFEST_VERSION
  };
  writeFileSync(join(OUTPUT, `${prefix}-atlas.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  return OUTPUT;
};

/** `--preview <dir>` from the command line, resolved; undefined when absent. */
export const previewDirectory = (fallback: string) => {
  const at = process.argv.indexOf("--preview");
  return at >= 0 ? resolve(process.argv[at + 1] ?? fallback) : undefined;
};
