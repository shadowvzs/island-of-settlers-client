import { describe, expect, it } from "vitest";

import {
  DEFAULT_ISLAND_CHOICE,
  readIslandChoice,
  writeIslandQuery
} from "../src/app/map-generator/helpers";
import { DEFAULT_WORLD_OPTIONS, type WorldOptions } from "../src/shared/world/generation/generate-world";
import { ISLAND_THEMES, THEME_COUNT } from "../src/shared/world/generation/island-themes";
import { createThemeLayout, createThemeSampler } from "../src/shared/world/generation/theme-field";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

const grid = { cellsX: 32, cellsZ: 32 };
const heights = Float32Array.from({ length: 33 ** 2 }, (_, index) => ((index % 33) / 32) * 12);
const inputs = { grid, heights, seed: 42 };
const share = (weights: Uint8Array, vertex: number, theme: (typeof ISLAND_THEMES)[number]) =>
  weights[vertex * THEME_COUNT + ISLAND_THEMES.indexOf(theme)];

describe("theme band layouts", () => {
  it.each(["altitude", "latitude", "regions"] as const)(
    "preserves normalized deterministic %s weights",
    (kind) => {
      for (const theme of ISLAND_THEMES) {
        const layout = createThemeLayout(theme, kind),
          weights = layout(inputs);
        expect(layout(inputs)).toEqual(weights);
        for (let vertex = 0; vertex < heights.length; vertex++)
          expect(
            weights
              .subarray(vertex * THEME_COUNT, (vertex + 1) * THEME_COUNT)
              .reduce((sum, weight) => sum + weight, 0)
          ).toBe(255);
        expect(
          createThemeSampler(grid, weights).at(12.5, 12.5).vegetation.warmth
        ).toBeGreaterThanOrEqual(0);
      }
    }
  );
  it("keeps the selected lowland theme and snowy peaks with blended altitude transitions", () => {
    const weights = createThemeLayout("meadow", "altitude")(inputs);
    expect(share(weights, 0, "meadow")).toBe(255);
    expect(share(weights, 32, "snowy")).toBe(255);
    expect(share(weights, 8, "meadow")).toBeGreaterThan(0);
    expect(share(weights, 8, "dirt")).toBeGreaterThan(0);
  });
  it("runs cold north, selected centre and warm south independent of altitude", () => {
    const weights = createThemeLayout("meadow", "latitude")(inputs);
    expect(share(weights, 16, "snowy")).toBe(255);
    expect(share(weights, 16 * 33 + 16, "meadow")).toBe(255);
    expect(share(weights, 32 * 33 + 16, "desert")).toBe(255);
  });
  it("changes natural regions with the seed without changing input terrain", () => {
    const before = heights.slice(),
      layout = createThemeLayout("meadow", "regions");
    expect(layout(inputs)).not.toEqual(layout({ ...inputs, seed: 43 }));
    expect(heights).toEqual(before);
  });
  it.each(["altitude", "latitude", "regions"] as const)(
    "round trips %s through generation settings",
    (kind) => {
      const choice = readIslandChoice(
        new URLSearchParams(`themeLayout=${kind}`),
        DEFAULT_ISLAND_CHOICE
      );
      expect(choice.themeLayout).toBe(kind);
      const query = new URLSearchParams();
      writeIslandQuery(query, choice);
      expect(readIslandChoice(query, DEFAULT_ISLAND_CHOICE).themeLayout).toBe(kind);
    }
  );
  const REGIONS_WORLD: WorldOptions = {
    ...DEFAULT_WORLD_OPTIONS,
    cellsX: 96,
    cellsZ: 96,
    erosionDroplets: 0,
    themeLayout: "regions"
  };
  preloadWorlds(REGIONS_WORLD);
  it("preserves blended regions and shaped seabed through a saved map", async () => {
    const world = cachedWorld(REGIONS_WORLD);
    expect(world.themeWeights.some((weight) => weight > 0 && weight < 255)).toBe(true);
    const bytes = await writeMapFile(world, {
      animals: [],
      name: "Regions",
      savedAt: 1,
      source: "themeLayout=regions"
    });
    const { world: loaded } = await readMapFile(bytes);
    expect(loaded.themeWeights).toEqual(world.themeWeights);
    expect(loaded.heights).toEqual(world.heights);
    expect(loaded.waterDepth).toEqual(world.waterDepth);
    expect(loaded.splat).toEqual(world.splat);
  });
});
