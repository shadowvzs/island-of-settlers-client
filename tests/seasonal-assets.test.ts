import { describe, expect, it } from "vitest";

import { createVertexAttributes } from "../src/render-common/chunk-sampling";
import type { PropMesh } from "../src/render-common/props/mesh-builder";
import { getWinterFoliageAtlas } from "../src/render-common/seasonal-appearance/winter-foliage";
import { getWinterPropMesh } from "../src/render-common/seasonal-appearance/winter-props";
import {
  getWinterTerrainChunk, invalidateWinterTerrainChunk
} from "../src/render-common/seasonal-appearance/winter-terrain";
import type { ChunkVertexData } from "../src/render-common/terrain-chunks";
import type { PaintedTexture } from "../src/render-common/trees/atlas-canvas";

const makeChunk = (): ChunkVertexData => {
  const source = { ...createVertexAttributes(4), chunkX: 0, chunkZ: 0,
    indices: new Uint16Array([0, 1, 2, 1, 3, 2]), vertexCount: 4 };
  for (let vertex = 0; vertex < 4; vertex++) {
    source.splatA.set([100, 40, 0, 0], vertex * 4);
    source.splatB.set([30, 30, 10, 20], vertex * 4);
    source.splatC.set([25, 85, 170, 0], vertex * 4);
    source.water[vertex * 4] = [-2, .2, -.2, -.5][vertex]!;
    source.water[vertex * 4 + 1] = [8, -1, .1, .6][vertex]!;
  }
  return source;
};

