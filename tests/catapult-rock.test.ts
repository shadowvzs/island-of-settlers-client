import { Vector3 } from "three";
import { expect, it } from "vitest";

import {
  createCatapultRockGeometry, createCatapultRockMaterial, disposeCatapultRockMaterial
} from "../src/renderers/three/buildings/catapult-rock-geometry";

it.each([true, false])("keeps a closed, irregular rock with independently owned geometry, detail=%s", detailed => {
  const geometry = createCatapultRockGeometry(detailed), other = createCatapultRockGeometry(detailed);
  expect(geometry).not.toBe(other);
  expect(geometry.getAttribute("position").array).toEqual(other.getAttribute("position").array);
  const vertices = geometry.getAttribute("position"), a = new Vector3(), b = new Vector3(), c = new Vector3();
  const edges = new Map<string, number>(), radii: number[] = [];
  const key = (index: number) => [vertices.getX(index), vertices.getY(index), vertices.getZ(index)]
    .map(value => value.toFixed(4)).join(",");
  for (let index = 0; index < vertices.count; index += 3) {
    a.fromBufferAttribute(vertices, index); b.fromBufferAttribute(vertices, index + 1);
    c.fromBufferAttribute(vertices, index + 2);
    expect(b.sub(a).cross(c.sub(a)).length()).toBeGreaterThan(1e-7);
    for (let side = 0; side < 3; side++) {
      const edge = [key(index + side), key(index + (side + 1) % 3)].sort().join("|");
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  for (let index = 0; index < vertices.count; index++) radii.push(a.fromBufferAttribute(vertices, index).length());
  expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(1.25);
  expect([...edges.values()].every(count => count === 2)).toBe(true);
  for (const extent of geometry.boundingBox!.getSize(a).toArray()) expect(extent).toBeCloseTo(1, 6);
  expect(vertices.count / 3).toBeLessThan(1000);
  const material = createCatapultRockMaterial(detailed);
  expect(material.roughness).toBeGreaterThan(.9);
  expect(material.metalness).toBe(0);
  expect(material.map).toBeTruthy();
  expect(Boolean(material.normalMap)).toBe(detailed);
  disposeCatapultRockMaterial(material); geometry.dispose(); other.dispose();
});
