import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import type { OrnamentalBlossom } from "../src/render-common/plants/ornamental-tree-graph";
import { createPeachBlossomFarGeometries, createPeachBlossomGeometries } from "../src/renderers/three/plants/peach-blossom-geometry";
import { createPeachBlossomMaterials, createPeachPetalTextures } from "../src/renderers/three/plants/peach-blossom-materials";
import { createPeachBlossomModel } from "../src/renderers/three/plants/peach-blossom-model";

const flower: OrnamentalBlossom = { position: [0, 0, 0], yaw: 0, pitch: 0, radius: .065, seed: 5 };

it("models five separate cupped petals, connected pedicel and reproductive centre at both details", () => {
  for (const detailed of [true, false]) {
    const pieces = createPeachBlossomGeometries(flower, detailed);
    expect(pieces.petals.boundingBox!.max.y - pieces.petals.boundingBox!.min.y).toBeGreaterThan(.01);
    expect(pieces.calyx.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(pieces.calyx.boundingBox!.max.y).toBeGreaterThan(.009);
    expect(pieces.centre.boundingBox!.max.y).toBeGreaterThan(.031);
    for (const geometry of Object.values(pieces)) {
      const position = geometry.getAttribute("position"), index = geometry.index!;
      expect(geometry.hasAttribute("color") && geometry.hasAttribute("normal") && geometry.hasAttribute("uv")).toBe(true);
      for (let at = 0; at < index.count; at += 3) {
        const a = new Vector3().fromBufferAttribute(position, index.getX(at));
        const b = new Vector3().fromBufferAttribute(position, index.getX(at + 1));
        const c = new Vector3().fromBufferAttribute(position, index.getX(at + 2));
        expect(b.sub(a).cross(c.sub(a)).lengthSq()).toBeGreaterThan(1e-15);
      }
      geometry.dispose();
    }
    expect(pieces.petals.index!.count / 3).toBe(detailed ? 240 : 40);
  }
});

it("keeps canopy LOD as cupped petal geometry rather than an alpha flower rectangle", () => {
  const pieces = createPeachBlossomGeometries(flower, false, true);
  expect(Object.values(pieces).reduce((sum, geometry) => sum + geometry.index!.count / 3, 0)).toBe(36);
  expect(pieces.petals.index!.count / 3).toBe(20);
  expect(pieces.petals.boundingBox!.max.y - pieces.petals.boundingBox!.min.y).toBeGreaterThan(.01);
  Object.values(pieces).forEach(geometry => geometry.dispose());
});

it("keeps the distant flower within24 true triangles including a physical woody attachment", () => {
  const pieces = createPeachBlossomFarGeometries(flower);
  expect(Object.values(pieces).reduce((sum, geometry) => sum + geometry.index!.count / 3, 0)).toBe(24);
  expect(pieces.petals.index!.count / 3).toBe(20);
  expect(pieces.petals.boundingBox!.max.y - pieces.petals.boundingBox!.min.y).toBeGreaterThan(.01);
  expect(pieces.calyx.boundingBox!.min.y).toBe(0);
  expect(pieces.calyx.boundingBox!.max.y).toBeGreaterThan(.009);
  Object.values(pieces).forEach(geometry => geometry.dispose());
});

it("leaves true silhouette clefts between all five petals instead of a fused circular cup", () => {
  for (const detailed of [true, false]) {
    const pieces = createPeachBlossomGeometries(flower, detailed);
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const mesh = new Mesh(pieces.petals, material); mesh.updateMatrixWorld(true);
    for (let petal = 0; petal < 5; petal++) {
      const gap = (petal + .5) * Math.PI * 2 / 5;
      const ray = new Raycaster(new Vector3(Math.sin(gap) * flower.radius * .90, .3,
        Math.cos(gap) * flower.radius * .90), new Vector3(0, -1, 0));
      expect(ray.intersectObject(mesh)).toHaveLength(0);
      const tip = petal * Math.PI * 2 / 5;
      ray.set(new Vector3(Math.sin(tip) * flower.radius * .85, .3,
        Math.cos(tip) * flower.radius * .85), new Vector3(0, -1, 0));
      expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
    }
    material.dispose(); Object.values(pieces).forEach(geometry => geometry.dispose());
  }
});

it("reuses neutral maps and geometry across palettes without disposing another owner's resources", () => {
  const textures = createPeachPetalTextures();
  const pink = createPeachBlossomMaterials("#f49bb7", textures);
  const white = createPeachBlossomMaterials("#ffffff", textures);
  const geometries = createPeachBlossomGeometries({ ...flower, radius: 1 }, true);
  const disposed = vi.fn();
  textures.map.addEventListener("dispose", disposed);
  geometries.petals.addEventListener("dispose", disposed);
  const first = createPeachBlossomModel(flower, true, pink.materials, geometries);
  const second = createPeachBlossomModel({ ...flower, position: [1, 2, 3] }, true, white.materials, geometries);
  expect(pink.materials.petals.map).toBe(white.materials.petals.map);
  expect(pink.materials.petals.transparent).toBe(false);
  expect(pink.materials.petals.alphaTest).toBe(0);
  expect(pink.materials.petals.side).toBe(DoubleSide);
  expect(first.root.children[0]!.type).toBe("Mesh");
  expect(second.root.position.toArray()).toEqual([1, 2, 3]);
  first.dispose(); first.dispose(); pink.dispose();
  expect(disposed).not.toHaveBeenCalled();
  second.dispose(); white.dispose();
  Object.values(geometries).forEach(geometry => geometry.dispose()); textures.dispose(); textures.dispose();
  expect(disposed).toHaveBeenCalledTimes(2);
});

it("keeps original texture pixels neutral and opaque for every petal tint", () => {
  const pack = createPeachPetalTextures(), pixels = pack.map.image.data!;
  for (let at = 0; at < pixels.length; at += 4) {
    expect(pixels[at]).toBe(pixels[at + 1]); expect(pixels[at]).toBe(pixels[at + 2]);
    expect(pixels[at + 3]).toBe(255);
  }
  pack.dispose();
});
