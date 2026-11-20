import { expect, it } from "vitest";

import { createGrapeBunchGeometry } from "../src/renderers/three/buildings/grape-bunch-geometry";
import { createVineFoliageGeometry } from "../src/renderers/three/buildings/vine-foliage-geometry";

it("models rounded berries and connected stalks without inflating compact cargo clusters", () => {
  const high = createGrapeBunchGeometry(true, false), minimal = createGrapeBunchGeometry(false, false);
  const cargo = createGrapeBunchGeometry(true, true);
  expect(high.getAttribute("position").count / 3).toBeLessThanOrEqual(320);
  expect(minimal.getAttribute("position").count / 3).toBeLessThanOrEqual(60);
  expect(cargo.getAttribute("position").count / 3).toBe(24);
  high.computeBoundingBox();
  expect(high.boundingBox!.max.y).toBeLessThanOrEqual(.502);
  for (const geometry of [high, minimal, cargo]) {
    expect(Array.from(geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
    geometry.dispose();
  }
});

it("lights cupped leaf surfaces with varying normals rather than a flat card normal", () => {
  for (const detailed of [false, true]) {
    const geometry = createVineFoliageGeometry(detailed), normals = geometry.getAttribute("normal");
    expect([normals.getX(0), normals.getY(0), normals.getZ(0)])
      .not.toEqual([normals.getX(1), normals.getY(1), normals.getZ(1)]);
    expect(normals.count / 3).toBe(detailed ? 320 : 96);
    geometry.dispose();
  }
});
