import {
  BoxGeometry,
  DataTexture,
  InstancedMesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Scene
} from "three";
import { describe, expect, it } from "vitest";

import { createRoadDecorationShadowCasters } from "../src/renderers/three/settlement/road-decoration-shadow-casters";
import { createThreeRoadDecorations } from "../src/renderers/three/settlement/three-road-decorations";
import { SHADOW_CASTER_LAYER, SHADOW_NEAR_CASTER_LAYER } from "../src/renderers/three/three-shadows";
import type { RoadDecorationFrame } from "../src/shared/settlement/road-decoration-state";
import { createPlainBuildingMaterials } from "./helpers/building-materials";
import { huntingWorld } from "./helpers/hunting-world";

const batchMesh = (material = new MeshStandardMaterial(), castShadow = true) => {
  const mesh = Object.assign(new InstancedMesh(new BoxGeometry(), material, 8), { castShadow });
  mesh.count = 3;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
};

const twins = (scene: Scene) => scene.children[0]!.children as InstancedMesh[];

describe("D07b decoration sun casters", () => {
  it("adds a near-layer depth twin that shares geometry, matrices and bounds", () => {
    const scene = new Scene(), casters = createRoadDecorationShadowCasters(scene);
    const mesh = batchMesh();
    casters.add(mesh);
    casters.add(mesh);
    const [twin] = twins(scene);
    expect(twins(scene)).toHaveLength(1);
    expect(twin!.geometry).toBe(mesh.geometry);
    expect(twin!.instanceMatrix).toBe(mesh.instanceMatrix);
    expect(twin!.count).toBe(3);
    expect(twin!.boundingSphere).toBe(mesh.boundingSphere);
    expect(twin!.layers.isEnabled(SHADOW_NEAR_CASTER_LAYER)).toBe(true);
    expect(twin!.layers.isEnabled(0)).toBe(false);
    expect(twin!.layers.isEnabled(SHADOW_CASTER_LAYER)).toBe(false);
    mesh.count = 5;
    casters.sync(mesh);
    expect(twin!.count).toBe(5);
    expect(casters.statistics()).toEqual({ casterInstances: 5, casterMeshes: 1 });
    casters.remove(mesh);
    expect(twins(scene)).toHaveLength(0);
    casters.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it("skips non-casting, overview and see-through batches", () => {
    const scene = new Scene(), casters = createRoadDecorationShadowCasters(scene);
    const overview = batchMesh();
    overview.userData.plantOverview = true;
    casters.add(batchMesh(undefined, false));
    casters.add(overview);
    casters.add(batchMesh(new MeshStandardMaterial({ opacity: .5, transparent: true })));
    expect(twins(scene)).toHaveLength(0);
    casters.dispose();
  });

  it("uses the part's depth twin, a cached cut-out depth, else one shared solid depth", () => {
    const scene = new Scene(), casters = createRoadDecorationShadowCasters(scene);
    const custom = new MeshDepthMaterial(), withDepth = batchMesh();
    withDepth.customDepthMaterial = custom;
    const leaf = new MeshStandardMaterial({ alphaTest: .4, map: new DataTexture() });
    const solids = [batchMesh(), batchMesh()], cutouts = [batchMesh(leaf), batchMesh(leaf)];
    for (const mesh of [withDepth, ...solids, ...cutouts]) casters.add(mesh);
    const [first, second, third, fourth, fifth] = twins(scene).map(twin => twin.material);
    expect(first).toBe(custom);
    expect(second).toBeInstanceOf(MeshBasicMaterial);
    expect(third).toBe(second);
    expect(fourth).toBeInstanceOf(MeshDepthMaterial);
    expect(fifth).toBe(fourth);
    expect((fourth as MeshDepthMaterial).alphaTest).toBe(.4);
    expect((fourth as MeshDepthMaterial).map).toBe(leaf.map);
    casters.dispose();
  });

  it("mirrors the detailed decoration batches into the shadow scene and clears them on removal", async () => {
    const world = huntingWorld(); world.fogDisplayDisabled = true;
    const materials = createPlainBuildingMaterials(), scene = new Scene();
    const owner = createThreeRoadDecorations(world, true, () => materials, undefined, undefined, true, scene);
    const frame: RoadDecorationFrame = { uid: 1, item: "roadDecoration:indigenous-flower-pot:native",
      position: [5, 2, 5], supports: [], volumes: [], yaw: 0 };
    try {
      owner.update([frame]); await owner.ready();
      const casting = (owner.root.children as InstancedMesh[]).filter(mesh => mesh.castShadow);
      expect(casting.length).toBeGreaterThan(0);
      expect(twins(scene).map(twin => twin.instanceMatrix))
        .toEqual(expect.arrayContaining([casting[0]!.instanceMatrix]));
      expect(owner.statistics().casterInstances).toBeGreaterThan(0);
      owner.update([]);
      expect(twins(scene)).toHaveLength(0);
      owner.dispose();
      expect(scene.children).toHaveLength(0);
    } finally { owner.dispose(); Object.values(materials).forEach(material => material.dispose()); }
  });
});
