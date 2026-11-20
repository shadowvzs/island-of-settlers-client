import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import {
  applyBridgeLevelFinish, bridgeStoneFinish, bridgeTimberFinish
} from "../src/render-common/bridges/bridge-level-finish";
import type { BridgeRecipe, BridgeRecipeInput } from "../src/render-common/bridges/bridge-recipe";
import { stoneArchBridgeRecipe } from "../src/render-common/bridges/stone-arch-bridge-recipe";
import { stoneSlabBridgeRecipe } from "../src/render-common/bridges/stone-slab-bridge-recipe";
import { woodBridgeRecipe } from "../src/render-common/bridges/wood-bridge-recipe";
import type { BuildingPart, BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { createBridgeModel } from "../src/renderers/three/settlement/bridge-model";
import { BRIDGE_TIMBER_BASE, bridgeTimberSampler } from "../src/renderers/three/settlement/bridge-timber-samplers";
import { bounds, crossing, floating } from "./helpers/bridge-recipe-support";

type Recipe = (input: BridgeRecipeInput) => BridgeRecipe;
const KINDS: readonly [string, "stone" | "wood", Recipe, number][] = [
  ["wooden", "wood", woodBridgeRecipe, 6], ["stone slab", "stone", stoneSlabBridgeRecipe, 3],
  ["stone arch", "stone", stoneArchBridgeRecipe, 8], ["long stone arch", "stone", stoneArchBridgeRecipe, 12]
];
const LEVELS = [0, 1, 2, 3, 4];

const parts = (recipe: BridgeRecipe) => recipe.parts.map(({ part }) => {
  if ("kind" in part) throw new Error("Bridge recipes use building parts");
  return part;
});
const describePart = (part: BuildingPart) =>
  `${part.shape}/${part.surface} at ${part.position.map(value => value.toFixed(2)).join(",")}`;

const material = new MeshStandardMaterial();
const materials = new Proxy({} as Record<BuildingSurface, MeshStandardMaterial>, { get: () => material });
const triangles = (recipe: BridgeRecipe, detailed: boolean) => {
  const model = createBridgeModel(recipe, materials, detailed);
  const count = model.triangles;
  model.dispose();
  return count;
};

describe("bridge levels 1–5", () => {
  for (const [label, kind, recipe, tiles] of KINDS)
    for (const detailed of [true, false]) {
      const lod = detailed ? "High" : "Minimal";
      const at = (level: number) => recipe({ ...crossing(tiles, 0.3, detailed), level });

      it(`keeps level 1 identical and adds detail at every further level (${label}, ${lod})`, () => {
        expect(at(0)).toEqual(recipe(crossing(tiles, 0.3, detailed)));
        // Level details join the railing stage (the wooden deck changes from poles to planks at level 2).
        const details = (level: number) => at(level).parts.filter(entry => entry.stage === 2).length;
        for (const level of LEVELS.slice(1))
          expect(details(level), `level ${level + 1}`).toBeGreaterThan(details(level - 1));
      });

      it(`supports every added part and keeps the clear deck free (${label}, ${lod})`, () => {
        const input = crossing(tiles, 0.3, detailed);
        const base = new Set(floating(at(0), input));
        const original = new Set(parts(at(0)).map(describePart));
        for (const level of LEVELS.slice(1)) {
          const recipeAtLevel = at(level);
          expect(floating(recipeAtLevel, input).filter(entry => !base.has(entry)), `level ${level + 1}`)
            .toEqual([]);
          for (const part of parts(recipeAtLevel).filter(entry => !original.has(describePart(entry)))) {
            const box = bounds(part), deck = input.deckTopAt(part.position[0]);
            const overDeck = box.max[1] > deck + 0.02 && box.min[1] < deck + 2.2;
            // The coping's inner edge (1.25) bounds the parapet line; the clear deck is ±1.3.
            const inLane = box.min[2] < 1.24 && box.max[2] > -1.24;
            expect(overDeck && inLane && part.surface !== "planks" && part.surface !== "cut-stone",
              `${describePart(part)} in the deck lane`).toBe(false);
          }
        }
      });

      it(`stays inside the triangle budget at level 5 (${label}, ${lod})`, () => {
        const finished = applyBridgeLevelFinish(at(4), kind, 4);
        const budget = detailed ? 9_500 : 2_800;
        expect(triangles(finished, detailed)).toBeLessThanOrEqual(budget);
      });
    }

  it("gives each level its tier material and keeps level 1 untouched", () => {
    const input = { ...crossing(6, 0.3, true), level: 3 };
    const wood = woodBridgeRecipe(input);
    expect(applyBridgeLevelFinish(wood, "wood", 0)).toBe(wood);
    const finished = parts(applyBridgeLevelFinish(wood, "wood", 3));
    // Tier timber maps carry the colour: timber tints become neutral shades, darker parts stay darker.
    const plank = parts(wood).findIndex(part => part.surface === "planks");
    const [red, green, blue] = finished[plank]!.tint!;
    expect(red).toBeCloseTo(green!, 6);
    expect(green).toBeCloseTo(blue!, 6);
    const stone = parts(wood).findIndex(part => part.surface === "stone");
    expect(finished[stone]!.tint).toEqual(parts(wood)[stone]!.tint);
    expect([0, 1, 2, 3, 4].map(level => bridgeTimberFinish("wood", level)))
      .toEqual(["softwood", "hardwood", "cedar", "walnut", "mahogany"]);
    expect(bridgeTimberFinish("stone", 4)).toBe("softwood");
    expect([0, 1, 2, 3, 4].map(level => bridgeStoneFinish("stone", level)))
      .toEqual(["granite", "marble", "limestone", "basalt", "warm-granite"]);
    expect(bridgeStoneFinish("wood", 4)).toBe("granite");
  });

  it("adds supported bonus decorations per wooden level on both LODs", () => {
    for (const detailed of [true, false]) {
      const surfaces = (level: number) =>
        new Set(parts(woodBridgeRecipe({ ...crossing(6, 0.3, detailed), level })).map(part => part.surface));
      expect(surfaces(2).has("rope"), "cedar rope lashing").toBe(true);
      expect(surfaces(1).has("rope")).toBe(false);
      expect(surfaces(3).has("leaf"), "walnut planters").toBe(true);
      expect(surfaces(4).has("cloth"), "mahogany pennants").toBe(true);
      // Owner 2026-11-07: period details only, no gilding or round knobs.
      for (const level of [3, 4]) expect(surfaces(level).has("gold")).toBe(false);
      const knobs = parts(woodBridgeRecipe({ ...crossing(6, 0.3, detailed), level: 4 }))
        .filter(part => part.shape === "sphere");
      expect(knobs).toEqual([]);
      expect(surfaces(3).has("cloth")).toBe(false);
    }
  });

  it("paints a distinct timber map per wooden tier", () => {
    const samples = (["hardwood", "cedar", "walnut", "mahogany"] as const).map(tier => {
      const sample = bridgeTimberSampler(tier, false);
      const point = { grain: 0.5, mineral: 0.5, u: 0.3, v: 0.4, weather: 0.5 };
      const detail = sample(point);
      return BRIDGE_TIMBER_BASE[tier].map((value, channel) => Math.round(value * detail.brightness * detail.colour[channel]!));
    });
    expect(new Set(samples.map(sample => sample.join(","))).size).toBe(4);
  });
});
