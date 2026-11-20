import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";

import type { PropMesh } from "../src/render-common/props/mesh-builder";
import { createPropMeshes } from "../src/render-common/props/prop-meshes";
import { createFoliageAtlas } from "../src/render-common/trees/foliage-atlas";
import { findTreeJunction } from "../src/render-common/trees/tree-junction";
import type { WoodLimb } from "../src/render-common/trees/tree-model";

interface OriginalBudget {
  coreIndices: number;
  height: number;
  indices: number;
  indexHash: string;
  mesh: number;
  radius: number;
  vertices: number;
}
// Re-captured 2026-11-17 after shore-shells (116ca87c1) appended 40 sea-snail and open-shell meshes
// (240 -> 280) and the later tree, plant and shell revisions changed existing geometry;
// the budgets still pin every shipped vertex, triangle, bound and atlas mip exactly.
const original = JSON.parse(readFileSync(new URL(
  "./fixtures/vegetation-original-budgets-2026-11-02.json", import.meta.url
), "utf8")) as { meshCount: number; reports: OriginalBudget[]; atlas: { width: number; height: number;
  colorBytes: number; normalBytes: number; colorMipBytes: number[]; normalMipBytes: number[] } };
let meshes: PropMesh[];
beforeAll(() => { meshes = createPropMeshes(2024); });

it("keeps all 280 prop vertex, triangle and core LOD budgets and canonical bounds exactly", () => {
  expect(meshes).toHaveLength(original.meshCount);
  for (const budget of original.reports) {
    const mesh = meshes[budget.mesh]!;
    expect({ vertices: mesh.positions.length / 3, indices: mesh.indices.length,
      coreIndices: mesh.coreIndexCount ?? mesh.indices.length, height: mesh.height, radius: mesh.radius })
      .toEqual({ vertices: budget.vertices, indices: budget.indices, coreIndices: budget.coreIndices,
        height: budget.height, radius: budget.radius });
    const indices = new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength);
    expect(createHash("sha256").update(indices).digest("hex")).toBe(budget.indexHash);
    let maximumRadius = 0, maximumHeight = 0, finite = true;
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
      const index = vertex * 3;
      maximumRadius = Math.max(maximumRadius, Math.hypot(mesh.positions[index]!, mesh.positions[index + 2]!));
      maximumHeight = Math.max(maximumHeight, mesh.positions[index + 1]!);
      finite &&= Number.isFinite(mesh.normals[index]! + mesh.normals[index + 1]! + mesh.normals[index + 2]!);
    }
    // Imported quantized foliage already has sub-millimetre packing error in its original bound.
    expect(maximumRadius).toBeLessThanOrEqual(mesh.radius + .001);
    expect(maximumHeight).toBeLessThanOrEqual(mesh.height + .001);
    expect(finite).toBe(true);
  }
});

it("finds a real parent collar without changing the authored tree skeleton", () => {
  const trunk: WoodLimb = { depth: 0, phase: 0, points: [[0, 0, 0], [0, 2, 0]],
    radii: [.3, .15], sway: [0, 1] };
  const branch: WoodLimb = { depth: 1, phase: 1, points: [[0, 1, 0], [.5, 1.2, 0], [1, 1.3, 0]],
    radii: [.1, .06, .01], sway: [.2, 1] };
  const saved = JSON.stringify([trunk, branch]);
  const junction = findTreeJunction(branch, [trunk, branch], 2)!;
  expect(junction.axis).toEqual([0, 1, 0]);
  expect(junction.origin).toEqual([0, 2, 0]);
  expect(junction.radius).toBeCloseTo(.45, 12);
  expect(findTreeJunction(trunk, [trunk, branch], 2)).toBeUndefined();
  expect(findTreeJunction({ ...branch, points: [[2, 1, 0], [3, 1, 0]] }, [trunk], 2)).toBeUndefined();
  expect(JSON.stringify([trunk, branch])).toBe(saved);
});

it("keeps the original color/normal atlas resolution, RGBA allocation and every mip budget", () => {
  const atlas = createFoliageAtlas(7);
  expect({ width: atlas.width, height: atlas.height, colorBytes: atlas.color.byteLength,
    normalBytes: atlas.normal.byteLength, colorMipBytes: atlas.colorMips!.map(mip => mip.data.byteLength),
    normalMipBytes: atlas.normalMips!.map(mip => mip.data.byteLength) }).toEqual(original.atlas);
});
