import { Vector3 } from "three";
import { expect, it } from "vitest";

import { catapultAmmoColor } from "../src/render-common/buildings/catapult-ammo-colors";
import {
  createMarbleShotGeometry, createMarbleShotKit, createMarbleShotMaterial
} from "../src/renderers/three/buildings/catapult-marble-shot";

const triangles = (detailed: boolean) => {
  const geometry = createMarbleShotGeometry(detailed), count = geometry.index!.count / 3;
  geometry.dispose();
  return count;
};

it.each([true, false])("is a smooth unit-diameter sphere, detail=%s", detailed => {
  const geometry = createMarbleShotGeometry(detailed), vertices = geometry.getAttribute("position");
  const point = new Vector3();
  for (let index = 0; index < vertices.count; index++)
    expect(point.fromBufferAttribute(vertices, index).length()).toBeCloseTo(.5, 6);
  geometry.dispose();
});

it("keeps Minimal cheaper than High", () => {
  expect(triangles(false)).toBeLessThan(triangles(true) / 4);
  expect(triangles(false)).toBeLessThanOrEqual(200);
});

it("is polished, veined and carries the marble shot tint", () => {
  const material = createMarbleShotMaterial(true), tint = catapultAmmoColor("marble")!;
  expect(material.color.toArray()).toEqual([...tint]);
  expect(material.roughness).toBeLessThan(.4);
  expect(material.map).toBeTruthy();
  const pixels = (material.map!.image as { data: Uint8Array }).data, shades = new Set<number>();
  for (let index = 0; index < pixels.length; index += 4) shades.add(pixels[index]!);
  // Veins span a clearly darker range than the base, so the spin of a rolling ball reads.
  expect(Math.max(...shades) - Math.min(...shades)).toBeGreaterThan(60);
  material.map!.dispose(); material.dispose();
});

it("shares one geometry and material across kit meshes, flagged as kit-owned", () => {
  const kit = createMarbleShotKit(false), first = kit.create(.2), second = kit.create(.3);
  expect(first.geometry).toBe(second.geometry);
  expect(first.material).toBe(second.material);
  expect(first.userData.catapultBundle).toBe(true);
  expect(second.scale.x).toBe(.3);
  kit.dispose();
});
