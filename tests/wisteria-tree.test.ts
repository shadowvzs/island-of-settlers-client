import { readFileSync } from "node:fs";
import { Box3, DataTexture, DoubleSide, Mesh, type MeshStandardMaterial, Object3D, RGBAFormat, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import { createWisteriaTreeGraph, wisteriaTreeBounds, wisteriaTreeClearanceVolumes } from "../src/render-common/plants/wisteria-tree-graph";
import { roadDecorationClearance } from "../src/render-common/road-decoration-clearance";
import { ornamentalDecorationProfile } from "../src/renderers/three/plants/ornamental-decoration-profile";
import { createWisteriaTreeFloretGeometry, createWisteriaTreePedicel, reducedWisteriaTreeFlowers,
  wisteriaTreeFloretBearing } from "../src/renderers/three/plants/wisteria-tree-florets";
import { createWisteriaTreeBakeSource, createWisteriaTreeMaterials, createWisteriaTreeModel, WISTERIA_TREE_BUDGET } from "../src/renderers/three/plants/wisteria-tree-model";
import { wisteriaAtlasUV } from "../src/renderers/three/wisteria-botanical-atlas";
import type { WisteriaLodAtlasMetadata } from "../src/renderers/three/wisteria-lod-atlas";
import { WISTERIA_BANNER_OUTLINE } from "../src/renderers/three/wisteria-petal-sheets";
import { getRoadDecoration } from "../src/shared/settlement/road-decoration-catalog";

const atlasMetadata = JSON.parse(readFileSync(new URL(
  "../assets/botanical-textures/wisteria-tree-lod-albedo.json", import.meta.url), "utf8")) as
  WisteriaLodAtlasMetadata;
const testPack = (detailed: boolean) => {
  // Geometry/lifecycle tests do not substitute this solid pixel for the actual artwork in captures.
  const atlas = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat);
  const tissue = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat);
  return createWisteriaTreeMaterials(detailed, atlas, atlasMetadata, tissue);
};

