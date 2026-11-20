import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { NoColorSpace } from "three";
import { describe, expect, it } from "vitest";

import type { AtlasMip } from "../src/render-common/baker/atlas-mips";
import { encodeKtx2Rgba8 } from "../src/render-common/baker/ktx2-rgba8";
import { getMicroDetailAtlasUv, getMicroDetailCell, MICRO_CLASS, MICRO_CLASS_IDS, MICRO_CLASS_OF_MATERIAL,
  MICRO_DETAIL_ATLAS_SIZE, MICRO_DETAIL_CELL, MICRO_DETAIL_MIP_LEVELS, MICRO_DETAIL_PADDING,
  MICRO_DETAIL_TILE_SIZE, type MicroClass } from "../src/render-common/materials/micro-detail";
import { loadMicroDetailAtlas, MICRO_DETAIL_ATLAS,
  parseMicroDetailAtlas } from "../src/render-common/materials/micro-detail-atlas";
import { createAtlasTexture } from "../src/renderers/three/three-materials";
import { MATERIAL, MATERIAL_COUNT } from "../src/shared/world/world-data";
import { bakeMicroDetailAtlas, encodeMicroDetailAtlas } from "../tools/assets/micro-detail/atlas-bake";

const ASSETS = resolve(import.meta.dirname, "../assets/textures/terrain");
const inflate = async (bytes: Uint8Array) => new Uint8Array(inflateSync(bytes));
const shippedBytes = () => readFileSync(join(ASSETS, MICRO_DETAIL_ATLAS.file.file));
const readFromDisk = async (_url: string, file: string) => {
  const bytes = readFileSync(join(ASSETS, file));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

/** Mean of one channel over the inner (unpadded) tile of a class at level 0. */
const tileChannelMean = (level: AtlasMip, microClass: MicroClass, channel: number) => {
  const { column, row } = getMicroDetailCell(microClass);
  let sum = 0;
  for (let y = 0; y < MICRO_DETAIL_TILE_SIZE; y += 1) for (let x = 0; x < MICRO_DETAIL_TILE_SIZE; x += 1) {
    const atlasX = column * MICRO_DETAIL_CELL + MICRO_DETAIL_PADDING + x;
    const atlasY = row * MICRO_DETAIL_CELL + MICRO_DETAIL_PADDING + y;
    sum += level.data[(atlasY * level.width + atlasX) * 4 + channel]!;
  }
  return sum / MICRO_DETAIL_TILE_SIZE ** 2;
};

/** Every padding texel of every cell must repeat the opposite edge of its tile (seamless wrap). */
const paddingMismatches = (level: AtlasMip, index: number) => {
  const tile = MICRO_DETAIL_TILE_SIZE >> index, padding = MICRO_DETAIL_PADDING >> index, cell = tile + padding * 2;
  let mismatches = 0;
  for (let cellY = 0; cellY < 2; cellY += 1) for (let cellX = 0; cellX < 2; cellX += 1) {
    for (let y = 0; y < cell; y += 1) for (let x = 0; x < cell; x += 1) {
      const wrappedX = padding + ((x - padding + tile) % tile), wrappedY = padding + ((y - padding + tile) % tile);
      const at = ((cellY * cell + y) * level.width + cellX * cell + x) * 4;
      const inner = ((cellY * cell + wrappedY) * level.width + cellX * cell + wrappedX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        if (level.data[at + channel] !== level.data[inner + channel]) mismatches += 1;
      }
    }
  }
  return mismatches;
};

describe("micro-detail atlas layout", () => {
  it("assigns every ground material a class and keeps the documented cells", () => {
    for (let material = 0; material < MATERIAL_COUNT; material += 1) {
      expect(MICRO_CLASS_IDS[MICRO_CLASS_OF_MATERIAL[material]!], `material ${material}`).toBeDefined();
    }
    expect([MATERIAL.grass, MATERIAL.dirt, MATERIAL.sand, MATERIAL.snow].map(m => MICRO_CLASS_OF_MATERIAL[m]))
      .toEqual([MICRO_CLASS.blades, MICRO_CLASS.soil, MICRO_CLASS.grains, MICRO_CLASS.snow]);
    expect(MICRO_CLASS_IDS.map((_, c) => getMicroDetailCell(c as MicroClass)))
      .toEqual([{ column: 0, row: 0 }, { column: 1, row: 0 }, { column: 0, row: 1 }, { column: 1, row: 1 }]);
    expect(MICRO_DETAIL_ATLAS_SIZE).toBe(576);
  });

  it("maps one repeat onto the inner tile of the class cell", () => {
    const [u0, v0] = getMicroDetailAtlasUv(MICRO_CLASS.snow, 0, 0);
    const [u1, v1] = getMicroDetailAtlasUv(MICRO_CLASS.snow, 0.7499, 0.7499);
    expect(u0 * MICRO_DETAIL_ATLAS_SIZE).toBeCloseTo(304, 6);
    expect(v0 * MICRO_DETAIL_ATLAS_SIZE).toBeCloseTo(304, 6);
    expect(u1 * MICRO_DETAIL_ATLAS_SIZE).toBeCloseTo(560, 1);
    expect(v1 * MICRO_DETAIL_ATLAS_SIZE).toBeCloseTo(560, 1);
  });
});

describe("micro-detail atlas asset", () => {
  it("rebuilds byte-identically and matches its manifest", () => {
    const atlas = bakeMicroDetailAtlas(MICRO_DETAIL_ATLAS.seed);
    const rebuilt = encodeMicroDetailAtlas(atlas.levels), shipped = shippedBytes();
    expect(Buffer.from(rebuilt).equals(shipped)).toBe(true);
    expect(createHash("sha256").update(shipped).digest("hex")).toBe(MICRO_DETAIL_ATLAS.file.sha256);
    expect(atlas.stats).toEqual(MICRO_DETAIL_ATLAS.classes);
    expect(MICRO_DETAIL_ATLAS.file).toMatchObject({ bytes: shipped.length, gpuBytes: 1_767_744, levels: 5, size: 576 });
  });

  it("ships seamless padding and neutral class means at every level", async () => {
    const { levels } = await parseMicroDetailAtlas(shippedBytes(), inflate);
    expect(levels.map(level => level.width)).toEqual([576, 288, 144, 72, 36]);
    levels.forEach((level, index) => expect(paddingMismatches(level, index), `level ${index}`).toBe(0));
    MICRO_CLASS_IDS.forEach((id, microClass) => {
      const means = [0, 1, 2, 3].map(channel => tileChannelMean(levels[0]!, microClass as MicroClass, channel));
      expect(Math.abs(means[0]! - 127.5), `${id} normal x`).toBeLessThan(3);
      expect(Math.abs(means[1]! - 127.5), `${id} normal z`).toBeLessThan(3);
      expect(Math.abs(means[2]! - 127.5), `${id} albedo`).toBeLessThan(1);
      expect(Math.abs(means[3]! - 127.5), `${id} height`).toBeLessThan(1.5);
    });
  });

  it("rejects files that do not match the layout", async () => {
    const level = { data: new Uint8Array(16), height: 2, width: 2 };
    const small = encodeKtx2Rgba8([level], { srgb: false, writer: "test" });
    await expect(parseMicroDetailAtlas(small, inflate)).rejects.toThrow("must be linear 576²");
  });
});

describe("micro-detail atlas loader", () => {
  it("loads the CPU levels that the renderer uploads with explicit linear mips", async () => {
    const atlas = await loadMicroDetailAtlas(readFromDisk);
    expect([atlas.size, atlas.levels.length]).toEqual([MICRO_DETAIL_ATLAS_SIZE, MICRO_DETAIL_MIP_LEVELS]);
    const texture = createAtlasTexture(atlas.levels[0]!.data, atlas.size, atlas.size, atlas.levels);
    expect([texture.mipmaps.length, texture.generateMipmaps, texture.flipY, texture.colorSpace])
      .toEqual([5, false, false, NoColorSpace]);
    texture.dispose();
  });
});
