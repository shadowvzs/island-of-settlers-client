import { Box3, Euler, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import { createFloweringPeachGraph } from "../src/render-common/plants/flowering-peach-graph";
import type { OrnamentalTreeGraph } from "../src/render-common/plants/ornamental-tree-graph";
import {
  createOrnamentalLeafGeometry
} from "../src/renderers/three/plants/ornamental-foliage-geometry";
import { createOrnamentalLeafTextures } from "../src/renderers/three/plants/ornamental-leaf-textures";
import { createOrnamentalShootGeometry } from "../src/renderers/three/plants/ornamental-shoot-geometry";
import { createPeachBlossomTreeTemplates } from "../src/renderers/three/plants/peach-blossom-tree-templates";
import { createPeachTreeMaterials } from "../src/renderers/three/plants/peach-tree-materials";
import {
  createFloweringPeachModel
} from "../src/renderers/three/plants/peach-tree-model";

const checkConnectedGraph = (graph: OrnamentalTreeGraph) => {
  for (let index = 0; index < graph.limbs.length; index++) {
    const limb = graph.limbs[index]!;
    if (limb.parent === null) continue;
    expect(limb.parent).toBeLessThan(index);
    const parent = graph.limbs[limb.parent]!;
    expect(parent.path.some(point => point.every((value, axis) => value === limb.path[0]![axis]))).toBe(true);
  }
};

describe("private adult peach candidates", () => {
  it("keeps distinct repeatable mature structures, connected woody joins and supported blossom anchors", () => {
    const profiles = [];
    for (const variant of [0, 1, 2]) {
      const graph = createFloweringPeachGraph(variant, true);
      expect(graph).toEqual(createFloweringPeachGraph(variant, true));
      checkConnectedGraph(graph);
      expect(graph.limbs.filter(limb => limb.role === "root")).toHaveLength(9);
      expect(graph.blossoms).toHaveLength(5376);
      expect(graph.pot).toBeUndefined();
      expect(graph.limbs[0]!.radius).toBeGreaterThan(.25);
      const twigs = graph.limbs.filter(limb => limb.role === "twig");
      for (let sample = 0; sample < graph.blossoms.length; sample += Math.ceil(graph.blossoms.length / 192)) {
        const flower = graph.blossoms[sample]!;
        const point = new Vector3(...flower.position);
        const supported = twigs.some(limb => {
          const start = new Vector3(...limb.path[1]!), end = new Vector3(...limb.path[2]!);
          const direction = end.clone().sub(start);
          const t = point.clone().sub(start).dot(direction) / direction.lengthSq();
          return t >= 0 && t <= 1 && start.addScaledVector(direction, t).distanceTo(point) < 1e-10;
        });
        expect(supported).toBe(true);
        const bearing = graph.limbs[graph.flowerBearings[sample]!]!;
        const axis = new Vector3(...bearing.path[2]!).sub(new Vector3(...bearing.path[1]!)).normalize();
        const normal = new Vector3(0, 1, 0).applyEuler(new Euler(flower.pitch, flower.yaw, 0, "YXZ"));
        expect(Math.abs(axis.dot(normal))).toBeLessThan(1e-10);
      }
      for (let index = 0; index < graph.blossoms.length; index += 2) {
        const first = graph.blossoms[index]!, second = graph.blossoms[index + 1]!;
        expect(first.position).toEqual(second.position);
        const direction = new Vector3(0, 1, 0).applyEuler(new Euler(first.pitch, first.yaw, 0, "YXZ"));
        const opposite = new Vector3(0, 1, 0).applyEuler(new Euler(second.pitch, second.yaw, 0, "YXZ"));
        expect(direction.dot(opposite)).toBeCloseTo(-1, 10);
        expect(first.radius).toBeGreaterThanOrEqual(.024); expect(first.radius).toBeLessThanOrEqual(.030);
      }
      profiles.push(graph.limbs[0]!.path);
    }
    expect(profiles[0]).not.toEqual(profiles[1]); expect(profiles[1]).not.toEqual(profiles[2]);
  });

  it.each([true, false])("keeps finite geometry and reports unapproved canonical peach budgets explicitly; High=%s", detailed => {
    const pack = createPeachTreeMaterials();
    try {
      for (const factory of [createFloweringPeachModel]) {
        for (const variant of [0, 1, 2]) {
          const model = factory(pack.materials, detailed, variant);
          try {
            expect(model.stagedBudgetPassed).toBe(false);
            // This is the explicitly unapproved close diagnostic model, not the normal 24k/6k production tier.
            expect(model.triangles).toBeLessThan(200000);
            expect(model.graph.blossoms).toHaveLength(5376);
            expect(model.root.children.length).toBeLessThanOrEqual(5);
            const box = new Box3().setFromObject(model.root);
            // Ground trees bury the root collar; pots retain their flat bearing at zero.
            expect(box.min.y).toBeGreaterThan(-.20);
            expect(box.max.y).toBeGreaterThan(5);
            expect(box.max.y).toBeLessThan(6.6);
            model.root.traverse(object => {
              if (!(object instanceof Mesh)) return;
              expect(Array.from(object.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
              expect(Array.from(object.geometry.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
            });
          } finally { model.dispose(); }
        }
      }
    } finally { pack.dispose(); }
  });

  it("has finite nondegenerate folded leaf faces", () => {
    for (const detailed of [true, false]) {
      const leaf = createOrnamentalLeafGeometry({ position: [0, 0, 0], yaw: 0, pitch: 0,
        roll: 0, length: .16, width: .04, seed: 1 }, detailed);
      for (const geometry of [leaf]) {
        const positions = geometry.getAttribute("position"), indices = geometry.index!;
        for (let index = 0; index < indices.count; index += 3) {
          const a = new Vector3().fromBufferAttribute(positions, indices.getX(index));
          const b = new Vector3().fromBufferAttribute(positions, indices.getX(index + 1));
          const c = new Vector3().fromBufferAttribute(positions, indices.getX(index + 2));
          expect(b.sub(a).cross(c.sub(a)).lengthSq()).toBeGreaterThan(1e-16);
        }
        geometry.dispose();
      }
    }
  });

  it("retains actual fine-shoot bearings and outward nondegenerate faces with14triangles", () => {
    const path: [number, number, number][] = [[0, 0, 0], [.10, .08, 0], [.20, .09, .03]];
    const geometry = createOrnamentalShootGeometry({ parent: 0, path,
      radius: .0036, tipRadius: .0009, role: "twig" });
    const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
    const indices = geometry.index!;
    expect(indices.count / 3).toBe(14);
    for (let ring = 0; ring < path.length; ring++) {
      const centre = new Vector3();
      for (let side = 0; side < 3; side++)
        centre.add(new Vector3().fromBufferAttribute(positions, ring * 3 + side));
      expect(centre.divideScalar(3).distanceTo(new Vector3(...path[ring]!))).toBeLessThan(1e-7);
    }
    for (let index = 0; index < indices.count; index += 3) {
      const a = new Vector3().fromBufferAttribute(positions, indices.getX(index));
      const b = new Vector3().fromBufferAttribute(positions, indices.getX(index + 1));
      const c = new Vector3().fromBufferAttribute(positions, indices.getX(index + 2));
      const face = b.sub(a).cross(c.sub(a));
      expect(face.lengthSq()).toBeGreaterThan(1e-15);
      if (index >= indices.count - 6) continue;
      const normal = new Vector3().fromBufferAttribute(normals, indices.getX(index));
      normal.add(new Vector3().fromBufferAttribute(normals, indices.getX(index + 1)));
      normal.add(new Vector3().fromBufferAttribute(normals, indices.getX(index + 2)));
      expect(face.dot(normal)).toBeGreaterThan(0);
    }
    geometry.dispose();
  });

  it("shares original midrib/secondary-vein colour and normal maps across bothLOD materials", () => {
    const textures = createOrnamentalLeafTextures();
    const pixels = textures.map.image.data as Uint8Array;
    const normals = textures.normalMap.image.data as Uint8Array;
    const width = textures.map.image.width, y = 128;
    const centre = (y * width + width / 2) * 4, edge = (y * width + 8) * 4;
    expect(pixels[centre]!).toBeGreaterThan(pixels[edge]! + 12);
    expect(new Set(pixels.filter((_, index) => index % 4 === 0)).size).toBeGreaterThan(30);
    expect(normals.some((value, index) => index % 4 === 0 && Math.abs(value - 128) > 10)).toBe(true);
    const colourReleased = vi.fn(), normalReleased = vi.fn();
    textures.map.addEventListener("dispose", colourReleased);
    textures.normalMap.addEventListener("dispose", normalReleased);
    textures.dispose(); textures.dispose();
    expect(colourReleased).toHaveBeenCalledTimes(1); expect(normalReleased).toHaveBeenCalledTimes(1);
  });

  it("shares neutral flower buffers across palette instances and frees only owned buffers once", () => {
    const pack = createPeachTreeMaterials(), owner = createPeachBlossomTreeTemplates(false);
    const alternate = owner.materials.petals.clone(); alternate.color.set("#fff5ec");
    const otherTemplates = { ...owner, materials: { ...owner.materials, petals: alternate } };
    const model = createFloweringPeachModel(pack.materials, false, 0, owner);
    const other = createFloweringPeachModel(pack.materials, false, 0, otherTemplates);
    const originalFlower = model.root.getObjectByName("peach-petals") as Mesh;
    const otherFlower = other.root.getObjectByName("peach-petals") as Mesh;
    expect(originalFlower.geometry).toBe(otherFlower.geometry);
    expect((originalFlower.material as MeshStandardMaterial).color.equals(alternate.color)).toBe(false);
    const geometryDisposed = vi.fn(), materialDisposed = vi.fn(), textureDisposed = vi.fn();
    originalFlower.geometry.addEventListener("dispose", geometryDisposed);
    pack.materials.bark.addEventListener("dispose", materialDisposed);
    pack.materials.bark.map!.addEventListener("dispose", textureDisposed);
    model.dispose(); model.dispose(); expect(geometryDisposed).not.toHaveBeenCalled();
    expect(other.root.children.length).toBeGreaterThan(0); other.dispose();
    owner.dispose(); owner.dispose(); alternate.dispose();
    expect(geometryDisposed).toHaveBeenCalledTimes(1); expect(materialDisposed).not.toHaveBeenCalled();
    pack.dispose(); pack.dispose();
    expect(materialDisposed).toHaveBeenCalledTimes(1); expect(textureDisposed).toHaveBeenCalledTimes(1);
  });
});
