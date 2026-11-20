import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { type BuildingRecipe, createRomanBuildingRecipe, type Point3 } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { createNationalYardDecoration, withNationalYardDecoration } from "../src/render-common/buildings/national-yard-decoration";
import { findFreeNationalYardSpot, fullYardStockBounds } from "../src/render-common/buildings/national-yard-sites";
import { createNationalYardSculptureGeometry } from "../src/renderers/three/buildings/national-yard-sculpture";

const emptyRecipe = (): BuildingRecipe => ({ parts: [], door: [0, 0, 1], doorProfile: "flat",
  workerExit: [.23, 0, 1.5], workPoint: [.23, 0, 2], mechanism: [0, 0, 0] });
const overlap = (a: ReturnType<typeof getRomanPartBounds>, b: ReturnType<typeof getRomanPartBounds>) =>
  [0, 1, 2].every(axis => a.min[axis]! < b.max[axis]! && a.max[axis]! > b.min[axis]!);

it("rejects a crowded yard without moving its parts and grounds a miniature on real paving", () => {
  const recipe = emptyRecipe(), definition = getBuildingDefinition(58), size: Point3 = [.22, .47, .2];
  recipe.parts.push({ shape: "box", position: [0, .04, 0], size: [2.4, .08, 2.4], stage: 1, surface: "stone" });
  const at = findFreeNationalYardSpot(recipe, definition, { extentX: 1.2, extentZ: 1.2 }, size);
  expect(at).not.toBeNull(); expect(at![1]).toBeCloseTo(.08);
  recipe.parts.push({ shape: "box", position: [0, 1, 0], size: [2.4, 2, 2.4], stage: 1, surface: "stone" });
  const before = structuredClone(recipe);
  expect(findFreeNationalYardSpot(recipe, definition, { extentX: 1.2, extentZ: 1.2 }, size)).toBeNull();
  expect(recipe).toEqual(before);
});

it("reserves mixed input stock even while its yard slot is empty", () => {
  const recipe = emptyRecipe(), definition = getBuildingDefinition(58);
  const limit = { extentX: 1.2, extentZ: 1.2 }, size: Point3 = [.22, .47, .2];
  const first = findFreeNationalYardSpot(recipe, definition, limit, size)!;
  // Stock layout caches use immutable recipe identity, just like finished production recipes.
  const occupied: BuildingRecipe = { ...recipe, parts: [{ shape: "box",
    position: [first[0], .08, first[2]], size: [.2, .16, .2], stage: 3, surface: "wood",
    stock: { ware: "planks", wares: ["planks", "marble"], slot: 0, kind: "input" } }] };
  expect(fullYardStockBounds(occupied, definition).length).toBeGreaterThan(1);
  const alternate = findFreeNationalYardSpot(occupied, definition, limit, size)!;
  expect(alternate).not.toBeNull();
  expect(Math.hypot(alternate[0] - first[0], alternate[2] - first[2])).toBeGreaterThan(.45);
  expect(occupied.parts[0]!.stock!.kind).toBe("input");
});

it("keeps one sparse decoration off original stock, doors, every static part and the plot edge", () => {
  for (const nation of ["chinese", "indigenous", "maya"] as const) for (const detailed of [true, false])
    for (const id of [0, 58, 62]) for (const level of [1, 3, 5] as const) {
      const definition = getBuildingDefinition(id), recipe = createNationBuildingRecipe(definition, nation, detailed, level);
      const ornaments = recipe.parts.filter(part => part.yardDecoration);
      const bare = { ...recipe, parts: recipe.parts.filter(part => !part.yardDecoration) };
      const decorated = withNationalYardDecoration(bare, definition, nation, detailed);
      const { parts: _parts, ...anchors } = decorated, { parts: _bareParts, ...originalAnchors } = bare;
      expect(anchors).toEqual(originalAnchors);
      expect(decorated.parts.filter(part => part.stock)).toEqual(bare.parts.filter(part => part.stock));
      expect(new Set(ornaments.map(part => part.yardDecoration)).size).toBeLessThanOrEqual(1);
      const limit = getRomanRecipeBounds(definition, createRomanBuildingRecipe(definition, true, false), false);
      const stock = fullYardStockBounds(bare, definition);
      const doorCentre = recipe.door[0] + (recipe.doorDimensions?.width ?? .46) / 2;
      for (const part of ornaments) {
        const bounds = getRomanPartBounds(part);
        expect(bounds.min[0]).toBeGreaterThanOrEqual(-limit.extentX);
        expect(bounds.max[0]).toBeLessThanOrEqual(limit.extentX);
        expect(bounds.min[2]).toBeGreaterThanOrEqual(-limit.extentZ);
        expect(bounds.max[2]).toBeLessThanOrEqual(limit.extentZ);
        expect(bounds.min[1]).toBeGreaterThanOrEqual(-.00001);
        if (bounds.max[2] > recipe.door[2] - .15 && bounds.min[2] < recipe.workerExit[2] + .4)
          expect(bounds.max[0] <= doorCentre - .6 || bounds.min[0] >= doorCentre + .6).toBe(true);
        expect(stock.some(other => overlap(bounds, other))).toBe(false);
        expect(bare.parts.some(other => overlap(bounds, getRomanPartBounds(other)))).toBe(false);
      }
      expect(withNationalYardDecoration(recipe, definition, nation, detailed)).toBe(recipe);
    }
});

it("leaves unselected occupations, Persian buildings and every monument unchanged", () => {
  const recipe = emptyRecipe();
  for (const nation of ["chinese", "indigenous", "maya", "persian"] as const)
    for (const id of [17, 18, 31, 35, 63])
      expect(withNationalYardDecoration(recipe, getBuildingDefinition(id), nation, true)).toBe(recipe);
});

it("exports original detailed carved meshes and cheap complete Minimal silhouettes inside their recipe boxes", () => {
  for (const variant of [0, 1]) {
    const high = createNationalYardSculptureGeometry(variant, true);
    const minimal = createNationalYardSculptureGeometry(variant, false);
    expect(high.index!.count).toBeGreaterThan(minimal.index!.count * 2);
    expect(minimal.index!.count / 3).toBeLessThan(1600);
    for (const geometry of [high, minimal]) {
      geometry.computeBoundingBox();
      const { max, min } = geometry.boundingBox!;
      for (const value of [...min.toArray(), ...max.toArray()]) expect(Math.abs(value)).toBeLessThanOrEqual(.50001);
      for (const name of ["position", "normal", "uv", "color"])
        expect(Array.from(geometry.getAttribute(name).array).every(Number.isFinite)).toBe(true);
      geometry.dispose();
    }
  }
  for (const kind of ["shrine", "totem", "figurine"] as const) for (const detailed of [true, false]) {
    const parts = createNationalYardDecoration(kind, detailed);
    expect(parts.some(part => part.stock)).toBe(false);
    expect(Math.min(...parts.map(part => getRomanPartBounds(part).min[1]))).toBeCloseTo(0);
  }
});
