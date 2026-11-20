import { readFileSync } from "node:fs";
import { DataTexture, InstancedMesh, MeshBasicMaterial, OrthographicCamera, Raycaster, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import { getRoadDecorationItem, type RoadDecorationItemId } from "../../island-of-settlers-shared/src/road-decoration-items";
import { ornamentalPlantUsesCanonicalIcon } from "../../island-of-settlers-shared/src/road-plant-models";
import { ornamentalDecorationProfile } from "../src/renderers/three/plants/ornamental-decoration-profile";
import { createDecorationAssetLoader } from "../src/renderers/three/road-decoration-asset-loader";
import { createThreeRoadDecorations } from "../src/renderers/three/settlement/three-road-decorations";
import { createRoadDecorationState } from "../src/shared/settlement/road-decoration-state";
import type { WorldData } from "../src/shared/world/world-data";

vi.mock("../src/renderers/three/plants/ornamental-plant-overview", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/renderers/three/plants/ornamental-plant-overview")>();
  return { ...actual, createOrnamentalPlantOverview: (asset: Parameters<typeof actual.createOrnamentalPlantOverview>[0],
    active: () => boolean) => actual.createOrnamentalPlantOverview(asset, active, {
    // Real checked-in calibrated metadata; pixels are injected for a GPU/network-free routing test.
    loadManifest: async () => JSON.parse(readFileSync("public/icons/road-decorations/ornamental-overview.json", "utf8")),
    loadTexture: async () => new DataTexture()
  }) };
});

it.each([true, false])("routes only willow far through its calibrated actual icon and leaves close geometry intact; High=%s", async detailed => {
  const loader = createDecorationAssetLoader(() => { throw new Error("Independent botanical materials expected"); }, detailed);
  for (const variant of [0, 1, 2]) {
    const id = `roadDecoration:plant-compact-willow-standalone-ground-${variant}:native` as RoadDecorationItemId;
    const item = getRoadDecorationItem(id)!;
    expect(ornamentalPlantUsesCanonicalIcon(item.plant, "far")).toBe(true);
    expect(ornamentalPlantUsesCanonicalIcon(item.plant, "near")).toBe(false);
    expect(ornamentalDecorationProfile(id, detailed)?.farCost).toBe(2);
    const near = (await loader(id, `${id}:near`, () => true, "near"))!;
    const far = (await loader(id, `${id}:far`, () => true, "far"))!;
    try {
      expect(near.triangles).toBeGreaterThan(2000);
      expect(far.triangles).toBe(2);
      expect(far.root.getObjectByName("canonical-plant-overview")).toBeDefined();
    } finally { near.dispose(); far.dispose(); }
  }
  const cypress = getRoadDecorationItem("roadDecoration:plant-columnar-cypress-roadside-ground-0:native")!;
  expect(ornamentalPlantUsesCanonicalIcon(cypress.plant, "far")).toBe(false);
});

it("marks the actual willow far batch as a camera-facing lit billboard and retains placed UID picking", async () => {
  const state = createRoadDecorationState(() => ({ nation: "roman", roads: [], heightAt: () => 0,
    isOwned: () => true, isFree: () => true }));
  const item = "roadDecoration:plant-compact-willow-standalone-ground-0:native";
  expect(state.place({ item, position: { x: 10, z: 10 }, yaw: Math.PI / 2 }, () => true).ok).toBe(true);
  const world = { cellsX: 32, cellsZ: 32, fogDisplayDisabled: true, fogRevision: 0 } as WorldData;
  const owner = createThreeRoadDecorations(world, true, () => { throw new Error("No national maps"); });
  const camera = new OrthographicCamera(-30, 30, 26, -26, .1, 2000);
  camera.position.set(25, 12, 35); camera.lookAt(10, 2, 10); camera.updateProjectionMatrix();
  try {
    owner.update(state.frames(), camera, 900); await owner.ready();
    expect(owner.statistics().instances).toBe(1); expect(owner.statistics().errors).toBe(0);
    const meshes = owner.root.children as InstancedMesh[];
    expect(meshes).toHaveLength(1);
    expect(meshes[0]!.userData.plantOverview).toBe(true);
    expect(meshes[0]!.material).toBeInstanceOf(MeshBasicMaterial);
    expect(meshes[0]!.geometry.index!.count).toBe(6);
    expect(owner.pick(new Raycaster(new Vector3(10, 20, 10), new Vector3(0, -1, 0)))?.uid).toBe(1);
  } finally { owner.dispose(); }
});
