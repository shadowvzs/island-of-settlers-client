import { expect, it } from "vitest";

import { BUILDING_CATALOG, getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { paintBuildingSurface } from "../src/renderers/three/buildings/building-surface-paint";
import { mayaCarvedLimestoneDetail, mayaLimestoneDetail } from "../src/renderers/three/buildings/maya-stone-detail";

const point = (u: number, v: number) => ({ u, v, grain: .5, mineral: .5, weather: .5 });
it("uses four straight block courses per unit rather than dense Roman brick courses", () => {
  const heights = Array.from({ length: 301 }, (_, index) => mayaLimestoneDetail(point(.23, index / 300)).height);
  let seams = 0;
  for (let index = 1; index < heights.length; index++)
    if (heights[index]! < .5 && heights[index - 1]! >= .5) seams++;
  expect(seams).toBe(4);
});

it("cuts selected carvings below the unchanged stone surface and leaves bare blocks between them", () => {
  let cut = 0, bare = 0;
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const p = point(x / 100, y / 100), plain = mayaLimestoneDetail(p), carved = mayaCarvedLimestoneDetail(p);
    expect(carved.height).toBeLessThanOrEqual(plain.height + 1e-12);
    if (plain.height - carved.height > .07) {
      cut++; expect(carved.brightness).toBeLessThan(plain.brightness);
    } else if (plain.height > .60) bare++;
  }
  expect(cut).toBeGreaterThan(100);
  expect(bare).toBeGreaterThan(cut * 3);
});

it("paints the same readable cavity colour for High and Minimal; High adds real groove normals", () => {
  const common = { nation: "maya" as const, surface: "plaster" as const, resolution: 128 };
  const high = paintBuildingSurface({ ...common, detailed: true });
  const minimal = paintBuildingSurface({ ...common, detailed: false });
  expect(high[0]).toEqual(minimal[0]);
  expect(high).toHaveLength(3); expect(minimal).toHaveLength(1);
  const normalX = high[1]!.filter((_, index) => index % 4 === 0);
  expect(new Set(normalX).size).toBeGreaterThan(1);
  expect(Math.max(...normalX) - Math.min(...normalX)).toBeLessThan(64);
});

it("keeps every specialist stone wall light even when its real stock is dark basalt", () => {
  for (const detailed of [false, true]) for (const id of BUILDING_CATALOG
    .filter(definition => definition.id >= 45 && definition.id <= 56).map(definition => definition.id)) {
    const recipe = createNationBuildingRecipe(getBuildingDefinition(id), "maya", detailed);
    const walls = recipe.parts.filter(part => !part.stock && part.stage === 1 &&
      part.size[1] > .25 && ["plaster", "stone", "cut-stone"].includes(part.surface));
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.every(part => part.tint?.every(channel => channel >= .85))).toBe(true);
    if (id === 51) expect(recipe.parts.some(part => part.stock?.ware === "basalt")).toBe(true);
  }
});

it("keeps bare stone faces within close light shades despite weathering", () => {
  const brightness: number[] = [];
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
    const sample = mayaLimestoneDetail(point(x / 40, y / 40));
    if (sample.height > .60) brightness.push(sample.brightness);
  }
  expect(Math.min(...brightness)).toBeGreaterThan(.92);
  expect(Math.max(...brightness) / Math.min(...brightness)).toBeLessThan(1.15);
});

it("keeps the horizontal beds straight and shifts alternate vertical joints by half a block", () => {
  for (let column = 1; column < 40; column++) {
    expect(mayaLimestoneDetail(point(column / 40, .25)).height).toBeCloseTo(.46);
  }
  expect(mayaLimestoneDetail(point(.5, .125)).height).toBeCloseTo(.46);
  expect(mayaLimestoneDetail(point(.25, .375)).height).toBeCloseTo(.46);
  expect(mayaLimestoneDetail(point(.5, .375)).height).toBeGreaterThan(.61);
});
