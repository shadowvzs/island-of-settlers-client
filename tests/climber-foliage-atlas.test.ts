import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { SRGBColorSpace } from "three";
import { describe, expect, it } from "vitest";

import { encodeKtx2Rgba8, type Ktx2Rgba8Texture, parseKtx2Rgba8 } from "../src/render-common/baker/ktx2-rgba8";
import { CLIMBER_FOLIAGE_TILES } from "../src/render-common/plants/climber-foliage-atlas-layout";
import { CLIMBER_FOLIAGE_ATLAS,
  climberFoliageCardVertices } from "../src/render-common/plants/climber-foliage-atlas-manifest";
import { FOLIAGE_ATLAS_GRID, type FoliageAtlasFile,
  foliageAtlasUvRect } from "../src/render-common/plants/foliage-atlas-layout";
import { acquireClimberFoliageAtlas } from "../src/renderers/three/plants/climber-foliage-atlas";
import { convexHull, polygonEncloses, reduceConvexPolygon } from "../tools/assets/climber-foliage/atlas-outline";

const ASSETS = resolve(import.meta.dirname, "../assets/textures/decorations");
const inflate = async (bytes: Uint8Array) => new Uint8Array(inflateSync(bytes));
const readTexture = (file: FoliageAtlasFile) => parseKtx2Rgba8(readFileSync(join(ASSETS, file.file)), inflate);
const readFromDisk = async (_url: string, file: string) => {
  const bytes = readFileSync(join(ASSETS, file));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const tileCoverage = (texture: Ktx2Rgba8Texture, level: number, index: number) => {
  const { data, width } = texture.levels[level]!, tile = width / FOLIAGE_ATLAS_GRID;
  const x0 = (index % FOLIAGE_ATLAS_GRID) * tile, y0 = Math.floor(index / FOLIAGE_ATLAS_GRID) * tile;
  let covered = 0;
  for (let y = 0; y < tile; y += 1) for (let x = 0; x < tile; x += 1) {
    if (data[((y0 + y) * width + x0 + x) * 4 + 3]! >= 128) covered += 1;
  }
  return covered / (tile * tile);
};

describe("KTX2 RGBA8 container", () => {
  const levels = [4, 2, 1].map(size => ({
    data: Uint8Array.from({ length: size * size * 4 }, (_, i) => (i * 37 + size) % 256),
    height: size, width: size }));

  it.each([true, false])("round-trips an explicit mip chain (zlib %s)", async compressed => {
    const bytes = encodeKtx2Rgba8(levels, { compress: compressed ? data => deflateSync(data) : undefined, srgb: true,
      writer: "test" });
    expect([...bytes.subarray(0, 12)])
      .toEqual([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
    const parsed = await parseKtx2Rgba8(bytes, inflate);
    expect(parsed.srgb).toBe(true);
    expect(parsed.levels.map(level => [...level.data])).toEqual(levels.map(level => [...level.data]));
  });

  it("rejects a broken mip chain", () => {
    expect(() => encodeKtx2Rgba8([levels[0]!, levels[2]!], { srgb: false, writer: "test" }))
      .toThrow("KTX2 level 1 must be 2x2 RGBA8");
  });
});

describe("climber foliage atlas assets", () => {
  const { high, minimal } = CLIMBER_FOLIAGE_ATLAS.files;
  const files = [high.albedo, high.normal, high.orm, minimal.albedo, minimal.orm];

  it("ships files matching the manifest", async () => {
    for (const file of files) {
      const bytes = readFileSync(join(ASSETS, file.file));
      expect(createHash("sha256").update(bytes).digest("hex"), file.file).toBe(file.sha256);
      const texture = await readTexture(file);
      expect([texture.width, texture.levels.length]).toEqual([file.size, file.levels]);
      expect(texture.srgb).toBe(file.file.includes("albedo"));
    }
    expect([high.albedo.size, high.albedo.levels, minimal.albedo.size, minimal.albedo.levels])
      .toEqual([1024, 8, 512, 7]);
  });

  it("derives Minimal from the High chain, so both detail levels show the same art", async () => {
    const [highAlbedo, minimalAlbedo] = await Promise.all([readTexture(high.albedo), readTexture(minimal.albedo)]);
    expect(Buffer.from(minimalAlbedo.levels[0]!.data).equals(Buffer.from(highAlbedo.levels[1]!.data))).toBe(true);
  });

  it("preserves alpha-tested coverage of every tile down the mip chain", async () => {
    const albedo = await readTexture(high.albedo);
    CLIMBER_FOLIAGE_ATLAS.tiles.filter(tile => tile.coverage > 0).forEach(tile => {
      const base = tileCoverage(albedo, 0, tile.index);
      for (let level = 1; level <= 5; level += 1) {
        const texels = (256 >> level) ** 2, error = Math.abs(tileCoverage(albedo, level, tile.index) - base) * texels;
        expect(error, `${tile.id} level ${level}`).toBeLessThanOrEqual(Math.max(0.05 * base * texels, 4));
      }
    });
  });

  it("describes 16 tiles with 8-vertex convex outlines that enclose every visible texel", async () => {
    const albedo = await readTexture(high.albedo), { data, width } = albedo.levels[0]!;
    const tile = width / FOLIAGE_ATLAS_GRID;
    expect(CLIMBER_FOLIAGE_ATLAS.tiles.map(entry => entry.id)).toEqual([...CLIMBER_FOLIAGE_TILES]);
    for (const entry of CLIMBER_FOLIAGE_ATLAS.tiles) {
      expect(entry.uvRect).toEqual(foliageAtlasUvRect(entry.index));
      expect(entry.outline).toHaveLength(8);
      expect(entry.outline.flat().every(value => value >= 0 && value <= 1)).toBe(true);
      if (entry.coverage === 0) continue;
      expect(convexHull(entry.outline)).toHaveLength(8);
      const x0 = (entry.index % FOLIAGE_ATLAS_GRID) * tile;
      const y0 = Math.floor(entry.index / FOLIAGE_ATLAS_GRID) * tile;
      const visible: [number, number][] = [];
      for (let y = 0; y < tile; y += 1) for (let x = 0; x < tile; x += 1) {
        if (data[((y0 + y) * width + x0 + x) * 4 + 3]! >= 2) visible.push([(x + 0.5) / tile, (y + 0.5) / tile]);
      }
      expect(polygonEncloses(entry.outline, visible, 1e-4), entry.id).toBe(true);
      const [pu, pv] = entry.pivot, near = visible.some(([u, v]) => Math.hypot(u - pu, v - pv) < 4 / tile);
      expect(near, `${entry.id} pivot`).toBe(true);
    }
  });

  it("maps card outlines to atlas UVs relative to the pivot", () => {
    const card = climberFoliageCardVertices("ivy-adult-cordate"), tile = CLIMBER_FOLIAGE_ATLAS.tiles[10]!;
    expect(card.positions[0]).toEqual([tile.outline[0]![0] - tile.pivot[0], tile.outline[0]![1] - tile.pivot[1]]);
    expect(card.uvs.every(([u, v]) => u >= 0.5 && u <= 0.75 && v >= 0.5 && v <= 0.75)).toBe(true);
  });
});

describe("climber foliage atlas loader", () => {
  it("shares one map set per detail level and frees it with the last lease", async () => {
    const [first, second] = await Promise.all([acquireClimberFoliageAtlas(true, readFromDisk),
      acquireClimberFoliageAtlas(true, readFromDisk)]);
    expect(first.maps.albedo).toBe(second.maps.albedo);
    expect(first.maps.albedo.colorSpace).toBe(SRGBColorSpace);
    expect([first.maps.albedo.mipmaps.length, first.maps.albedo.generateMipmaps, first.maps.albedo.flipY])
      .toEqual([8, false, false]);
    expect(first.maps.normal?.mipmaps).toHaveLength(8);
    let disposed = 0;
    first.maps.albedo.addEventListener("dispose", () => { disposed += 1; });
    first.release();
    first.release();
    expect(disposed).toBe(0);
    second.release();
    expect(disposed).toBe(1);
    const minimal = await acquireClimberFoliageAtlas(false, readFromDisk);
    expect([minimal.maps.normal, minimal.maps.orm.mipmaps.length, minimal.maps.albedo.anisotropy])
      .toEqual([null, 7, 1]);
    expect(minimal.tiles).toHaveLength(16);
    minimal.release();
  });
});

describe("outline reduction", () => {
  it("reduces a circle hull to 8 vertices that still enclose it", () => {
    const circle = Array.from({ length: 64 }, (_, i): [number, number] =>
      [0.5 + 0.4 * Math.cos(i / 64 * Math.PI * 2), 0.5 + 0.4 * Math.sin(i / 64 * Math.PI * 2)]);
    const outline = reduceConvexPolygon(convexHull(circle), 8);
    expect(outline).toHaveLength(8);
    expect(polygonEncloses(outline, circle, 1e-9)).toBe(true);
  });
});
