import { Mesh, MeshBasicMaterial, PerspectiveCamera } from "three";
import { expect, it } from "vitest";

import { createThreeLightning } from "../src/renderers/three/three-lightning";
import type { WorldData } from "../src/shared/world/world-data";

it("clears an active world bolt when switching weather renderers and cannot resurrect it", () => {
  const world = { cellsX: 4, cellsZ: 4, verticesX: 5, verticesZ: 5,
    heights: new Float32Array(25) } as unknown as WorldData;
  const lightning = createThreeLightning(world);
  lightning.strike(new PerspectiveCamera(), { x: 2, z: 2 }, 10);
  expect(lightning.root.visible).toBe(true);
  lightning.clear();
  expect(lightning.root.visible).toBe(false);
  lightning.update(10.1);
  for (const object of lightning.root.children as Mesh[])
    expect((object.material as MeshBasicMaterial).opacity).toBe(0);
  lightning.strike(new PerspectiveCamera(), { x: 2, z: 2 }, 11);
  expect(lightning.root.visible).toBe(true);
  lightning.update(11.5);
  expect(lightning.root.visible).toBe(false);
  lightning.dispose();
});

it("lands a cinematic ground strike on its point with an impact glow, then clears (CIN6)", () => {
  const world = { cellsX: 8, cellsZ: 8, verticesX: 9, verticesZ: 9, seaLevel: 0,
    heights: new Float32Array(81).fill(2) } as unknown as WorldData;
  const lightning = createThreeLightning(world);
  lightning.strikeGround(new PerspectiveCamera(), { x: 4, z: 3 }, 20);
  const [impact, , core] = lightning.root.children as Mesh[];
  const positions = core!.geometry.getAttribute("position");
  let lowest = Infinity, lowestIndex = 0;
  for (let index = 0; index < positions.count; index++) {
    if (positions.getY(index) < lowest) { lowest = positions.getY(index); lowestIndex = index; }
  }
  expect(lowest).toBeCloseTo(2, 1);
  expect(positions.getX(lowestIndex)).toBeCloseTo(4, 0);
  expect(positions.getZ(lowestIndex)).toBeCloseTo(3, 0);
  expect(impact!.visible).toBe(true);
  lightning.update(20.5);
  expect(core!.visible).toBe(false);
  expect((impact!.material as MeshBasicMaterial).opacity).toBeGreaterThan(0);
  lightning.update(20.7);
  expect(lightning.root.visible).toBe(false);
  lightning.dispose();
});
