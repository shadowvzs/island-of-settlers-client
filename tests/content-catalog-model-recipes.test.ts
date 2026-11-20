import { buildingEntries, catalogEntries, entriesOfKind, modelRecipeIds, propEntryByCode } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import { NATIONS } from "../../island-of-settlers-shared/src/nations";
import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { BUILDING_LEVELS } from "../src/render-common/buildings/levels/building-level";
import { MONUMENT_TYPE_ID } from "../src/render-common/buildings/monument-definition";
import { buildingModelRecipe } from "../src/render-common/content/building-model-recipes";
import { decorationModel } from "../src/render-common/content/decoration-model-recipes";
import { lifeModelRecipes } from "../src/render-common/content/life-model-recipes";
import { registeredModelRecipeIds } from "../src/render-common/content/model-recipes";
import { propModelRecipes } from "../src/render-common/content/prop-model-recipes";
import { boatModelRecipe, shipModelRecipe } from "../src/render-common/content/vessel-model-recipes";
import { whaleModelRecipe } from "../src/render-common/content/whale-model-recipes";
import { createPropMesh } from "../src/render-common/props/prop-meshes";
import { buildWhaleMesh, WHALE_DETAIL } from "../src/render-common/whales/whale-model";
import { WHALE_SPECIES } from "../src/render-common/whales/whale-species";
import { isBuildingFirstNation } from "../src/render-common/workers/worker-nation";
import { getRoadDecoration } from "../src/shared/settlement/road-decoration-catalog";

const referencedIds = () => new Set(catalogEntries().flatMap(entry => modelRecipeIds(entry)));
const missingFrom = (ids: Iterable<string>, set: ReadonlySet<string>) => [...ids].filter(id => !set.has(id));

describe("model recipe registry", () => {
  it("registers every recipe id the catalog names, and every registered id is named by the catalog", () => {
    const referenced = referencedIds(), registered = registeredModelRecipeIds();
    expect(missingFrom(referenced, registered)).toEqual([]);
    expect(missingFrom(registered, referenced)).toEqual([]);
    expect(registered.size).toBeGreaterThan(2000);
  });

  it("routes every building, nation and level exactly like the former dispatch", () => {
    const sorted = (codes: readonly number[]) => [...codes].sort((first, second) => first - second);
    expect(sorted(buildingEntries().map(entry => entry.code))).toEqual(sorted(BUILDING_CATALOG.map(({ id }) => id)));
    for (const { id } of BUILDING_CATALOG) for (const nation of NATIONS) for (const level of BUILDING_LEVELS) {
      const recipe = buildingModelRecipe(id, nation, level);
      const authored = id === MONUMENT_TYPE_ID && !isBuildingFirstNation(nation);
      expect(recipe.kind, `${id}/${nation}/${level}`).toBe(authored ? "authored" : "leveled");
      expect(recipe.nation).toBe(nation);
      if (recipe.kind === "leveled") expect(recipe.level ?? level).toBe(level);
    }
    expect(() => buildingModelRecipe(30, "roman", 1)).toThrow(/names no model recipe/);
  });

  it("resolves every decoration to the same model definition as the content id lookup", () => {
    for (const { key } of entriesOfKind("decoration")) {
      expect(getRoadDecoration(key), key).toBeDefined();
      expect(decorationModel(key), key).toBe(getRoadDecoration(key));
    }
    expect(decorationModel("unknown-decoration")).toBeUndefined();
  });

  it("builds ground props and life models with their legacy builders", () => {
    for (const [id, build] of propModelRecipes()) {
      const [kind, key] = id.slice("recipe:".length).split(".");
      const code = [...Array(64).keys()].find(candidate => propEntryByCode(candidate)?.key === key)!;
      expect(propEntryByCode(code)?.kind, id).toBe(kind);
      expect(build(7, 0), id).toEqual(createPropMesh(7, code, 0));
    }
    for (const [id, recipe] of lifeModelRecipes()) {
      const model = recipe.kind === "critter" ? recipe.build({ minimal: false, winter: false }) : recipe.build();
      expect(model, id).toBeDefined();
    }
  });

  it("routes ships and boats exactly like the former hull style rule", () => {
    for (const nation of NATIONS) {
      expect(shipModelRecipe(undefined, nation), nation).toEqual({ kind: "ship", style: nation });
      expect(shipModelRecipe("enemy", nation).style, nation).toBe("raider");
      expect(shipModelRecipe("neutral", "viking", nation).style, nation).toBe(nation);
      expect(boatModelRecipe("fishingSkiff", nation), nation).toEqual({ kind: "fishingSkiff", nation });
      expect(boatModelRecipe("lighter", nation), nation).toEqual({ kind: "lighter", nation });
    }
    expect(shipModelRecipe("neutral", "viking").style).toBe("roman");
    expect(shipModelRecipe().style).toBe("roman");
  });

  it("builds every whale body with the legacy mesh builder", () => {
    for (const species of Object.values(WHALE_SPECIES)) {
      const recipe = whaleModelRecipe(species);
      expect(recipe.species).toBe(species);
      for (const detail of Object.values(WHALE_DETAIL))
        expect(recipe.build(detail)).toEqual(buildWhaleMesh(species, detail));
    }
  });
});
