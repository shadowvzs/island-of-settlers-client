import { OrthographicCamera } from "three";
import { expect, it } from "vitest";

import {
  type RoadDecorationItemId, roadDecorationItemIdsReleasedBy, roadDecorationItemsTagged
} from "../../island-of-settlers-shared/src/road-decoration-items";
import { ornamentalDecorationProfile } from "../src/renderers/three/plants/ornamental-decoration-profile";
import { createOrnamentalPlantLod } from "../src/renderers/three/plants/ornamental-plant-lod";
import { createRoadDecorationTemplates } from "../src/renderers/three/road-decoration-templates";
import type { RoadDecorationFrame } from "../src/shared/settlement/road-decoration-state";

it.each([true, false])("bounds staged structures and wooden lanterns inside the same plant budget and distinct tier caches; High=%s", detailed => {
  const additions = roadDecorationItemsTagged("addition"), released = roadDecorationItemIdsReleasedBy("decoration");
  const ids = Object.keys(additions) as RoadDecorationItemId[];
  expect(ids).toHaveLength(17);
  const templates = createRoadDecorationTemplates(() => { throw new Error("No national maps during metadata selection"); }, detailed);
  for (const id of ids) {
    expect(additions[id]!.shopAvailable).toBe(released.has(id));
    expect(new Set(["near", "far", "overview"].map(tier =>
      templates.keyFor(id, tier as "near" | "far" | "overview"))).size).toBe(3);
  }
  const frames: RoadDecorationFrame[] = Array.from({ length: 1000 }, (_, uid) => ({
    uid, item: ids[uid % ids.length]!, position: [uid % 32 * 8, 0, Math.floor(uid / 32) * 8], yaw: uid * .17,
    volumes: [{ min: [uid % 32 * 8 - 2, 0, Math.floor(uid / 32) * 8 - 2],
      max: [uid % 32 * 8 + 2, 5, Math.floor(uid / 32) * 8 + 2] }], supports: []
  }));
  const camera = new OrthographicCamera(-20, 20, 18, -18, .1, 2000);
  camera.position.set(140, 80, 220); camera.lookAt(120, 0, 120); camera.updateProjectionMatrix();
  const lod = createOrnamentalPlantLod(detailed); lod.update(frames, camera, 900);
  let triangles = 0, nearTriangles = 0, overview = 0;
  for (const frame of frames) {
    const profile = ornamentalDecorationProfile(frame.item, detailed)!;
    expect(profile).toBeDefined();
    const tier = lod.tierFor(frame.uid);
    let cost = 2;
    if (tier === "near") { cost = profile.cost; nearTriangles += cost; }
    if (tier === "far") cost = profile.farCost;
    if (tier === "overview") overview++;
    triangles += cost;
  }
  expect(triangles).toBeLessThanOrEqual(detailed ? 100000 : 60000);
  expect(nearTriangles).toBeLessThanOrEqual(detailed ? 60000 : 24000);
  expect(overview).toBeGreaterThan(900);
  templates.dispose(); lod.dispose();
});

it("fits two detailed Wisteria trees without raising shared budgets or the arch allowance", () => {
  const item = "roadDecoration:wisteria-tree-0:native" as const;
  const profile = ornamentalDecorationProfile(item, true)!;
  expect(profile.cost).toBeGreaterThan(24000);
  expect(profile.cost * 2).toBeLessThanOrEqual(60000);
  expect(ornamentalDecorationProfile("roadDecoration:wisteria-curved:native", true)!.cost)
    .toBeLessThanOrEqual(24000);
  const camera = new OrthographicCamera(-6, 6, 5, -5, .1, 2000);
  camera.position.set(9, 8, 22); camera.lookAt(9, 1, 10); camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const frames: RoadDecorationFrame[] = [5, 13].map((x, uid) => ({ uid, item, position: [x, 0, 10], yaw: 0,
    volumes: [{ min: [x - 2, 0, 8], max: [x + 2, 4, 12] }], supports: [] }));
  const lod = createOrnamentalPlantLod(true);
  try {
    lod.update(frames, camera, 900);
    expect(frames.map(frame => lod.tierFor(frame.uid))).toEqual(["near", "near"]);
  } finally { lod.dispose(); }
});

it.each([true, false])("charges revised maple C near geometry without raising the shared1000-instance budget; High=%s", detailed => {
  const ids = ["red-maple", "red-maple-yellow", "red-maple-orange"].flatMap(species =>
    [0, 1, 2].map(variant => `roadDecoration:plant-${species}-standalone-ground-${variant}:native` as RoadDecorationItemId));
  const frames: RoadDecorationFrame[] = Array.from({ length: 1000 }, (_, uid) => ({
    uid, item: ids[uid % ids.length]!, position: [uid % 32 * 8, 0, Math.floor(uid / 32) * 8], yaw: 0,
    volumes: [{ min: [uid % 32 * 8 - 2, 0, Math.floor(uid / 32) * 8 - 2],
      max: [uid % 32 * 8 + 2, 5, Math.floor(uid / 32) * 8 + 2] }], supports: []
  }));
  const camera = new OrthographicCamera(-20, 20, 18, -18, .1, 2000);
  camera.position.set(140, 80, 220); camera.lookAt(120, 0, 120); camera.updateProjectionMatrix();
  const lod = createOrnamentalPlantLod(detailed);
  try {
    lod.update(frames, camera, 900);
    let actualTriangles = 0, nearTriangles = 0, nearCount = 0;
    for (const frame of frames) {
      const profile = ornamentalDecorationProfile(frame.item, detailed)!;
      expect(profile.cost).toBe(detailed ? 24000 : 8075); expect(profile.farCost).toBe(2116);
      const tier = lod.tierFor(frame.uid);
      if (tier === "near") {
        const actual = detailed ? 23726 : 8075;
        actualTriangles += actual; nearTriangles += actual; nearCount++;
      } else actualTriangles += tier === "far" ? 2116 : 2;
    }
    expect(actualTriangles).toBeLessThanOrEqual(detailed ? 100000 : 60000);
    expect(nearTriangles).toBeLessThanOrEqual(detailed ? 60000 : 24000);
    expect(nearCount).toBeLessThanOrEqual(2);
  } finally { lod.dispose(); }
});
