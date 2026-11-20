import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { buildingLevelAdditions, leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { getNationBuildingDefinition } from "../src/render-common/buildings/nation-building-text";
import { paintMayaHeadquartersTextile } from "../src/render-common/props/maya-headquarters-textile";
import { unsupportedParts } from "./helpers/recipe-supports";

const NATIONS = ["roman", "viking", "nubian", "japanese", "maya", "persian", "chinese", "indigenous"] as const;

it.each(NATIONS)("keeps generic circle-cloth level decoration out of every %s variant", nation => {
  for (const detailed of [true, false]) for (const { id } of BUILDING_CATALOG)
    for (const level of [1, 2, 3, 4, 5] as const) {
      const definition = getNationBuildingDefinition(id, nation);
      const added = buildingLevelAdditions(definition, nation, detailed, level);
      const cloth = added.filter(part => part.surface === "cloth" && part.shape === "box");
      const wellException = id === 35 && (nation === "maya" || nation === "indigenous");
      expect(cloth.every(part => part.shape === "maya-headquarters-textile" || wellException),
        `${nation}/${id}/${detailed}/${level}`).toBe(true);
    }
});

it.each([true, false])("mounts one original Maya HQ textile clear of the upper front doorway (detail %s)", detailed => {
  const definition = getNationBuildingDefinition(0, "maya");
  const recipe = leveledBuildingRecipe(definition, "maya", detailed, 5);
  const textiles = recipe.parts.filter(part => part.shape === "maya-headquarters-textile");
  expect(textiles).toHaveLength(1);
  const textile = textiles[0]!;
  expect(textile.rotation?.[1]).toBe(Math.PI / 2);
  expect(textile.position[0]).toBeGreaterThan(.8);
  expect(unsupportedParts(recipe).filter(entry => entry.shape === "maya-headquarters-textile")).toEqual([]);
});

it("audits all wells: retained markers are behind the shaft and clear of actual working geometry", () => {
  for (const nation of NATIONS) for (const detailed of [true, false]) {
    const definition = getNationBuildingDefinition(35, nation);
    const fourth = leveledBuildingRecipe(definition, nation, detailed, 4);
    const fifth = leveledBuildingRecipe(definition, nation, detailed, 5);
    const retained = fifth.parts.filter(part => part.surface === "cloth");
    if (nation !== "maya" && nation !== "indigenous") { expect(retained, nation).toEqual([]); continue; }
    expect(retained, nation).toHaveLength(1);
    const cloth = retained[0]!;
    expect(cloth.position[2]).toBeLessThan(-.6); // Operator and crank occupy the opposite +Z side.
    const bounds = getRomanPartBounds(cloth);
    for (const part of fourth.parts) {
      const other = getRomanPartBounds(part);
      const overlaps = [0, 1, 2].every(axis => bounds.min[axis]! < other.max[axis]! && bounds.max[axis]! > other.min[axis]!);
      expect(overlaps, `${nation}/${detailed}/${part.shape}@${part.position.join(",")}`).toBe(false);
    }
  }
});

it("paints an opaque multicolour quetzal with a paired tail and embroidered relief at both map sizes", () => {
  for (const size of [256, 512]) {
    const { heights, pixels } = paintMayaHeadquartersTextile(size);
    expect(pixels).toHaveLength(size * size * 4);
    expect(heights).toHaveLength(size * size);
    expect(pixels.filter((_, index) => index % 4 === 3).every(alpha => alpha === 255)).toBe(true);
    const at = (u: number, v: number) => pixels.slice((Math.floor(v * size) * size + Math.floor(u * size)) * 4,
      (Math.floor(v * size) * size + Math.floor(u * size)) * 4 + 3);
    const tail = at(.35, .84), background = at(.8, .6), beak = at(.73, .31);
    expect(tail[1]!).toBeGreaterThan(tail[0]!);
    expect(background[0]!).toBeGreaterThan(background[1]! * 2);
    expect(beak[0]!).toBeGreaterThan(beak[2]! * 2);
    expect(Math.max(...heights.slice(0, 10000)) - Math.min(...heights.slice(0, 10000))).toBeGreaterThan(.1);
  }
});

it("keeps Maya roof monitors weatherproof as a whole within the original height cap", () => {
  for (const detailed of [true, false]) for (const level of [4, 5] as const) {
    for (const id of [33, 61]) {
      const recipe = leveledBuildingRecipe(getNationBuildingDefinition(id, "maya"), "maya", detailed, level);
      expect(recipe.parts.filter(part => part.stage === 4 && part.architecture), `${id}/${detailed}/${level}`)
        .toEqual([]); // Their complete cap cannot fit; no bare walls or posts may survive alone.
    }
    const fitting = leveledBuildingRecipe(getNationBuildingDefinition(17, "maya"), "maya", detailed, level);
    const monitor = fitting.parts.filter(part => part.stage === 4 && part.architecture);
    expect(monitor.some(part => part.shape === "occupation-roof")).toBe(true);
    expect(monitor.some(part => part.shape === "roof-infill")).toBe(true);
    expect(monitor.filter(part => part.roofSupport)).toHaveLength(4);
  }
});