const makeCards = (): PropMesh => {
  const colors: number[] = [], indices: number[] = [], normals: number[] = [], positions: number[] = [];
  const uvs: number[] = [], wind: number[] = [];
  for (let card = 0; card < 33; card++) {
    const base = card * 4, evergreen = card === 32;
    for (let vertex = 0; vertex < 4; vertex++) {
      const x = vertex === 1 || vertex === 2 ? 1 : 0, y = vertex >= 2 ? 1 : 0;
      positions.push(card + x, y, 0); normals.push(0, 0, 1); colors.push(.2, .5, .1); wind.push(1, 1);
      uvs.push(evergreen ? x * .25 : .25 + x * .25, evergreen ? .25 + y * .25 : y * .25);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { colors: Float32Array.from(colors), coreIndexCount: 16 * 6, height: 1,
    indices: Uint16Array.from(indices), minimalIndices: Uint16Array.from(indices.filter((_, index) => index % 12 < 6)),
    normals: Float32Array.from(normals), positions: Float32Array.from(positions), radius: 33,
    uvs: Float32Array.from(uvs), wind: Float32Array.from(wind) };
};

describe("cached winter appearances leave authoritative source assets unchanged", () => {
  it("conserves every ground-weight byte total and keeps rock, ore, geometry and submerged beds", () => {
    const source = makeChunk(), before = structuredClone(source), winter = getWinterTerrainChunk(source);
    expect(source).toEqual(before);
    expect(getWinterTerrainChunk(source)).toBe(winter);
    expect(winter.positions).toBe(source.positions); expect(winter.normals).toBe(source.normals);
    expect(winter.indices).toBe(source.indices); expect(winter.splatC).toBe(source.splatC);
    for (let vertex = 0; vertex < 4; vertex++) {
      const offset = vertex * 4;
      const total = (chunk: ChunkVertexData) => [...chunk.splatA.subarray(offset, offset + 4),
        ...chunk.splatB.subarray(offset, offset + 4), chunk.splatC[offset]!].reduce((sum, value) => sum + value, 0);
      expect(total(winter)).toBe(total(source));
      expect(winter.splatB[offset + 1]).toBe(source.splatB[offset + 1]);
      if (vertex === 1) {
        expect(winter.splatA.subarray(offset, offset + 4)).toEqual(source.splatA.subarray(offset, offset + 4));
        expect(winter.splatB.subarray(offset, offset + 4)).toEqual(source.splatB.subarray(offset, offset + 4));
      }
    }
    expect(winter.splatB[2]).toBe(200);
    expect(winter.splatB[10]).toBe(200);
    expect(winter.splatA.subarray(0, 4)).toEqual(new Uint8Array(4));
    expect(winter.splatB[14]).toBeGreaterThan(10);
    invalidateWinterTerrainChunk(source);
    expect(getWinterTerrainChunk(source)).not.toBe(winter);
  });

  it("drops complete deciduous cards on every LOD and retains evergreen cells at their atlas boundaries", () => {
    const source = makeCards(), before = structuredClone(source), winter = getWinterPropMesh(source);
    expect(source).toEqual(before); expect(getWinterPropMesh(source)).toBe(winter);
    for (const key of ["positions", "normals", "uvs", "wind"] as const) expect(winter[key]).toBe(source[key]);
    expect([winter.height, winter.radius]).toEqual([source.height, source.radius]);
    expect(winter.indices.length).toBeLessThan(source.indices.length);
    expect(winter.indices.length).toBeGreaterThan(6);
    expect([...winter.indices].every(index => index < source.positions.length / 3)).toBe(true);
    for (let card = 0; card < 33; card++) {
      const count = [...winter.indices].filter(index => Math.floor(index / 4) === card).length;
      expect([0, 6]).toContain(count);
      if (card === 32) expect(count).toBe(6);
    }
    expect(winter.minimalIndices!.length).toBeLessThanOrEqual(source.minimalIndices!.length);
    expect(winter.coreIndexCount! % 3).toBe(0);
    const originalCore = new Set(source.indices.subarray(0, source.coreIndexCount));
    const retainedCore = [...winter.indices].filter(index => originalCore.has(index));
    expect(winter.indices.subarray(0, winter.coreIndexCount)).toEqual(Uint16Array.from(retainedCore));
  });

  it("dries untextured ground cover and puts snow on upward faces without changing its indices", () => {
    const source = makeCards(); source.uvs.fill(-1);
    source.normals.fill(0); source.normals[1] = 1;
    const winter = getWinterPropMesh(source, "grass");
    expect(winter.indices).toEqual(source.indices);
    expect(winter.colors[0]).toBeGreaterThan(winter.colors[1]!);
    expect(winter.colors[0]).toBeLessThan(.7);
    expect(winter.colors[3]).toBeGreaterThan(winter.colors[4]!);
    expect(source.colors[3]).toBeCloseTo(.2);
  });

  it("covers dry lowland interiors even when their height is close to the water surface", () => {
    const source = makeChunk();
    source.water[0] = 0;
    source.water[1] = 12;
    const winter = getWinterTerrainChunk(source);
    expect(winter.splatB[2]).toBe(200);
    expect(winter.splatA.subarray(0, 4)).toEqual(new Uint8Array(4));
    const submerged = makeChunk();
    submerged.water[0] = .2;
    submerged.water[1] = 12;
    const wet = getWinterTerrainChunk(submerged);
    expect(wet.splatA.subarray(0, 4)).toEqual(submerged.splatA.subarray(0, 4));
    expect(wet.splatB.subarray(0, 4)).toEqual(submerged.splatB.subarray(0, 4));
  });

  it("keeps the exposed sandy shoreline white down to the waterline", () => {
    const shore = makeChunk();
    shore.water[0] = -.01;
    shore.water[1] = .05;
    const snow = getWinterTerrainChunk(shore);
    expect(snow.splatB[2]).toBe(200);
    expect(snow.splatA.subarray(0, 4)).toEqual(new Uint8Array(4));
    expect(snow.splatB[0]).toBe(0);
    expect(snow.splatB[1]).toBe(shore.splatB[1]);
    expect(snow.splatC).toBe(shore.splatC);
    expect(shore.splatB[2]).toBe(10);
  });

  it("keeps foliage atlas coverage, normal data, dimensions and every mip allocation exact", () => {
    const size = 64, color = new Uint8Array(size * size * 4), normal = color.slice();
    for (let offset = 0; offset < color.length; offset += 4) {
      color.set([55, 100, 35, offset % 12 ? 255 : 0], offset); normal.set([128, 180, 245, 255], offset);
    }
    const mip = { data: color.slice(0, 32 * 32 * 4), height: 32, width: 32 };
    const source: PaintedTexture = { color, colorMips: [{ data: color, height: size, width: size }, mip],
      height: size, normal, normalMips: [{ data: normal, height: size, width: size },
        { ...mip, data: normal.slice(0, mip.data.length) }], width: size };
    const before = structuredClone(source), winter = getWinterFoliageAtlas(source);
    expect(source).toEqual(before); expect(getWinterFoliageAtlas(source)).toBe(winter);
    expect(winter.normal).toBe(source.normal); expect(winter.normalMips).toBe(source.normalMips);
    expect([winter.width, winter.height]).toEqual([size, size]);
    expect(winter.colorMips).toHaveLength(source.colorMips!.length);
    winter.colorMips!.forEach((level, index) => {
      const original = source.colorMips![index]!;
      expect([level.width, level.height, level.data.byteLength]).toEqual(
        [original.width, original.height, original.data.byteLength]);
      for (let alpha = 3; alpha < level.data.length; alpha += 4)
        expect(level.data[alpha]).toBe(original.data[alpha]);
    });
    expect(winter.colorMips![0]!.data).toBe(winter.color);
    expect(winter.color[0]).toBeGreaterThan(winter.color[1]!);
  });
});
