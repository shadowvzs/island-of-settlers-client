import { readFileSync } from "node:fs";
import { DataTexture, Mesh } from "three";
import { expect, it, vi } from "vitest";

import {
  getRoadDecorationItem, ROAD_DECORATION_ITEM_DEFINITIONS, type RoadDecorationItemId, roadDecorationItemIdsReleasedBy,
  roadDecorationItemsTagged
} from "../../island-of-settlers-shared/src/road-decoration-items";
import { ornamentalPlantArtReady, ornamentalPlantModel } from "../../island-of-settlers-shared/src/road-plant-models";
import { roadDecorationMessages } from "../src/app/player-inventory/road-decoration-presentation";
import { roadDecorationClearance } from "../src/render-common/road-decoration-clearance";
import { createRoadDecorationRecipe } from "../src/render-common/road-decoration-models";
import { ornamentalDecorationProfile } from "../src/renderers/three/plants/ornamental-decoration-profile";
import { createOrnamentalPlantOverview } from "../src/renderers/three/plants/ornamental-plant-overview";
import { createDecorationAssetLoader } from "../src/renderers/three/road-decoration-asset-loader";
import { createRoadDecorationTemplates } from "../src/renderers/three/road-decoration-templates";
import { getRoadDecoration } from "../src/shared/settlement/road-decoration-catalog";
import { createRoadDecorationState } from "../src/shared/settlement/road-decoration-state";

const gardenIds = Object.keys(ROAD_DECORATION_ITEM_DEFINITIONS).filter(id => {
  const asset = getRoadDecorationItem(id)?.plant;
  const model = asset && ornamentalPlantModel(asset);
  return model === "willow-tree" || model === "cypress-tree";
});
const ROMAN_COLUMN_ITEM_DEFINITIONS = roadDecorationItemsTagged("column");
const RELEASED_ROAD_DECORATION_ITEM_IDS = roadDecorationItemIdsReleasedBy("decoration");
const ids = [...gardenIds, ...Object.keys(ROMAN_COLUMN_ITEM_DEFINITIONS)] as RoadDecorationItemId[];

it("preserves six existing tree identities and releases exactly four accepted, finish-aware architectural SKUs", () => {
  expect(gardenIds).toHaveLength(6); expect(ids).toHaveLength(10);
  expect(Object.keys(ROAD_DECORATION_ITEM_DEFINITIONS)).toHaveLength(272);
  expect(RELEASED_ROAD_DECORATION_ITEM_IDS.size).toBe(23);
  expect(Object.values(ROAD_DECORATION_ITEM_DEFINITIONS).filter(item => item.shopAvailable)).toHaveLength(265);
  for (const id of RELEASED_ROAD_DECORATION_ITEM_IDS) expect(getRoadDecorationItem(id)?.shopAvailable).toBe(true);
  for (const id of ids) {
    const item = getRoadDecorationItem(id)!;
    expect(item.shopAvailable).toBe(true); expect(roadDecorationMessages(id)?.name).toBeDefined();
    if (item.plant) expect(ornamentalPlantArtReady(item.plant)).toBe(true);
  }
  for (const [id, item] of Object.entries(roadDecorationItemsTagged("addition")))
    expect(item.shopAvailable).toBe(RELEASED_ROAD_DECORATION_ITEM_IDS.has(id as RoadDecorationItemId));
  for (const variant of [0, 1, 2]) {
    const pot = getRoadDecorationItem(`roadDecoration:plant-columnar-cypress-roadside-pot-${variant}:native`)!;
    expect(ornamentalPlantModel(pot.plant!)).toBe("catalog-columnar");
  }
  const sql = readFileSync("../island-of-settlers-db/migrations/0037_road_bamboo_custody.sql", "utf8");
  const checks = [...sql.matchAll(/item_id IN \(([\s\S]*?)\)/g)].map(match =>
    [...match[1]!.matchAll(/'(roadDecoration:[^']+)'/g)].map(id => id[1]!).sort()).filter(rows => rows.length);
  expect(checks).toHaveLength(2);
  for (const rows of checks) expect(rows).toEqual(Object.keys(ROAD_DECORATION_ITEM_DEFINITIONS).sort());
});

it.each(ids)("%s loads actual near/far meshes within shared physical reservations and calibrated budgets", async id => {
  const item = getRoadDecorationItem(id)!, definition = getRoadDecoration(item.decoration)!;
  const boxes = roadDecorationClearance(definition).volumes;
  if (definition.family === "roman-column") {
    expect(definition.placement).toBe("terrain");
    expect(createRoadDecorationRecipe(definition, true, item.finish as "limestone" | "marble").parts[0])
      .toMatchObject({ kind: "roman-column", columnOrder: definition.variant });
  }
  for (const detailed of [true, false]) for (const tier of ["near", "far"] as const) {
    if (tier === "far" && item.plant && ornamentalPlantModel(item.plant) === "willow-tree") {
      expect(ornamentalDecorationProfile(id, detailed)?.farCost).toBe(2);
      continue; // Canonical image routing/orientation has its own texture-injected CPU proof.
    }
    const loader = createDecorationAssetLoader(() => { throw new Error("Independent premium materials expected"); }, detailed);
    const model = (await loader(id, id, () => true, tier))!;
    const profile = ornamentalDecorationProfile(id, detailed)!;
    expect(model.triangles).toBeGreaterThan(2);
    expect(model.triangles).toBeLessThanOrEqual(tier === "far" ? profile.farCost : profile.cost);
    for (const mesh of model.root.children) {
      expect(mesh).toBeInstanceOf(Mesh);
      const geometry = (mesh as Mesh).geometry, positions = geometry.getAttribute("position");
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const point = [positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)];
        if (!boxes.some(box => point.every((value, axis) =>
          value >= box.min[axis]! - 1e-5 && value <= box.max[axis]! + 1e-5)))
          throw new Error(`Unreserved actual vertex ${id}/${tier}: ${point.join(",")}`);
      }
    }
    model.dispose(); model.dispose(); expect(model.root.children).toHaveLength(0);
  }
});

