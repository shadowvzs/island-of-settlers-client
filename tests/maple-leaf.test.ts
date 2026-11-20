import { expect, it, vi } from "vitest";

import type { OrnamentalLeaf } from "../src/render-common/plants/ornamental-tree-graph";
import { createMapleLeafGeometry } from "../src/renderers/three/plants/maple-leaf-geometry";
import { createMapleLeafMaterials } from "../src/renderers/three/plants/maple-leaf-material";

const leaf: OrnamentalLeaf = { length: .18, pitch: 0, position: [0, 0, 0], roll: 0,
  seed: 17, width: .17, yaw: 0 };

it("retains a real five-lobed outline and a connected petiole at both detail levels", () => {
  for (const detailed of [true, false]) {
    const geometry = createMapleLeafGeometry(leaf, detailed);
    const position = geometry.getAttribute("position"), index = geometry.index!;
    expect(index.count / 3).toBeLessThanOrEqual(detailed ? 36 : 16);
    expect(geometry.boundingBox!.min.z).toBe(0);
    expect(geometry.boundingBox!.max.z).toBeCloseTo(leaf.length);
    expect(geometry.boundingBox!.max.x - geometry.boundingBox!.min.x).toBeCloseTo(leaf.width);
    const lowerWing = Array.from({ length: position.count }, (_, id) =>
      Math.abs(position.getX(id)) > leaf.width * .49 && position.getZ(id) > leaf.length * .3);
    expect(lowerWing.filter(Boolean).length).toBe(2);
    expect(position.getY(0)).toBeGreaterThan(0);
    const stemRoot = position.count - 4;
    expect(position.getZ(stemRoot)).toBe(0);
    expect(position.getY(stemRoot)).toBe(0);
    geometry.dispose();
  }
});

it("contains no degenerate triangles or inverted upper lamina faces", () => {
  for (const detailed of [true, false]) {
    const geometry = createMapleLeafGeometry(leaf, detailed);
    const position = geometry.getAttribute("position"), index = geometry.index!;
    for (let triangle = 0; triangle < index.count; triangle += 3) {
      const a = index.getX(triangle), b = index.getX(triangle + 1), c = index.getX(triangle + 2);
      const abx = position.getX(b) - position.getX(a), abz = position.getZ(b) - position.getZ(a);
      const acx = position.getX(c) - position.getX(a), acz = position.getZ(c) - position.getZ(a);
      expect(abz * acx - abx * acz).toBeGreaterThan(1e-9);
    }
    geometry.dispose();
  }
});

it("poses the petiole at the authored branch contact without adding a palette-specific mesh", () => {
  const posed = createMapleLeafGeometry({ ...leaf, pitch: .6, position: [2, 3, 4], roll: -.3, yaw: 1.1 }, true);
  const position = posed.getAttribute("position"), a = position.count - 4, b = a + 1;
  expect((position.getX(a) + position.getX(b)) / 2).toBeCloseTo(2);
  expect((position.getY(a) + position.getY(b)) / 2).toBeCloseTo(3);
  expect((position.getZ(a) + position.getZ(b)) / 2).toBeCloseTo(4);
  posed.dispose();
});

it("shares neutral veined maps across all palettes and disposes only through their common owner", () => {
  const owner = createMapleLeafMaterials();
  const yellow = owner.material("yellow"), orange = owner.material("orange"), red = owner.material("red");
  expect(owner.material("yellow")).toBe(yellow);
  expect(yellow.map).toBe(orange.map); expect(orange.map).toBe(red.map);
  expect(yellow.normalMap).toBe(red.normalMap);
  expect(yellow.color.getHex()).not.toBe(orange.color.getHex());
  expect(red.color.getHex()).not.toBe(orange.color.getHex());
  const pixels = owner.map.image.data!;
  const shades = new Set<number>();
  for (let at = 0; at < pixels.length; at += 4) {
    const channels = [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!];
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(7);
    shades.add(pixels[at]!);
  }
  expect(shades.size).toBeGreaterThan(40);
  const normals = owner.normalMap.image.data!;
  expect(normals.some((value: number, at: number) => at % 4 === 0 && Math.abs(value - 128) > 10)).toBe(true);
  const textureDispose = vi.fn(), materialDispose = vi.fn();
  owner.map.addEventListener("dispose", textureDispose); owner.normalMap.addEventListener("dispose", textureDispose);
  for (const material of [yellow, orange, red]) material.addEventListener("dispose", materialDispose);
  owner.dispose(); owner.dispose();
  expect(textureDispose).toHaveBeenCalledTimes(2); expect(materialDispose).toHaveBeenCalledTimes(3);
  expect(() => owner.material("red")).toThrow(/disposed/);
});