describe("standalone Wisteria tree", () => {
  it("bakes the same eleven dimensional florets used by representative High clusters", () => {
    const pack = testPack(true), source = createWisteriaTreeBakeSource(pack);
    try {
      expect(source.flowers.filter(flower => !flower.bud)).toHaveLength(11);
      expect(source.flowers.filter(flower => flower.bud)).toHaveLength(1);
      expect(source.leaves).toHaveLength(13);
      expect(source.raceme.children.some(node => node.name === "wisteria_tree_reduced_individual_florets")).toBe(true);
      expect(source.raceme.children.some(node => node.name === "wisteria_tree_reduced_terminal_buds")).toBe(true);
    } finally { source.dispose(); pack.dispose(); }
  });

  it("roots three twined stems and supports every raceme/compound leaf on actual parent control points", () => {
    for (let variant = 0; variant < 3; variant++) {
      const graph = createWisteriaTreeGraph(variant);
      expect(graph.species).toBe("wisteria-tree");
      expect(graph.limbs.filter(limb => limb.role === "trunk")).toHaveLength(3);
      expect(graph.racemeBearings).toHaveLength(128);
      expect(graph.sprayBearings).toHaveLength(288);
      expect(graph.flowers).toHaveLength(3200);
      expect(graph.leaves).toHaveLength(3744);
      for (const limb of graph.limbs) {
        if (limb.parent === null) continue;
        expect(graph.limbs[limb.parent]!.path).toContainEqual(limb.path[0]);
      }
      for (let trunk = 0; trunk < 3; trunk++)
        expect(graph.limbs.some(limb => limb.parent === trunk &&
          JSON.stringify(limb.path[0]) === JSON.stringify(graph.limbs[trunk]!.path.at(-1)))).toBe(true);
      for (const bearing of graph.racemeBearings) {
        const anchor = graph.limbs[bearing.limb]!.path[bearing.point]!;
        expect(bearing.origin).toEqual([anchor[0], anchor[1] - .025, anchor[2]]);
        expect(bearing.length).toBeGreaterThanOrEqual(.36);
        expect(bearing.length).toBeLessThan(.57);
      }
      for (const bearing of graph.sprayBearings)
        expect(bearing.origin).toEqual(graph.limbs[bearing.limb]!.path[bearing.point]);
      for (let spray = 0; spray < 288; spray++)
        expect(graph.leaves.filter(leaf => leaf.spray === spray)).toHaveLength(13);
    }
  });

  it("keeps all near/far meshes inside one conservative mature-tree reservation without a pot or frame", () => {
    for (const detailed of [true, false]) {
      const pack = testPack(detailed);
      try {
        for (let variant = 0; variant < 3; variant++) {
          const reserved = wisteriaTreeBounds(variant);
          const definition = getRoadDecoration(`wisteria-tree-${variant}`)!;
          expect(definition.wisteriaTreeVariant).toBe(variant);
          const clearance = roadDecorationClearance(definition);
          expect(clearance.volumes).toEqual(wisteriaTreeClearanceVolumes(variant));
          expect(clearance.supports).toHaveLength(1);
          expect(clearance.supports[0]!.max[0] - clearance.supports[0]!.min[0]).toBeLessThan(1.7);
          const volumes = [...clearance.volumes].reverse();
          expect(reserved.max[1]).toBeGreaterThan(3);
          expect(reserved.max[1]).toBeLessThan(5);
          for (const tier of ["near", "far"] as const) {
            const model = createWisteriaTreeModel(pack, detailed, variant, tier);
            expect(model.root.children.length).toBeGreaterThanOrEqual(2);
            expect(model.root.children.every(child => child instanceof Mesh)).toBe(true);
            const bounds = new Box3().setFromObject(model.root);
            expect(bounds.min.y).toBeGreaterThanOrEqual(-1e-7);
            for (const axis of ["x", "y", "z"] as const) {
              const index = ["x", "y", "z"].indexOf(axis);
              expect(bounds.min[axis]).toBeGreaterThanOrEqual(reserved.min[index]! - 1e-5);
              expect(bounds.max[axis]).toBeLessThanOrEqual(reserved.max[index]! + 1e-5);
            }
            expect(model.triangles).toBeLessThanOrEqual(
              tier === "far" ? WISTERIA_TREE_BUDGET.far : WISTERIA_TREE_BUDGET[detailed ? "high" : "minimal"]);
            const profile = ornamentalDecorationProfile(`roadDecoration:wisteria-tree-${variant}:native`, detailed)!;
            expect(model.triangles).toBeLessThanOrEqual(tier === "near" ? profile.cost : profile.farCost);
            expect(model.counts.racemes).toBe(128);
            expect(model.counts.compoundLeaves).toBe(288);
            let realRacemes = detailed ? 128 : 3;
            if (tier === "far") realRacemes = 0;
            expect(model.counts.realRacemes).toBe(realRacemes);
            for (const child of model.root.children) {
              const positions = (child as Mesh).geometry.getAttribute("position");
              for (let vertex = 0; vertex < positions.count; vertex++) {
                const x = positions.getX(vertex), y = positions.getY(vertex), z = positions.getZ(vertex);
                const covered = volumes.some(volume => x >= volume.min[0] - 1e-5 && x <= volume.max[0] + 1e-5 &&
                  y >= volume.min[1] - 1e-5 && y <= volume.max[1] + 1e-5 &&
                  z >= volume.min[2] - 1e-5 && z <= volume.max[2] + 1e-5);
                expect(covered).toBe(true);
              }
            }
            model.dispose();
          }
        }
      } finally { pack.dispose(); }
    }
  });

  it("models every High near raceme without aggregate cards while preserving canonical flower positions", () => {
    const graph = createWisteriaTreeGraph(0), full = new Set([0, 1]);
    const flowers = reducedWisteriaTreeFlowers(graph, full);
    for (let cluster = 0; cluster < 128; cluster++) {
      const represented = flowers.filter(flower => flower.cluster === cluster);
      if (full.has(cluster)) { expect(represented).toHaveLength(0); continue; }
      expect(represented.filter(flower => !flower.bud)).toHaveLength(11);
      expect(represented.filter(flower => flower.bud)).toHaveLength(1);
      for (const flower of represented) expect(graph.flowers).toContain(flower);
    }
    const geometry = createWisteriaTreeFloretGeometry();
    expect(geometry.index!.count / 3).toBe(10);
    expect(geometry.boundingBox!.max.z - geometry.boundingBox!.min.z).toBeGreaterThan(.4);
    const uv = geometry.getAttribute("uv"), indices = geometry.index!.array;
    for (const sourcePoint of WISTERIA_BANNER_OUTLINE) {
      const target = wisteriaAtlasUV("banner", (sourcePoint[0] + .48) / .96, (sourcePoint[1] - .06) / .59);
      let covered = false;
      for (let face = 0; face < 7; face++) {
        const vertices = [indices[face * 3]!, indices[face * 3 + 1]!, indices[face * 3 + 2]!];
        const signs = vertices.map((vertex, edge) => {
          const next = vertices[(edge + 1) % 3]!;
          return (uv.getX(next) - uv.getX(vertex)) * (target[1] - uv.getY(vertex)) -
            (uv.getY(next) - uv.getY(vertex)) * (target[0] - uv.getX(vertex));
        });
        if (signs.every(value => value >= -1e-7) || signs.every(value => value <= 1e-7)) covered = true;
      }
      expect(covered).toBe(true);
    }
    const transform = new Object3D();
    for (const flower of flowers.filter(flower => !flower.bud)) {
      transform.position.set(...flower.position); transform.rotation.set(flower.tilt ?? .8, flower.yaw, 0);
      transform.scale.setScalar(flower.scale); transform.updateMatrix();
      const tissue = new Vector3().fromBufferAttribute(geometry.getAttribute("position"), 1).applyMatrix4(transform.matrix);
      const contact = wisteriaTreeFloretBearing(flower);
      expect(contact.distanceTo(tissue)).toBeLessThan(1e-7);
      const stem = createWisteriaTreePedicel(flower.clusterOrigin!, [contact.x, contact.y, contact.z], .00065)!;
      expect(stem.index!.count / 3).toBe(1);
      expect(new Vector3().fromBufferAttribute(stem.getAttribute("position"), 1).distanceTo(tissue)).toBeLessThan(1e-6);
      stem.dispose();
    }
    geometry.dispose();
    const pack = testPack(true), probe = pack.distant.instantiate([], []);
    expect(pack.real.materials.calyx.side).toBe(DoubleSide);
    const aggregateMap = ((probe.root.children[0] as Mesh).material as MeshStandardMaterial).map;
    probe.dispose();
    const model = createWisteriaTreeModel(pack, true);
    try {
      expect(model.counts.realRacemes).toBe(128);
      expect(model.counts.fullRacemes).toBe(2);
      for (const child of model.root.children)
        expect(((child as Mesh).material as MeshStandardMaterial).map).not.toBe(aggregateMap);
    } finally { model.dispose(); pack.dispose(); }
  });

  it("preserves baked botanical colours in flat instancing surfaces and releases owned resources exactly once", () => {
    const pack = testPack(true), model = createWisteriaTreeModel(pack, true);
    const geometryDisposals = model.root.children.map(child => {
      const geometry = (child as Mesh).geometry, dispose = vi.fn(); geometry.addEventListener("dispose", dispose);
      return dispose;
    });
    for (const child of model.root.children) {
      const mesh = child as Mesh;
      expect(Array.isArray(mesh.material)).toBe(false);
      expect((mesh.material as { vertexColors: boolean }).vertexColors).toBe(true);
      expect(mesh.geometry.getAttribute("color")).toBeDefined();
      expect(mesh.position.equals(new Vector3())).toBe(true);
    }
    const materialDisposed = vi.fn();
    pack.real.materials.bark.addEventListener("dispose", materialDisposed);
    model.dispose(); model.dispose();
    for (const count of geometryDisposals) expect(count).toHaveBeenCalledTimes(1);
    expect(materialDisposed).not.toHaveBeenCalled();
    pack.dispose(); pack.dispose();
    expect(materialDisposed).toHaveBeenCalledTimes(1);
  });
});
