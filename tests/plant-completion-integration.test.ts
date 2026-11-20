import { type Material,Mesh } from "three";
import { expect, it } from "vitest";

import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../island-of-settlers-shared/src/road-decoration-items";
import { PLANT_COMPLETION_ITEM_IDS, plantCompletionModelFamily } from "../../island-of-settlers-shared/src/road-plant-completion";
import { ornamentalPlantModel, ornamentalPlantUsesCanonicalIcon } from "../../island-of-settlers-shared/src/road-plant-models";
import { roadDecorationClearance } from "../src/render-common/road-decoration-clearance";
import { ornamentalDecorationProfile } from "../src/renderers/three/plants/ornamental-decoration-profile";
import { createPlantCompletionModels } from "../src/renderers/three/plants/plant-completion-model";
import { createDecorationAssetLoader } from "../src/renderers/three/road-decoration-asset-loader";
import { getRoadDecoration } from "../src/shared/settlement/road-decoration-catalog";

const completion = PLANT_COMPLETION_ITEM_IDS.map(id => {
  const item = ROAD_DECORATION_ITEM_DEFINITIONS[id];
  if (!item?.plant) throw new Error(`Missing canonical completion SKU ${id}`);
  return { id, item, asset: item.plant };
});

it("routes exactly201 new SKUs while preserving27 accepted botanical paths", () => {
  expect(new Set(PLANT_COMPLETION_ITEM_IDS).size).toBe(201);
  const totals = new Map<string, number>();
  for (const { asset } of completion) {
    const family = plantCompletionModelFamily(asset);
    expect(family).toBeDefined(); expect(ornamentalPlantModel(asset)).toBe(family);
    totals.set(family!, (totals.get(family!) ?? 0) + 1);
  }
  expect(Object.fromEntries(totals)).toEqual({ "catalog-orchard": 24, "catalog-flower": 48,
    "catalog-bonsai": 21, "catalog-shrub": 24, "catalog-flowering": 30,
    "catalog-willow": 21, "catalog-palm": 18, "catalog-columnar": 15 });
  const previous = Object.values(ROAD_DECORATION_ITEM_DEFINITIONS).filter(item => item.plant &&
    !plantCompletionModelFamily(item.plant));
  expect(previous).toHaveLength(27);
  expect(previous.every(item => item.shopAvailable && !ornamentalPlantModel(item.plant!)?.startsWith("catalog-")))
    .toBe(true);
});

it("reserves finite authored root/pot support for every completion SKU", () => {
  for (const { item } of completion) {
    const clearance = roadDecorationClearance(getRoadDecoration(item.decoration)!);
    expect(clearance.volumes.length).toBeGreaterThan(0); expect(clearance.supports).toHaveLength(1);
    for (const box of [...clearance.volumes, ...clearance.supports]) for (const axis of [0, 1, 2]) {
      expect(Number.isFinite(box.min[axis]) && Number.isFinite(box.max[axis])).toBe(true);
      expect(box.max[axis]!).toBeGreaterThanOrEqual(box.min[axis]!);
    }
    expect(clearance.supports[0]!.min[1]).toBeLessThanOrEqual(.06);
  }
});

it("shares actual family materials and releases bounded near/far models exactly once", () => {
  const representatives = [...new Map(completion.map(entry => [plantCompletionModelFamily(entry.asset), entry])).values()];
  for (const detailed of [true, false]) for (const entry of representatives) {
    const owner = createPlantCompletionModels(detailed);
    const canonicalFar = ornamentalPlantUsesCanonicalIcon(entry.asset, "far");
    if (canonicalFar) expect(() => owner.create(entry.asset, "far")).toThrow("asynchronous canonical icon");
    const first = owner.create(entry.asset), second = owner.create(entry.asset, canonicalFar ? "near" : "far");
    for (const root of [first.root, second.root]) {
      // The actual instancing owner consumes flat single-material meshes with geometry-baked transforms.
      expect(root.children.length).toBeGreaterThan(0);
      expect(root.children.every(child => child instanceof Mesh && !Array.isArray(child.material))).toBe(true);
      for (const part of [root, ...root.children]) {
        expect(part.position.toArray()).toEqual([0, 0, 0]);
        expect(part.scale.toArray()).toEqual([1, 1, 1]);
        expect(part.quaternion.toArray()).toEqual([0, 0, 0, 1]);
      }
    }
    const materials = (root: typeof first.root) => {
      const result = new Set<Material>();
      root.traverse(child => { if (child instanceof Mesh)
        (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => result.add(material)); });
      return result;
    };
    const nearMaterials = materials(first.root), borrowedMaterials = materials(second.root);
    expect([...borrowedMaterials].some(material => nearMaterials.has(material))).toBe(true);
    const profile = ornamentalDecorationProfile(entry.id, detailed)!;
    expect(first.triangles).toBeLessThanOrEqual(profile.cost);
    expect(second.triangles).toBeLessThanOrEqual(canonicalFar ? profile.cost : profile.farCost);
    let disposed = 0;
    [...nearMaterials][0]!.addEventListener("dispose", () => disposed++);
    first.dispose(); first.dispose(); expect(disposed).toBe(0);
    expect(second.root.children.length).toBeGreaterThan(0);
    second.dispose(); second.dispose(); expect(disposed).toBe(1);
    expect(first.root.children).toHaveLength(0); expect(second.root.children).toHaveLength(0);
  }
});

it("routes canonical asynchronous templates and cancels stale completion imports before allocation", async () => {
  const load = createDecorationAssetLoader(() => { throw new Error("Unexpected national material ownership"); }, false);
  const { id } = completion[0]!;
  expect(await load(id, "already-cancelled", () => false)).toBeUndefined();
  let active = true;
  const pending = load(id, "cancelled-import", () => active);
  active = false;
  expect(await pending).toBeUndefined();
  const model = await load(id, "canonical-completion", () => true);
  expect(model?.key).toBe("canonical-completion");
  expect(model?.triangles).toBeGreaterThan(0);
  model?.dispose(); model?.dispose();
  expect(model?.root.children).toHaveLength(0);
});
