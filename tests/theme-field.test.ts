import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORLD_OPTIONS,
  generateWorld
} from "../src/shared/world/generation/generate-world";
import {
  blendThemes,
  getThemeParameters,
  ISLAND_THEMES,
  THEME_COUNT
} from "../src/shared/world/generation/island-themes";
import { labelLandmasses } from "../src/shared/world/generation/plateaus";
import { isShrub } from "../src/shared/world/generation/shrub-rules";
import {
  createThemeSampler,
  createUniformLayout,
  type ThemeLayout
} from "../src/shared/world/generation/theme-field";
import { getVertexCount } from "../src/shared/world/grid-geometry";
import { smoothstep } from "../src/shared/world/noise";
import { MATERIAL, MATERIAL_COUNT, PROP, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const OPTIONS = { ...DEFAULT_WORLD_OPTIONS, cellsX: 128, cellsZ: 128, seed: 1234 };
const DESERT = ISLAND_THEMES.indexOf("desert");
const MEADOW = ISLAND_THEMES.indexOf("meadow");
/** Border band of the test layout (x in cells): desert west of it, meadow east of it. */
const BORDER: [number, number] = [56, 72];

/** Test only strategy: the west half desert, the east half meadow, blended across the border. */
const halfDesertLayout: ThemeLayout = ({ grid }) => {
  const weights = new Uint8Array(getVertexCount(grid) * THEME_COUNT);
  for (let vertex = 0; vertex < getVertexCount(grid); vertex += 1) {
    const meadow = Math.round(smoothstep(...BORDER, vertex % (grid.cellsX + 1)) * 255);
    weights[vertex * THEME_COUNT + MEADOW] = meadow;
    weights[vertex * THEME_COUNT + DESERT] = 255 - meadow;
  }
  return weights;
};

/** Average sand and green (grass, lush grass, forest floor) share of dry land with x in range. */
const getShares = (world: WorldData, fromX: number, toX: number) => {
  const totals = { grass: 0, land: 0, sand: 0 };
  world.waterDepth.forEach((depth, vertex) => {
    const x = vertex % (world.cellsX + 1);
    if (depth > 0 || x < fromX || x >= toX) return;
    const read = (material: number) => world.splat[vertex * MATERIAL_COUNT + material]! / 255;
    totals.land += 1;
    totals.sand += read(MATERIAL.sand);
    totals.grass += read(MATERIAL.grass) + read(MATERIAL.lushGrass) + read(MATERIAL.forestFloor);
  });
  return { grass: totals.grass / totals.land, sand: totals.sand / totals.land };
};

describe("theme field", () => {
  it("blends the theme table by weight; a single theme is its exact entry", () => {
    expect(blendThemes([255, 0, 0])).toBe(getThemeParameters(ISLAND_THEMES[0]));
    const weights = new Array<number>(THEME_COUNT).fill(0);
    weights[DESERT] = 1;
    weights[MEADOW] = 1;
    const mixed = blendThemes(weights);
    const desert = getThemeParameters("desert");
    const meadow = getThemeParameters("meadow");
    expect(mixed.sand).toBeCloseTo((desert.sand + meadow.sand) / 2);
    expect(mixed.cover.tint[2]).toBeCloseTo((desert.cover.tint[2] + meadow.cover.tint[2]) / 2);
    expect(mixed.vegetation.palm).toBeCloseTo(
      (desert.vegetation.palm + meadow.vegetation.palm) / 2
    );
  });

  it("stores the uniform layout as one full weight per vertex", () => {
    const grid = { cellsX: 4, cellsZ: 4 };
    const weights = createUniformLayout("dirt")({ grid, heights: new Float32Array(25) });
    expect(weights).toHaveLength(25 * THEME_COUNT);
    const sampler = createThemeSampler(grid, weights);
    expect(sampler.at(2.5, 1.5)).toBe(getThemeParameters("dirt"));
  });

  it("generates each side with its own theme and a blended border", () => {
    const world = generateWorld(OPTIONS, halfDesertLayout);
    const west = getShares(world, 0, BORDER[0] - 4);
    const border = getShares(world, BORDER[0] + 4, BORDER[1] - 4);
    const east = getShares(world, BORDER[1] + 4, world.cellsX + 1);
    expect(west.sand).toBeGreaterThan(0.45);
    expect(west.sand).toBeGreaterThan(west.grass);
    // Not higher: the ground chain puts pebbles and dirt between rock and grass.
    expect(east.grass).toBeGreaterThan(0.35);
    expect(east.grass).toBeGreaterThan(west.grass * 2);
    expect(east.sand).toBeLessThan(0.15);
    expect(border.sand).toBeLessThan(west.sand);
    expect(border.sand).toBeGreaterThan(east.sand);
    const middle = 64 * THEME_COUNT;
    expect(world.themeWeights[middle + DESERT]).toBeGreaterThan(0);
    expect(world.themeWeights[middle + MEADOW]).toBeGreaterThan(0);
  });

  it("keeps the uniform default identical to the selected theme", () => {
    const uniform = generateWorld(OPTIONS, createUniformLayout("meadow"));
    expect(uniform.splat).toEqual(cachedWorld(OPTIONS).splat);
  });
});

const countProps = (world: WorldData, isKind: (type: number) => boolean) =>
  world.props.types.reduce((count, type) => (isKind(type) ? count + 1 : count), 0);

/** Average share of a material over the dry vertices that pass `isIn`. */
const getMaterialShare = (
  world: WorldData,
  material: number,
  isIn: (vertex: number) => boolean = () => true
) => {
  let land = 0;
  let share = 0;
  world.waterDepth.forEach((depth, vertex) => {
    if (depth > 0 || !isIn(vertex)) return;
    land += 1;
    share += world.splat[vertex * MATERIAL_COUNT + material]! / 255;
  });
  return share / Math.max(1, land);
};

/** The theme with the full weight at a vertex. */
const getVertexTheme = (world: WorldData, vertex: number) =>
  ISLAND_THEMES.find((_, slot) => world.themeWeights[vertex * THEME_COUNT + slot] === 255);

describe("snowy theme", () => {
  const meadow = cachedWorld(OPTIONS);
  const snowy = cachedWorld({ ...OPTIONS, theme: "snowy" });
  const isKind = (kind: number) => (type: number) => type === kind;

  it("covers the open land in snow, grass only in sheltered spots", () => {
    expect(getMaterialShare(snowy, MATERIAL.snow)).toBeGreaterThan(0.4);
    expect(getMaterialShare(snowy, MATERIAL.grass)).toBeLessThan(
      getMaterialShare(meadow, MATERIAL.grass) * 0.4
    );
    expect(getMaterialShare(snowy, MATERIAL.lushGrass)).toBe(0);
  });

  it("grows conifer forests, no palms and few bushes", () => {
    const conifers = countProps(snowy, isKind(PROP.coniferTree));
    expect(countProps(snowy, isKind(PROP.palmTree))).toBe(0);
    expect(conifers).toBeGreaterThan(countProps(snowy, isKind(PROP.broadleafTree)) * 3);
    expect(conifers).toBeGreaterThan(countProps(meadow, isKind(PROP.coniferTree)));
    expect(countProps(snowy, isShrub)).toBeLessThan(countProps(meadow, isShrub) * 0.2);
  });

  it("thins the wildlife and lowers the snow line on the trees and rocks", () => {
    const parameters = getThemeParameters("snowy");
    expect(parameters.wildlife).toBeLessThan(0.6);
    expect(parameters.snow).toBeGreaterThan(0.5);
    expect(parameters.rockBuffer.snow).toBe(1);
  });
});

describe("per landmass theme layout", () => {
  // Playable Islands fit one island on 128 maps (docs/contracts/playable-islands.md); 192 holds several.
  const options = { ...OPTIONS, cellsX: 192, cellsZ: 192, landform: "archipelago" as const, seed: 42 };
  const world = cachedWorld({ ...options, theme: "snowy", themeLayout: "landmass" });
  const { labels, landmasses } = labelLandmasses(world, world.heights);
  const isOn = (label: number) => (vertex: number) => labels[vertex] === label;

  it("gives the main island the selected theme and the other islands other themes", () => {
    expect(landmasses.length).toBeGreaterThan(2);
    const main = landmasses[0]!.label;
    expect(getVertexTheme(world, main)).toBe("snowy");
    const islands = landmasses.slice(1).filter(({ size }) => size >= 150);
    const others = new Set(islands.map(({ label }) => getVertexTheme(world, label)));
    expect(others.has("snowy")).toBe(false);
    expect(others.size).toBeGreaterThan(1);
  });

  it("keeps one theme per landmass, its ground follows it", () => {
    for (const { label } of landmasses) {
      const theme = getVertexTheme(world, label);
      labels.forEach((other, vertex) => {
        if (other === label) expect(getVertexTheme(world, vertex)).toBe(theme);
      });
    }
    const main = landmasses[0]!.label;
    expect(getMaterialShare(world, MATERIAL.snow, isOn(main))).toBeGreaterThan(0.35);
    const warm = landmasses.find(({ label }) => getVertexTheme(world, label) === "desert");
    if (warm) expect(getMaterialShare(world, MATERIAL.snow, isOn(warm.label))).toBeLessThan(0.05);
  });

  it("leaves a single island one theme", () => {
    const island = cachedWorld({ ...OPTIONS, themeLayout: "landmass" });
    expect(island.themeWeights).toEqual(meadowWeights());
  });
});

const meadowWeights = () => cachedWorld(OPTIONS).themeWeights;
