import { describe, expect, it } from "vitest";

import { buildRockLodIndices } from "../src/render-common/rocks/rock-lod";
import type { RockMeshData } from "../src/render-common/rocks/rock-mesh";

const fixture = () => {
  const size = 12, stride = size + 1, positions = new Float32Array(stride ** 2 * 3);
  const normals = new Float32Array(positions.length), indices: number[] = [];
  for (let z = 0; z <= size; z++) for (let x = 0; x <= size; x++) {
    const vertex = z * stride + x;
    positions.set([x * .25, 0, z * .25], vertex * 3); normals[vertex * 3 + 1] = 1;
    if (x === size || z === size) continue;
    indices.push(vertex, vertex + stride + 1, vertex + 1, vertex, vertex + stride, vertex + stride + 1);
  }
  return { positions, normals, indices: Uint32Array.from(indices), mask: new Uint8Array(stride ** 2 * 4),
    extra: new Uint8Array(stride ** 2 * 4), triangles: indices.length / 3, vertexCount: stride ** 2 } satisfies RockMeshData;
};
const boundaries = (indices: Uint32Array) => {
  const edges = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = indices[i + j]!, b = indices[i + (j + 1) % 3]!;
    const key = `${Math.min(a, b)}/${Math.max(a, b)}`;edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  expect([...edges.values()].every(count => count <= 2)).toBe(true);
  return [...edges].filter(([, count]) => count === 1).map(([key]) => key).sort();
};
describe("rock surface LOD", () => {
  it("reduces planar interior triangles with exactly unchanged chunk seams and no holes", () => {
    const mesh = fixture(), saved = mesh.indices.slice(), reduced = buildRockLodIndices(mesh);
    expect(reduced.length).toBeLessThan(mesh.indices.length * .65);
    expect(boundaries(reduced)).toEqual(boundaries(mesh.indices));
    expect(mesh.indices).toEqual(saved);
    let area = 0;
    for (let i = 0; i < reduced.length; i += 3) {
      const [a, b, c] = Array.from(reduced.slice(i, i + 3)).map(v => mesh.positions.subarray(v * 3, v * 3 + 3));
      area += ((b![2]! - a![2]!) * (c![0]! - a![0]!) - (b![0]! - a![0]!) * (c![2]! - a![2]!)) / 2;
    }
    expect(area).toBeCloseTo(9);
  });
  it("retains a sharp ridge and distinct geology vertices", () => {
    const mesh = fixture();
    const vertex = 6 * 13 + 6;mesh.positions[vertex * 3 + 1] = 2;mesh.mask[vertex * 4 + 2] = 255;
    expect(Array.from(buildRockLodIndices(mesh))).toContain(vertex);
  });
});

it("retains a shallow curved geological surface while keeping closed seams", () => {
  const mesh = fixture();
  for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
    const x = mesh.positions[vertex * 3]!;
    mesh.positions[vertex * 3 + 1] = .12 * Math.sin(x * 2);
    const slope = .24 * Math.cos(x * 2), length = Math.hypot(slope, 1);
    mesh.normals.set([-slope / length, 1 / length, 0], vertex * 3);
  }
  const reduced = buildRockLodIndices(mesh);
  expect(reduced.length).toBeLessThan(mesh.indices.length);
  expect(boundaries(reduced)).toEqual(boundaries(mesh.indices));
  // Every original vertex remains within the simplifier's budget of its surviving surface.
  for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
    const x = mesh.positions[vertex * 3]!, z = mesh.positions[vertex * 3 + 2]!;
    let error = Infinity;
    for (let offset = 0; offset < reduced.length; offset += 3) {
      const points = Array.from(reduced.subarray(offset, offset + 3)).map(index =>
        mesh.positions.subarray(index * 3, index * 3 + 3));
      const [a, b, c] = points;
      const denominator = (b![2]! - c![2]!) * (a![0]! - c![0]!) +
        (c![0]! - b![0]!) * (a![2]! - c![2]!);
      const wa = ((b![2]! - c![2]!) * (x - c![0]!) + (c![0]! - b![0]!) * (z - c![2]!)) / denominator;
      const wb = ((c![2]! - a![2]!) * (x - c![0]!) + (a![0]! - c![0]!) * (z - c![2]!)) / denominator;
      const wc = 1 - wa - wb;
      if (Math.min(wa, wb, wc) < -1e-6) continue;
      error = Math.min(error, Math.abs(wa * a![1]! + wb * b![1]! + wc * c![1]! - mesh.positions[vertex * 3 + 1]!));
    }
    expect(error).toBeLessThan(.037);
  }
});