it.each(ids)("%s preserves its finish and UID through four turns, movement, save/load and exactly-once return", id => {
  const context = () => ({ nation: "roman" as const, roads: [], heightAt: () => 0,
    isOwned: () => true, isFree: () => true });
  const state = createRoadDecorationState(context);
  expect(state.place({ item: id, position: { x: 20, z: 20 }, yaw: 0 }, () => true)).toEqual({ ok: true, uid: 1 });
  for (let turn = 0; turn < 4; turn++) expect(state.rotate(1).ok).toBe(true);
  expect(state.move(1, { x: 25, z: 20 }, Math.PI / 2).ok).toBe(true);
  const saved = state.save(); state.load(saved); expect(state.save()).toEqual(saved);
  expect(state.frames()[0]!.item).toBe(id); expect(state.frames()[0]!.uid).toBe(1);
  expect(state.pickUp(1)).toEqual({ ok: true, returned: 1 });
  expect(state.pickUp(1)).toEqual({ ok: true, returned: 0 });
  const receive = vi.fn(() => true), pending = state.returns().map(row => row.id);
  state.claimReturns(pending, receive); state.claimReturns(pending, receive);
  expect(receive).toHaveBeenCalledExactlyOnceWith({ [id]: 1 });
});

it("uses each column's real finish-aware overview and rejects a mismatched native or other-finish icon", async () => {
  for (const id of Object.keys(ROMAN_COLUMN_ITEM_DEFINITIONS) as RoadDecorationItemId[]) {
    const item = getRoadDecorationItem(id)!, image = `${item.decoration}-${item.finish}.png`;
    const entry = { image, width: 4, height: 4, pivot: [.5, .1] as const };
    const loadTexture = vi.fn(async () => new DataTexture());
    const model = await createOrnamentalPlantOverview(id, () => true, {
      baseUrl: "/game/", loadManifest: async () => ({ [id]: entry }), loadTexture
    });
    expect(loadTexture).toHaveBeenCalledExactlyOnceWith(`/game/icons/road-decorations/${image}`);
    expect(model!.triangles).toBe(2); model!.dispose();
    await expect(createOrnamentalPlantOverview(id, () => true, {
      loadManifest: async () => ({ [id]: { ...entry, image: `${item.decoration}-native.png` } }), loadTexture
    })).rejects.toThrow(/Missing or invalid/);
  }
});

it("keeps column finishes and near/far/overview cache identities separate through real tier transitions", async () => {
  const templates = createRoadDecorationTemplates(() => { throw new Error("Independent column materials expected"); }, true);
  const columns = Object.keys(ROMAN_COLUMN_ITEM_DEFINITIONS);
  const entries = columns.flatMap(item => (["near", "far"] as const).map(tier => ({ item, tier })));
  const keys = columns.flatMap(item => (["near", "far", "overview"] as const).map(tier => templates.keyFor(item, tier)));
  expect(new Set(keys).size).toBe(12);
  try {
    templates.retainLods(entries);
    await Promise.all(entries.map(({ item, tier }) => templates.request(item, false, tier)));
    for (const id of columns) {
      expect(templates.get(id).triangles).toBeGreaterThan(1800);
      expect(templates.get(id, "far").triangles).toBeLessThanOrEqual(700);
      expect(templates.get(id, "far").root).not.toBe(templates.get(id).root);
    }
  } finally { templates.dispose(); }
});
