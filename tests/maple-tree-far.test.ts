import { Box3, DataTexture, Mesh, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import { createMapleTreeGraph } from "../src/render-common/plants/maple-tree-graph";
import { createMapleTreeMaterials, createMapleTreeTemplate } from "../src/renderers/three/plants/maple-tree-model";

it("retains every canonical distant leaf pose while bounding the whole tree to2116triangles", () => {
  for (const detailed of [true, false]) for (let variant = 0; variant < 3; variant++) {
    const pack = createMapleTreeMaterials(detailed);
    const template = createMapleTreeTemplate(pack, detailed, variant, "far");
    const model = template.create();
    expect(template.graph).toEqual(createMapleTreeGraph(variant, false));
    expect(template.graph.leaves).toHaveLength(764);
    expect(template.counts).toEqual({ bark: 588, foliage: 1528 });
    expect(template.triangles).toBe(2116);
    expect(model.root.children).toHaveLength(2);
    expect(model.root.children.every(child => child instanceof Mesh)).toBe(true);
    for (const mesh of model.root.children as Mesh[]) {
      expect(Array.from(mesh.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
      expect(mesh.geometry.boundingBox!.max.y).toBeGreaterThan(4);
    }
    model.dispose(); template.dispose(); pack.dispose();
  }
});

it("bounds transparent card corners within one original leaf width of the mature silhouette", () => {
  for (let variant = 0; variant < 3; variant++) {
    const pack = createMapleTreeMaterials(false), near = createMapleTreeTemplate(pack, false, variant);
    const far = createMapleTreeTemplate(pack, false, variant, "far");
    const fullModel = near.create(), cheapModel = far.create();
    // Transparent quad corners extend outside the lobed outline; actual canonical clearance
    // reserves the whole leaf length+width independently of this renderer-only representation.
    const leafWidth = Math.max(...far.graph.leaves.map(leaf => leaf.width));
    const bounds = new Box3().setFromObject(fullModel.root).expandByScalar(leafWidth);
    const point = new Vector3();
    for (const mesh of cheapModel.root.children as Mesh[]) {
      const positions = mesh.geometry.getAttribute("position");
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index);
        expect(bounds.containsPoint(point)).toBe(true);
      }
    }
    fullModel.dispose(); cheapModel.dispose(); near.dispose(); far.dispose(); pack.dispose();
  }
});

it("uses the original palmate outline and shared veins, with lazy owned alpha only for far leaves", () => {
  const pack = createMapleTreeMaterials(), near = createMapleTreeTemplate(pack, true);
  const far = createMapleTreeTemplate(pack, true, 0, "far");
  const nearModel = near.create(), first = far.create(), second = far.create("red");
  const material = pack.farLeaves("yellow"), red = pack.farLeaves("red");
  expect(pack.leaves.material("yellow").alphaMap).toBeNull();
  expect(material.map).toBe(pack.leaves.map); expect(material.normalMap).toBe(pack.leaves.normalMap);
  expect(material.alphaMap).toBe(red.alphaMap); expect(material.transparent).toBe(false);
  const alpha = material.alphaMap! as DataTexture;
  const data = alpha.image.data as Uint8Array;
  const pixel = (u: number, v: number) => data[(Math.floor(v * 256) * 256 + Math.floor(u * 256)) * 4 + 1]!;
  expect(pixel(.5, .05)).toBe(255); // Actual petiole remains attached.
  expect(pixel(.5, .9)).toBe(255); // Central lobe.
  expect(pixel(.1, .9)).toBe(0); // Not a rectangular card or an oval elm leaf.
  expect(pixel(.1, .4)).toBe(255); // Side lobe.
  let coverage = 0;
  for (let at = 1; at < data.length; at += 4) coverage += data[at]!;
  // The final averaged mip must survive the cutoff, otherwise distant whole crowns disappear.
  expect(coverage / (256 * 256 * 255)).toBeGreaterThan(material.alphaTest);
  const alphaDisposed = vi.fn(), materialDisposed = vi.fn();
  alpha.addEventListener("dispose", alphaDisposed); material.addEventListener("dispose", materialDisposed);
  first.dispose(); second.dispose(); far.dispose(); nearModel.dispose(); near.dispose();
  expect(alphaDisposed).not.toHaveBeenCalled();
  pack.dispose(); pack.dispose();
  expect(alphaDisposed).toHaveBeenCalledOnce(); expect(materialDisposed).toHaveBeenCalledOnce();
  expect(alpha.image.data).toBeNull();
});
