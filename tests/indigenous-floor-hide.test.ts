import { DataTexture, Triangle, Vector3 } from "three";
import { expect, it } from "vitest";

import { indigenousFloorHideOutline } from "../src/render-common/props/indigenous-floor-hide-profile";
import { shareBuildingMaterialOwnership } from "../src/renderers/three/buildings/building-material-ownership";
import { createIndigenousFloorHideGeometry } from "../src/renderers/three/buildings/indigenous-floor-hide-geometry";
import { createIndigenousFloorHideMaterial } from "../src/renderers/three/buildings/indigenous-floor-hide-material";

it("makes one continuous irregular body with four restrained limb ends and a closed grounded underside", () => {
  for (const detailed of [true, false]) {
    const outline = indigenousFloorHideOutline(detailed ? 64 : 48);
    const area = Math.abs(outline.reduce((sum, point, at) => {
      const next = outline[(at + 1) % outline.length]!;
      return sum + point[0] * next[1] - point[1] * next[0];
    }, 0)) / 2;
    expect(area).toBeGreaterThan(.45); expect(area).toBeLessThan(.85);
    for (const sideX of [-1, 1]) for (const sideZ of [-1, 1])
      expect(outline.some(([x, z]) => x * sideX > .35 && z * sideZ > .20)).toBe(true);
    const geometry = createIndigenousFloorHideGeometry(detailed), points = geometry.getAttribute("position");
    const index = geometry.index!, triangle = new Triangle(), edges = new Map<string, number>();
    const key = (vertex: number) => [points.getX(vertex), points.getY(vertex), points.getZ(vertex)]
      .map(value => value.toFixed(6)).join(":");
    try {
      expect(index.count / 3).toBe(detailed ? 512 : 288);
      for (let at = 0; at < index.count; at += 3) {
        const vertices = [index.getX(at), index.getX(at + 1), index.getX(at + 2)];
        triangle.set(...vertices.map(vertex => new Vector3().fromBufferAttribute(points, vertex)) as
          [Vector3, Vector3, Vector3]);
        expect(triangle.getArea()).toBeGreaterThan(1e-9);
        for (let edge = 0; edge < 3; edge++) {
          const edgeKey = [key(vertices[edge]!), key(vertices[(edge + 1) % 3]!)].sort().join("/");
          edges.set(edgeKey, (edges.get(edgeKey) ?? 0) + 1);
        }
      }
      expect([...edges.values()].every(count => count === 2)).toBe(true);
      for (let vertex = 0; vertex < points.count; vertex++) {
        expect(points.getY(vertex)).toBeGreaterThanOrEqual(-.500001);
        expect(points.getY(vertex)).toBeLessThan(.2);
        expect(Math.abs(points.getX(vertex))).toBeLessThanOrEqual(.500001);
        expect(Math.abs(points.getZ(vertex))).toBeLessThanOrEqual(.500001);
      }
    } finally {geometry.dispose();}
  }
});

it("shares original brown fur maps across buildings and ghosts until their last owner releases", () => {
  const first = createIndigenousFloorHideMaterial(true), second = createIndigenousFloorHideMaterial(true);
  expect(first.map).toBe(second.map); expect(first.normalMap).toBe(second.normalMap);
  const albedo = first.map!, normal = first.normalMap!;
  let releases = 0;
  albedo.addEventListener("dispose", () => releases++); normal.addEventListener("dispose", () => releases++);
  const ghost = first.clone(); shareBuildingMaterialOwnership(first, ghost);
  first.dispose(); second.dispose(); expect(releases).toBe(0);
  ghost.dispose(); expect(releases).toBe(2);
  const next = createIndigenousFloorHideMaterial(true);
  try {expect(next.map).not.toBe(albedo);} finally {next.dispose();}
});

it("retains shaded brown individual fur on both LODs with High relief and no extra hair meshes", () => {
  for (const detailed of [true, false]) {
    const material = createIndigenousFloorHideMaterial(detailed);
    try {
      expect(material.transparent).toBe(false);
      const map = material.map;
      expect(map).toBeInstanceOf(DataTexture);
      if (!(map instanceof DataTexture)) throw new Error("Expected CPU fur texture");
      const pixels = map.image.data;
      if (!(pixels instanceof Uint8Array)) throw new Error("Expected owned fur RGBA bytes");
      let minimum = Infinity, maximum = 0;
      for (let at = 0; at < pixels.length; at += 4) {
        minimum = Math.min(minimum, pixels[at]!); maximum = Math.max(maximum, pixels[at]!);
        expect(pixels[at]).toBeGreaterThan(pixels[at + 1]!);
        expect(pixels[at + 1]).toBeGreaterThan(pixels[at + 2]!);
      }
      expect(maximum - minimum).toBeGreaterThan(35);
      expect(Boolean(material.normalMap)).toBe(detailed);
      expect(map.image.width).toBe(detailed ? 512 : 256);
    } finally {material.dispose();}
  }
});
