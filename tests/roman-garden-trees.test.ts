import { Box3, CatmullRomCurve3, Euler, Mesh, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { createRomanGardenTreeGraph } from "../src/render-common/plants/roman-garden-tree-graph";
import { createRomanGardenTreeMaterials, createRomanGardenTreeModel } from
  "../src/renderers/three/plants/roman-garden-tree-model";
import { createWillowPetioleGeometry } from "../src/renderers/three/plants/willow-tree-geometry";

describe("premium willow and Roman cypress physical models", () => {
  it("keeps every actual vertex inside the canonical species envelope at every LOD", () => {
    for (const species of ["willow-tree", "cypress-tree"] as const) {
      const materials = createRomanGardenTreeMaterials(species);
      for (const detailed of [true, false]) for (const tier of ["near", "far"] as const)
        for (let variant = 0; variant < 3; variant++) {
          const model = createRomanGardenTreeModel(materials, species, detailed, variant, tier);
          const bounds = new Box3().setFromObject(model.root);
          const radius = species === "willow-tree" ? 1.95 : .48;
          const height = species === "willow-tree" ? 4.9275 : 4.8;
          let cap = detailed ? 24000 : 6000;
          if (tier === "far") cap = 1800;
          expect(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x),
            Math.abs(bounds.min.z), Math.abs(bounds.max.z))).toBeLessThanOrEqual(radius);
          expect(bounds.max.y).toBeLessThanOrEqual(height);
          expect(bounds.min.y).toBeLessThan(0);
          expect(model.triangles).toBeLessThanOrEqual(cap);
          expect(model.root.children).toHaveLength(2);
          model.root.traverse(object => {
            if (!(object instanceof Mesh)) return;
            const positions = object.geometry.getAttribute("position");
            const normals = object.geometry.getAttribute("normal");
            for (let index = 0; index < positions.count; index++) {
              expect(Number.isFinite(positions.getX(index) + positions.getY(index) + positions.getZ(index))).toBe(true);
              expect(new Vector3().fromBufferAttribute(normals, index).length()).toBeCloseTo(1, 4);
            }
          });
          model.dispose();
        }
      materials.dispose();
    }
  });

  it("builds drooping willow shoots and botanical scale fans rather than alpha rectangles", () => {
    const willow = createRomanGardenTreeGraph("willow-tree", true, 0);
    const cypress = createRomanGardenTreeGraph("cypress-tree", true, 0);
    expect(willow.limbs.filter(limb => limb.role === "twig" &&
      limb.path[0]![1] - limb.path.at(-1)![1] > .8).length).toBe(81);
    expect(willow.leaves.length).toBe(1185);
    expect(cypress.leaves.length).toBe(1701);
    for (const species of ["willow-tree", "cypress-tree"] as const) {
      const pack = createRomanGardenTreeMaterials(species);
      expect(pack.foliage.alphaTest).toBe(0);
      expect(pack.foliage.transparent).toBe(false);
      const model = createRomanGardenTreeModel(pack, species, true);
      const foliage = model.root.children[1] as Mesh;
      const bounds = new Box3().setFromObject(foliage);
      expect(bounds.getSize(new Vector3()).y).toBeGreaterThan(2);
      model.dispose(); pack.dispose();
    }
  });

  it("retains distinct original bark palettes, detailed veins and deterministic structural variants", () => {
    const willow = createRomanGardenTreeMaterials("willow-tree");
    const cypress = createRomanGardenTreeMaterials("cypress-tree");
    expect((willow.bark.map!.image as { data: Uint8Array }).data).not.toEqual((cypress.bark.map!.image as { data: Uint8Array }).data);
    expect((willow.foliage.map!.image as { data: Uint8Array }).data).not.toEqual((cypress.foliage.map!.image as { data: Uint8Array }).data);
    for (const species of ["willow-tree", "cypress-tree"] as const) {
      expect(createRomanGardenTreeGraph(species, true, 1)).toEqual(createRomanGardenTreeGraph(species, true, 1));
      expect(createRomanGardenTreeGraph(species, true, 1).limbs)
        .not.toEqual(createRomanGardenTreeGraph(species, true, 0).limbs);
    }
    willow.dispose(); cypress.dispose();
  });

  it("keeps close cypress scales smoothly shaded instead of constant square pixel cells", () => {
    const materials = createRomanGardenTreeMaterials("cypress-tree");
    const image = materials.foliage.map!.image as { data: Uint8Array; height: number; width: number };
    let flat = 0, adjacent = 0;
    for (let y = 0; y < image.height; y++) for (let x = 1; x < image.width; x++) {
      const index = (y * image.width + x) * 4;
      if (image.data[index] === image.data[index - 4]) flat++;
      adjacent++;
    }
    expect(flat / adjacent).toBeLessThan(.50);
    materials.dispose();
  });

  it("joins each willow leaf through a real modeled petiole to the exact bearing spline", () => {
    for (const detailed of [true, false]) for (const variant of [0, 1, 2]) {
      const graph = createRomanGardenTreeGraph("willow-tree", detailed, variant);
      const curves = graph.limbs.map(limb => new CatmullRomCurve3(limb.path.map(point => new Vector3(...point))));
      for (const leaf of graph.leaves) {
        const petiole = leaf.petiole!;
        expect(petiole).toBeDefined();
        const node = curves[petiole.limb]!.getPoint(petiole.parameter);
        expect(node.distanceTo(new Vector3(...petiole.node))).toBeLessThan(1e-10);
        const direction = new Vector3(...leaf.position).sub(node);
        expect(direction.length()).toBeGreaterThan(.031);
        expect(direction.length()).toBeLessThan(.047);
        const bladeAxis = new Vector3(0, 0, 1).applyEuler(new Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ"));
        expect(direction.normalize().dot(bladeAxis)).toBeCloseTo(1, 9);
      }
      for (const leaf of [graph.leaves[0]!, graph.leaves.at(-1)!]) {
        const stem = createWillowPetioleGeometry(leaf)!;
        expect(stem.index!.count / 3).toBe(6);
        const start = new Vector3(...leaf.petiole!.node), end = new Vector3(...leaf.position);
        const axis = end.clone().sub(start).normalize();
        const positions = stem.getAttribute("position");
        const along = Array.from({ length: positions.count }, (_, index) =>
          new Vector3().fromBufferAttribute(positions, index).sub(start).dot(axis));
        expect(Math.min(...along)).toBeCloseTo(0, 6);
        expect(Math.max(...along)).toBeCloseTo(start.distanceTo(end), 6);
        stem.dispose();
      }
    }
  });
});
