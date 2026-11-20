import { describe, expect, it } from "vitest";

import { createVertexAttributes } from "../src/render-common/chunk-sampling";
import type { ChunkVertexData } from "../src/render-common/terrain-chunks";
import { buildTerrainLodIndices } from "../src/render-common/terrain-lod";

const fixture = () => {
  const size = 16,
    stride = size + 1,
    attributes = createVertexAttributes(stride ** 2),
    indices: number[] = [];
  for (let z = 0; z <= size; z++)
    for (let x = 0; x <= size; x++) {
      attributes.positions.set([x, x * 0.1 + z * 0.2, z], (z * stride + x) * 3);
      if (x === size || z === size) continue;
      const a = z * stride + x;
      indices.push(a, a + stride + 1, a + 1, a, a + stride, a + stride + 1);
    }
  return {
    ...attributes,
    indices: Uint16Array.from(indices),
    chunkX: 0,
    chunkZ: 0,
    vertexCount: stride ** 2
  } as ChunkVertexData;
};
const boundaryEdges = (indices: Uint16Array, _data: ChunkVertexData) => {
  const edges = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3)
    for (let j = 0; j < 3; j++) {
      const a = indices[i + j]!,
        b = indices[i + ((j + 1) % 3)]!;
      const key = [Math.min(a, b), Math.max(a, b)].join("/");
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  return [...edges]
    .filter(([, count]) => count === 1)
    .map(([key]) => key)
    .sort();
};
describe("terrain distance LOD", () => {
  it("reduces flat interiors while retaining identical boundaries and continuous internal edges", () => {
    const data = fixture(),
      reduced = buildTerrainLodIndices(data);
    expect(reduced.length).toBeLessThan(data.indices.length * 0.8);
    expect(boundaryEdges(reduced, data)).toEqual(boundaryEdges(data.indices, data));
    let area = 0;
    for (let i = 0; i < reduced.length; i += 3) {
      const [a, b, c] = Array.from(reduced.slice(i, i + 3)).map((v) => [
        data.positions[v * 3]!,
        data.positions[v * 3 + 2]!
      ]);
      area +=
        Math.abs((b![0]! - a![0]!) * (c![1]! - a![1]!) - (c![0]! - a![0]!) * (b![1]! - a![1]!)) / 2;
    }
    expect(area).toBe(256);
  });
  it("preserves a sharp rock ridge and mineral/material detail", () => {
    const data = fixture();
    for (let z = 0; z <= 16; z++) data.positions[(z * 17 + 3) * 3 + 1]! += 1;
    for (let z = 0; z <= 16; z++) data.splatC[(z * 17 + 7) * 4 + 1] = 255;
    const reduced = buildTerrainLodIndices(data);
    expect(Array.from(reduced)).toContain(3 * 17 + 3);
    expect(Array.from(reduced)).toContain(3 * 17 + 7);
  });
});

it("rejects a patch whose centre fan exceeds the height error even when bilinear checks would pass", () => {
  const data = fixture();
  // Prevent the enclosing 8x8 patch from hiding the smaller 4x4 regression.
  data.positions[(7 * 17 + 7) * 3 + 1]! += 1;
  data.positions[(3 * 17 + 3) * 3 + 1]! += 0.014;
  data.positions[(2 * 17 + 3) * 3 + 1]! -= 0.014;
  const reduced = buildTerrainLodIndices(data);
  expect(Array.from(reduced)).toContain(2 * 17 + 3);
  expect(boundaryEdges(reduced, data)).toEqual(boundaryEdges(data.indices, data));
});

it("simplifies narrow curved strips while retaining closed seams and non-overlapping area", () => {
  const data = fixture();
  for (let z = 0; z <= 16; z++)
    for (let x = 0; x <= 16; x++)
      data.positions[(z * 17 + x) * 3 + 1] = x * 0.1 + 0.12 * Math.sin(z * 1.2);
  const reduced = buildTerrainLodIndices(data);
  expect(reduced.length).toBeLessThan(data.indices.length * 0.9);
  expect(boundaryEdges(reduced, data)).toEqual(boundaryEdges(data.indices, data));
  let area = 0;
  const edges = new Map<string, number>();
  for (let offset = 0; offset < reduced.length; offset += 3) {
    const [a, b, c] = Array.from(reduced.subarray(offset, offset + 3)).map((v) => [
      data.positions[v * 3]!,
      data.positions[v * 3 + 2]!
    ]);
    area +=
      Math.abs((b![0]! - a![0]!) * (c![1]! - a![1]!) - (c![0]! - a![0]!) * (b![1]! - a![1]!)) / 2;
    for (let edge = 0; edge < 3; edge++) {
      const a = reduced[offset + edge]!,
        b = reduced[offset + ((edge + 1) % 3)]!;
      const key = `${Math.min(a, b)}/${Math.max(a, b)}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  expect(area).toBe(256);
  expect([...edges.values()].every((count) => count <= 2)).toBe(true);
});

describe("terrain LOD with upright rock faces", () => {
  it("keeps the chunk's own row length and never merges a patch with moved vertices", () => {
    const data = fixture();
    const moved = 5 * 17 + 6;
    data.positions[moved * 3] = data.positions[moved * 3]! + 0.8;
    data.positions[3 * 3 + 2] = data.positions[3 * 3 + 2]! + 0.5;
    const lod = buildTerrainLodIndices({ ...data, columns: 16 });
    const merged = lod.length < data.indices.length;
    expect(merged).toBe(true);
    const triangles = Array.from({ length: lod.length / 3 },
      (_, index) => Array.from(lod.slice(index * 3, index * 3 + 3)));
    expect(triangles.some(triangle => triangle.includes(moved))).toBe(true);
    for (const triangle of triangles) {
      const columns = triangle.map(vertex => vertex % 17);
      expect(Math.max(...columns) - Math.min(...columns)).toBeLessThanOrEqual(8);
    }
  });
});
