import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import type { BridgeRecipe, BridgeRecipeInput } from "../src/render-common/bridges/bridge-recipe";
import { stoneArchBridgeRecipe } from "../src/render-common/bridges/stone-arch-bridge-recipe";
import { stoneSlabBridgeRecipe } from "../src/render-common/bridges/stone-slab-bridge-recipe";
import { woodBridgeRecipe } from "../src/render-common/bridges/wood-bridge-recipe";
import type { BuildingPart, BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { createBridgeModel } from "../src/renderers/three/settlement/bridge-model";
import { bounds } from "./helpers/bridge-recipe-support";

const TILES = 6;

const recipeInput = (tiles = TILES): BridgeRecipeInput => {
  const length = tiles * 0.5;
  return {
    deckTopAt: along => 0.8 + 0.04 * tiles * Math.sin(Math.PI * Math.min(1, Math.max(0, along / length))),
    detailed: true,
    length,
    terrainAt: () => 0,
    tiles,
    waterAt: () => -0.5
  };
};

const buildingPart = (part: BridgeRecipe["parts"][number]["part"]): BuildingPart => {
  if ("kind" in part) throw new Error("Bridge recipes must use building parts");
  return part;
};

const material = new MeshStandardMaterial();
const materials = new Proxy({} as Record<BuildingSurface, MeshStandardMaterial>, {
  get: () => material
});

const modelFor = (recipe: BridgeRecipe) => {
  const model = createBridgeModel(recipe, materials, true);
  return model;
};

const drawCounts = (recipe: BridgeRecipe, progress: number) => {
  const model = createBridgeModel(recipe, materials, true);
  model.setProgress(progress);
  const counts = model.root.children.map(child => {
    const mesh = child as import("three").Mesh;
    return mesh.geometry.drawRange.count;
  });
  model.dispose();
  return counts;
};

describe("bridge art recipes", () => {
  it("builds the wooden model from foundations through deck to railings", () => {
    const recipe = woodBridgeRecipe(recipeInput());
    const counts = [0, 0.2, 0.5, 0.9, 1].map(progress => drawCounts(recipe, progress));
    for (let progress = 1; progress < counts.length; progress += 1)
      for (let mesh = 0; mesh < counts[progress]!.length; mesh += 1)
        expect(counts[progress]![mesh]).toBeGreaterThanOrEqual(counts[progress - 1]![mesh]!);
    const full = modelFor(recipe);
    for (const child of full.root.children) {
      const mesh = child as import("three").Mesh;
      expect(mesh.geometry.drawRange.count).toBe(mesh.geometry.getAttribute("position").count);
    }
    full.dispose();
  });

  it("keeps the clear deck prism free and every pile below the water", () => {
    const tiles = 8, length = tiles * 0.5;
    const recipe = woodBridgeRecipe(recipeInput(tiles));
    for (const { part } of recipe.parts) {
      const building = buildingPart(part);
      const [x, y, z] = building.position;
      // Rotation aware: the level-1 deck poles are cylinders laid across the deck.
      const box = bounds(building);
      const deck = 0.8 + 0.04 * tiles * Math.sin(Math.PI * Math.min(1, Math.max(0, x / length))) + 0.01;
      if (box.max[1] <= deck) continue;
      const insideClearWidth = box.min[2] >= -1.15 && box.max[2] <= 1.15;
      expect(insideClearWidth, `part at ${x}/${y}/${z}`).toBe(false);
    }
    const piles = recipe.parts.map(({ part }) => buildingPart(part))
      .filter(part => part.shape === "cylinder" && part.surface === "bark");
    expect(piles.length).toBeGreaterThan(0);
    for (const pile of piles) expect(pile.position[1] - pile.size[1] / 2).toBeLessThan(-0.5);
  });

  it("meets the wooden triangle budget on both detail levels", () => {
    const high = modelFor(woodBridgeRecipe(recipeInput()));
    // Owner 2026-11-07: the level-1 pole deck and the timber landings over both road ends.
    expect(high.triangles).toBeLessThanOrEqual(5_600);
    high.dispose();
    const minimal = createBridgeModel(woodBridgeRecipe({ ...recipeInput(), detailed: false }), materials, false);
    expect(minimal.triangles).toBeLessThanOrEqual(1_500);
    minimal.dispose();
  });

  it("uses slabs for three-tile stone crossings and arches for longer spans", () => {
    const slab = stoneSlabBridgeRecipe(recipeInput(3));
    expect(slab.parts.some(({ part }) => buildingPart(part).shape === "stone-block")).toBe(true);
    const arch = stoneArchBridgeRecipe(recipeInput(6));
    const rings = arch.parts.map(({ part }) => buildingPart(part))
      .filter(part => part.surface === "cut-stone" && part.shape === "bevel-box" && Math.abs(part.position[2]) < 1e-6);
    expect(rings.length).toBeGreaterThanOrEqual(20);
    for (const ring of rings) {
      const nearest = rings.filter(other => other !== ring)
        .reduce((best, other) => Math.min(best, Math.hypot(
          other.position[0] - ring.position[0], other.position[1] - ring.position[1])), Infinity);
      const neighbours = rings.filter(other => other !== ring &&
        Math.hypot(other.position[0] - ring.position[0], other.position[1] - ring.position[1]) <= nearest + 1e-9);
      expect(neighbours.some(other =>
        Math.hypot(other.position[0] - ring.position[0], other.position[1] - ring.position[1]) <=
          (other.size[0] + ring.size[0]) * 0.55)).toBe(true);
    }
  });

  it("meets the stone triangle budgets on both detail levels", () => {
    const cases = [
      { high: 6_000, minimal: 1_800, recipe: stoneSlabBridgeRecipe(recipeInput(3)) },
      { high: 9_000, minimal: 2_500, recipe: stoneArchBridgeRecipe(recipeInput(6)) }
    ];
    for (const entry of cases) {
      const high = modelFor(entry.recipe);
      expect(high.triangles).toBeLessThanOrEqual(entry.high);
      high.dispose();
      const minimal = createBridgeModel(entry.recipe, materials, false);
      expect(minimal.triangles).toBeLessThanOrEqual(entry.minimal);
      minimal.dispose();
    }
  });
});
