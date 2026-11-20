import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { decorateExpansionDrinkSign } from "../src/render-common/buildings/expansion-drink-signs";
import { createNationalDrinkPlantMesh, getNationalDrinkPlantStage } from "../src/render-common/props/drink-crops/national-drink-plants";
import { WARE_IDS } from "../src/render-common/wares/ware-catalog";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { displayBuildingName, displayWareName } from "../src/shared/i18n/domain";
import { DRINK_WARES, NATION_DRINK_CHAINS, RAW_DRINK_WARES } from "../src/shared/settlement/nation-drinks";
import { getProductionRule } from "../src/shared/settlement/production-rules";
import { wareBoxUnits } from "../src/shared/settlement/ship-cargo-boxes";

const nations = ["chinese", "persian", "maya", "indigenous"] as const;
const frame = { id: 0, kind: "cacao", progress: 0, state: "growing", step: 0, x: 0, z: 0 };

describe("original national drink assets and labels", () => {
  it("offers eight distinct complete chains, with the same 24-second grower and 16-second maker work", () => {
    expect(new Set(DRINK_WARES).size).toBe(8);
    expect(new Set(RAW_DRINK_WARES).size).toBe(8);
    for (const nation of nations) {
      const chain = NATION_DRINK_CHAINS[nation];
      expect(getProductionRule(5, nation)?.seconds).toBe(24);
      expect(wareBoxUnits(chain.raw)).toBe(wareBoxUnits("grapes"));
      expect(wareBoxUnits(chain.drink)).toBe(wareBoxUnits("wine"));
      expect(getProductionRule(6, nation)).toMatchObject({ seconds: 16, inputs: [chain.raw, "water"], outputs: [chain.drink] });
      expect(displayBuildingName(5, nation)).not.toBe("Vineyard");
      expect(displayBuildingName(6, nation)).not.toBe("Winery");
      for (const ware of [chain.raw, chain.drink]) {
        expect(WARE_IDS).toContain(ware);
        expect(displayWareName(ware)).not.toBe(ware);
        for (const detailed of [false, true]) {
          const recipe = createWareRecipe(ware, detailed);
          expect(recipe.id).toBe(ware);
          expect(recipe.parts.length).toBeGreaterThan(0);
          if (ware === "pomegranate")
            expect(recipe.parts.every(part => part.shape === "pomegranate-whole-fruit")).toBe(true);
          expect(recipe.parts.every(part => [...part.position, ...part.size].every(Number.isFinite))).toBe(true);
        }
      }
    }
  });

  it.each(nations)("%s has distinct lean and detailed growing/ripe plant geometry", nation => {
    const kind = NATION_DRINK_CHAINS[nation].plantation as "tea" | "pomegranate" | "cacao" | "berries";
    for (const detailed of [false, true]) {
      const young = createNationalDrinkPlantMesh(kind, "young", detailed);
      const ripe = createNationalDrinkPlantMesh(kind, "ripe", detailed);
      expect(ripe.height).toBeGreaterThan(young.height);
      expect(ripe.indices.length / 3).toBeLessThan(detailed ? 6000 : 1200);
      expect(Array.from(ripe.positions).every(Number.isFinite)).toBe(true);
      expect(ripe.positions).not.toEqual(createNationalDrinkPlantMesh(kind, "picked", detailed).positions);
    }
  });

  it.each(nations)("%s replaces both legacy grape pictograms with its own crop/drink tablet", nation => {
    for (const id of [5, 6]) for (const detailed of [false, true]) {
      const original = createRomanBuildingRecipe(getBuildingDefinition(id), detailed, false);
      const result = decorateExpansionDrinkSign(original, id, nation, detailed);
      expect(result.parts.filter(part => part.stock)).toEqual(original.parts.filter(part => part.stock));
      const signs = result.parts.filter(part => part.occupationSign);
      expect(signs.length).toBeGreaterThan(3);
      expect(signs).not.toEqual(original.parts.filter(part => part.occupationSign));
      expect(result.parts.filter(part => !part.occupationSign))
        .toEqual(original.parts.filter(part => !part.occupationSign));
    }
  });

  it("keeps established plants mature after harvest and during their next maintenance/growth cycle", () => {
    expect(getNationalDrinkPlantStage(frame)).toBe("young");
    expect(getNationalDrinkPlantStage({ ...frame, state: "stubble", step: 1 })).toBe("picked");
    expect(getNationalDrinkPlantStage({ ...frame, step: 1 })).toBe("leafy");
    expect(getNationalDrinkPlantStage({ ...frame, state: "ripe", harvest: .9 })).toBe("picked");
  });
});
