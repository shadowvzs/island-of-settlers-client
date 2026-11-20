import { Box3, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { type BuildingSurface,createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanWareStockSlots, romanWareStockPlacement } from "../src/render-common/buildings/roman-ware-stock";
import { CARGO_BOX_WARE, WARE_IDS } from "../src/render-common/wares/ware-catalog";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { createWareModel } from "../src/renderers/three/settlement/ware-models";

const material = new MeshStandardMaterial();
const surfaces = new Set(WARE_IDS.flatMap(id => createWareRecipe(id, true).parts.map(part => part.surface)));
const materials = Object.fromEntries([...surfaces].map(surface => [surface, material])) as
  Record<BuildingSurface, MeshStandardMaterial>;

describe("cargo contains the goods rather than a display platform", () => {
  it.each([true, false])("loose metal and hides have no wood while real vessels retain their sealed bottoms (detailed=%s)", detailed => {
    for (const ware of ["iron", "leather", "hides"]) {
      const model = createWareModel(ware, detailed, materials, "carry");
      expect(model.recipe.parts.some(part => part.surface === "wood")).toBe(false);
      expect(model.triangles()).toBeGreaterThan(0);
      expect(new Box3().setFromObject(model.root).isEmpty()).toBe(false);
      model.dispose();
    }
    for (const ware of ["water", "beer"]) {
      const recipe = createWareRecipe(ware, detailed);
      expect(recipe.parts.some(part => part.surface === "wood" && part.shape === "ring")).toBe(true);
      expect(recipe.parts.some(part => part.surface === "wood" && part.shape === "cylinder" && part.position[1] < 0)).toBe(true);
    }
  });

  it.each([true, false])("wine contains its complete cask without external cradle geometry (detailed=%s)", detailed => {
    const model = createWareModel("wine", detailed, materials, "carry");
    expect(model.recipe.parts.filter(part => part.surface === "wood").map(part => part.shape)).toEqual(["barrel"]);
    expect(model.recipe.parts.some(part => part.surface === "iron")).toBe(true);
    model.root.updateMatrixWorld(true);
    expect(new Box3().setFromObject(model.root).min.y).toBeGreaterThan(-.156);
    model.dispose();
  });

  it.each(["iron", "leather", "hides", "boat", "wine", "hardwoodLogs", "hardwoodPlanks", "cedarLogs", "cedarPlanks", "walnutLogs", "walnutPlanks", "mahoganyLogs", "mahoganyPlanks"])("%s stock rests on the existing slot bottom after removing its display support", ware => {
    let measured = 0;
    for (const definition of BUILDING_CATALOG) {
      const recipe = createRomanBuildingRecipe(definition, true);
      const slots = getRomanWareStockSlots(recipe).filter(slot => slot.stock.presentation !== "hanging" &&
        (slot.stock.ware === ware || slot.stock.wares?.includes(ware)));
      for (const slot of slots) {
        const placement = romanWareStockPlacement(slot, ware, 1);
        const model = createWareModel(ware, true, materials);
        model.root.position.fromArray(placement.position);
        model.root.scale.fromArray(placement.dimensions);
        model.root.rotation.y = placement.yaw;
        model.root.updateMatrixWorld(true);
        let expectedBottom = slot.bottom;
        if (slot.support) {
          const supportPlacement = romanWareStockPlacement(slot.support, ware, 1);
          const support = createWareModel(ware, true, materials);
          support.root.position.fromArray(supportPlacement.position);
          support.root.scale.fromArray(supportPlacement.dimensions);
          support.root.rotation.y = supportPlacement.yaw;
          support.root.updateMatrixWorld(true);
          expectedBottom = new Box3().setFromObject(support.root).max.y;
          support.dispose();
        }
        expect(new Box3().setFromObject(model.root).min.y).toBeCloseTo(expectedBottom, 5);
        model.dispose();
        measured++;
      }
    }
    expect(measured).toBeGreaterThan(0);
  });

  it.each(["flax", "cloth"] as const)("%s has no unearned display platform under the item", ware => {
    const recipe = createWareRecipe(ware, true);
    // A wide, thin horizontal box low in the model is the icon "platform" smell. Functional
    // vessels/bases are allowed elsewhere; these new fibre/cloth wares have no such base.
    const platforms = recipe.parts.filter(part => part.shape === "box" && part.position[1] < -.08 &&
      part.size[1] < .06 && part.size[0] > .18 && part.size[2] > .12);
    expect(platforms).toEqual([]);
  });

  it("keeps boat hulls, cargo crates and unknown fallback geometry instead of making them disappear", () => {
    expect(createWareRecipe("boat", true).parts.some(part => part.shape === "sphere")).toBe(true);
    expect(createWareRecipe(CARGO_BOX_WARE, true).parts.some(part => part.surface === "wood")).toBe(true);
    expect(createWareRecipe("unknown future ware", true).parts.length).toBeGreaterThan(0);
  });
});
