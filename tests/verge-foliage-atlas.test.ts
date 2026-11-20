import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { parseKtx2Rgba8 } from "../src/render-common/baker/ktx2-rgba8";
import { foliageAtlasUvRect } from "../src/render-common/plants/foliage-atlas-layout";
import { VERGE_FOLIAGE_TILES } from "../src/render-common/road-verges/verge-foliage-atlas-layout";
import { VERGE_FOLIAGE_ATLAS } from "../src/render-common/road-verges/verge-foliage-atlas-manifest";
import { acquireVergeFoliageAtlas } from "../src/renderers/three/plants/verge-foliage-atlas";

const ASSETS = resolve(import.meta.dirname, "../assets/textures/decorations");
const inflate = async (bytes: Uint8Array) => new Uint8Array(inflateSync(bytes));
const readFromDisk = async (_url: string, file: string) => {
  const bytes = readFileSync(join(ASSETS, file));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

describe("road-verge foliage atlas assets", () => {
  const { high, minimal } = VERGE_FOLIAGE_ATLAS.files;

  it("ships files matching the manifest, Minimal derived from the High chain", async () => {
    for (const file of [high.albedo, high.normal, high.orm, minimal.albedo, minimal.orm]) {
      const bytes = readFileSync(join(ASSETS, file.file));
      expect(createHash("sha256").update(bytes).digest("hex"), file.file).toBe(file.sha256);
    }
    const [highAlbedo, minimalAlbedo] = await Promise.all([high.albedo, minimal.albedo]
      .map(file => parseKtx2Rgba8(readFileSync(join(ASSETS, file.file)), inflate)));
    expect([highAlbedo!.width, minimalAlbedo!.width]).toEqual([1024, 512]);
    expect(Buffer.from(minimalAlbedo!.levels[0]!.data).equals(Buffer.from(highAlbedo!.levels[1]!.data))).toBe(true);
  });

  it("describes every tile in grid order with a painted, enclosing card", () => {
    expect(VERGE_FOLIAGE_ATLAS.tiles.map(tile => tile.id)).toEqual([...VERGE_FOLIAGE_TILES]);
    for (const tile of VERGE_FOLIAGE_ATLAS.tiles) {
      expect(tile.coverage, tile.id).toBeGreaterThan(.004);
      expect(tile.outline).toHaveLength(8);
      expect(tile.uvRect).toEqual(foliageAtlasUvRect(tile.index));
    }
    expect(VERGE_FOLIAGE_ATLAS.levelCoverage.slice(0, 5).every(value => value > .97 && value < 1.06)).toBe(true);
  });

  it("leases one shared set of maps per detail level; Minimal has no normal map", async () => {
    const [first, second] = await Promise.all([acquireVergeFoliageAtlas(true, readFromDisk),
      acquireVergeFoliageAtlas(true, readFromDisk)]);
    expect(first.maps.albedo).toBe(second.maps.albedo);
    expect(first.maps.normal).not.toBeNull();
    first.release(); second.release();
    const lean = await acquireVergeFoliageAtlas(false, readFromDisk);
    expect(lean.maps.normal).toBeNull();
    expect(lean.tiles).toBe(VERGE_FOLIAGE_ATLAS.tiles);
    lean.release();
  });
});
