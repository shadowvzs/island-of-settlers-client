import { Mesh, MeshBasicMaterial } from "three";
import { expect, it } from "vitest";

import { createVertexAttributes } from "../src/render-common/chunk-sampling";
import type { ChunkVertexData } from "../src/render-common/terrain-chunks";
import { buildTerrainLodIndices } from "../src/render-common/terrain-lod";
import { createThreeTerrain, groundChunkHasWater } from "../src/renderers/three/three-terrain";
import type { WorldData } from "../src/shared/world/world-data";

const chunk = (chunkX: number): ChunkVertexData => {
  const size = 16,
    stride = size + 1,
    data = createVertexAttributes(stride ** 2),
    indices: number[] = [];
  for (let z = 0; z <= size; z++)
    for (let x = 0; x <= size; x++) {
      data.positions.set([x + chunkX * size, 0, z], (z * stride + x) * 3);
      if (x === size || z === size) continue;
      const a = z * stride + x;
      indices.push(a, a + stride + 1, a + 1, a, a + stride, a + stride + 1);
    }
  return {
    ...data,
    chunkX,
    chunkZ: 0,
    vertexCount: stride ** 2,
    indices: Uint16Array.from(indices)
  };
};

it("defers close-view/editor simplification and bounds far-view rebuilds without hiding ground", () => {
  const chunks = Array.from({ length: 6 }, (_, index) => chunk(index));
  const material = new MeshBasicMaterial();
  const terrain = createThreeTerrain(
    { cellsX: 96, cellsZ: 16, seaLevel: -1 } as WorldData,
    { terrain: chunks, water: [] },
    material,
    material
  );
  const meshes = terrain.ground.children as Mesh[];
  terrain.updateLod(1, true);
  expect(meshes.every((mesh) => mesh.geometry.drawRange.count === Infinity)).toBe(true);
  terrain.updateLod(0.3, true);
  const first = meshes.filter((mesh) => mesh.geometry.drawRange.count < chunks[0]!.indices.length);
  expect(first.length).toBeGreaterThan(0);
  expect(first.length).toBeLessThanOrEqual(4);
  for (let frame = 0; frame < 10; frame++) terrain.updateLod(0.3, true);
  expect(
    meshes.every(
      (mesh) => mesh.geometry.drawRange.count === buildTerrainLodIndices(chunks[0]!).length
    )
  ).toBe(true);
  terrain.updateLod(1, true);
  expect(meshes.every((mesh) => mesh.geometry.drawRange.count === chunks[0]!.indices.length)).toBe(
    true
  );
  const painted = chunk(0);
  painted.splatA[4 * (8 * 17 + 8)] = 255;
  terrain.setChunkGround(painted);
  expect(meshes[0]!.geometry.drawRange.count).toBe(chunks[0]!.indices.length);
  for (let frame = 0; frame < 10; frame++) terrain.updateLod(0.3, true);
  expect(meshes[0]!.geometry.drawRange.count).toBe(buildTerrainLodIndices(painted).length);
  terrain.updateLod(0.3, false);
  expect(meshes.every((mesh) => mesh.geometry.drawRange.count === chunks[0]!.indices.length)).toBe(
    true
  );
  for (const mesh of [...terrain.ground.children, ...terrain.water.children] as Mesh[])
    mesh.geometry.dispose();
  material.dispose();
});

it("hides waterless ground for refraction and restores only what it hid", () => {
  const chunks = Array.from({ length: 3 }, (_, index) => chunk(index));
  chunks[0]!.water[0] = 0.4;
  expect(groundChunkHasWater(chunks[0]!.water)).toBe(true);
  expect(groundChunkHasWater(chunks[1]!.water)).toBe(false);
  expect(groundChunkHasWater(Float32Array.from([0, 0, 0, 0, 0.4, 0, 0, 0]))).toBe(true);

  const material = new MeshBasicMaterial();
  const terrain = createThreeTerrain(
    { cellsX: 48, cellsZ: 16, seaLevel: -1 } as WorldData,
    { terrain: chunks, water: [] },
    material,
    material
  );
  const meshes = terrain.ground.children as Mesh[];
  meshes[2]!.visible = false;
  const restore = terrain.hideWaterlessGround();
  expect(meshes[0]!.visible).toBe(true);
  expect(meshes[1]!.visible).toBe(false);
  expect(meshes[2]!.visible).toBe(false);
  restore();
  expect(meshes[1]!.visible).toBe(true);
  expect(meshes[2]!.visible).toBe(false);
  for (const mesh of [...terrain.ground.children, ...terrain.water.children] as Mesh[])
    mesh.geometry.dispose();
  material.dispose();
});

it("applies FPS chunk distance LOD without simplifying near ground", () => {
  const chunks = Array.from({ length: 6 }, (_, index) => chunk(index));
  const material = new MeshBasicMaterial();
  const terrain = createThreeTerrain(
    { cellsX: 96, cellsZ: 16, seaLevel: -1 } as WorldData,
    { terrain: chunks, water: [] },
    material,
    material
  );
  const meshes = terrain.ground.children as Mesh[];
  for (let frame = 0; frame < 10; frame += 1)
    terrain.updateLod(1, false, { x: 8, z: 8 }, 20);
  expect(meshes[0]!.geometry.drawRange.count).toBe(chunks[0]!.indices.length);
  expect(meshes[5]!.geometry.drawRange.count).toBe(buildTerrainLodIndices(chunks[5]!).length);
  terrain.updateLod(1, false, { x: 88, z: 8 }, 20);
  expect(meshes[0]!.geometry.drawRange.count).toBe(buildTerrainLodIndices(chunks[0]!).length);
  expect(meshes[5]!.geometry.drawRange.count).toBe(chunks[5]!.indices.length);
  for (const mesh of terrain.ground.children as Mesh[]) mesh.geometry.dispose();
  material.dispose();
});
