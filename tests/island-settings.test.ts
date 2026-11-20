import { describe, expect, it } from "vitest";

import {
  clampMapSize,
  DEFAULT_ISLAND_CHOICE,
  formatIslandChoice,
  type IslandChoice,
  parseIslandChoice,
  readIslandChoice,
  toWorldOptions,
  writeIslandQuery} from "../src/app/map-generator/helpers";
import {
  DEFAULT_WORLD_OPTIONS,
  RIVER_AREA_EXPONENT
} from "../src/shared/world/generation/generate-world";
import { scaleCount } from "../src/shared/world/generation/world-scale";

const read = (search: string, base = DEFAULT_ISLAND_CHOICE) =>
  readIslandChoice(new URLSearchParams(search), base);

/** terrain-seed-v8: eroded relief and tall summits are part of every default-based choice. */
const CUSTOM: IslandChoice = {
  fluvialErosion: 1,
  forest: 2,
  landform: "peninsula",
  similarIslandSizes: false,
  islandCount: 1,
  mountains: 0,
  peakUplift: 1,
  rivers: 0,
  size: 128,
  theme: "snowy",
  themeLayout: "landmass"
};

describe("island settings", () => {
  it("defaults to a world without rivers", () => {
    expect(read("")).toEqual(DEFAULT_ISLAND_CHOICE);
    const options = { ...DEFAULT_WORLD_OPTIONS, ...toWorldOptions(DEFAULT_ISLAND_CHOICE) };
    expect(options.forest).toBe(.35);
    expect(options.mountains).toBe(1);
    expect(options.treeDensity).toBe(.45);
    for (const size of [64, 256]) {
      const grid = { cellsX: size, cellsZ: size };
      expect(scaleCount(grid, options.rivers, RIVER_AREA_EXPONENT)).toBe(0);
    }
    expect(toWorldOptions({ ...DEFAULT_ISLAND_CHOICE, rivers: 2 }).rivers).toBe(
      DEFAULT_WORLD_OPTIONS.rivers
    );
  });

  it("reads and validates the URL parameters", () => {
    const query = "landform=peninsula&rivers=0&forest=2&mountains=0&size=128&theme=snowy";
    expect(read(`${query}&themeLayout=landmass`)).toEqual({ ...CUSTOM, terrainVariation: 2 });
    expect(read("landform=volcano&theme=snow&themeLayout=bands&forest=7&mountains=-1")).toEqual({
      ...DEFAULT_ISLAND_CHOICE,
      forest: 4,
      mountains: 0
    });
  });

  it("clamps the map size to 64..1024", () => {
    expect(clampMapSize(10)).toBe(64);
    expect(clampMapSize(1000)).toBe(1000);
    expect(clampMapSize(2048)).toBe(1024);
    expect(clampMapSize(150.4)).toBe(150);
    expect(read("size=32").size).toBe(64);
    expect(read("size=512").size).toBe(512);
    expect(read("size=2048").size).toBe(1024);
  });

  it("lets the URL override a stored choice, key by key", () => {
    expect(read("theme=dirt", CUSTOM)).toEqual({ ...CUSTOM, theme: "dirt" });
  });

  it("round-trips through the query and the storage format", () => {
    expect(read(writeIslandQuery(new URLSearchParams("seed=5"), CUSTOM).toString())).toEqual(
      { ...CUSTOM, terrainVariation: 2 }
    );
    expect(parseIslandChoice(formatIslandChoice(CUSTOM))).toEqual({ ...CUSTOM, terrainVariation: 2 });
    expect(formatIslandChoice(DEFAULT_ISLAND_CHOICE)).toBe("");
    expect(parseIslandChoice(null)).toEqual(DEFAULT_ISLAND_CHOICE);
  });

  it("persists equal island sizes and all five amount levels", () => {
    const choice = { ...DEFAULT_ISLAND_CHOICE, similarIslandSizes: true, islandCount: 5, forest: 4, mountains: 3, size: 512 };
    expect(parseIslandChoice(formatIslandChoice(choice))).toEqual(choice);
    expect([0, 1, 2, 3, 4].map(forest => toWorldOptions({ ...choice, forest }).forest)).toEqual([0, .35, 1, 1.5, 2]);
    expect(read("rivers=4").rivers).toBe(2);
  });

  it("normalizes old single-island choices and clamps counts to the map capacity", () => {
    expect(read("landform=island&size=128&islandCount=5")).toMatchObject({ landform: "archipelago", islandCount: 1 });
    expect(read("landform=archipelago&size=192&islandCount=36").islandCount).toBe(4);
    expect(read("landform=archipelago&size=512&islandCount=36").islandCount).toBe(36);
    expect(read("landform=archipelago&size=64&islandCount=0").islandCount).toBe(1);
  });

  it("turns rivers off as zero rivers", () => {
    expect(toWorldOptions(CUSTOM)).toMatchObject({ cellsX: 128, cellsZ: 128, rivers: 0 });
  });
});

describe("rectangular map dimensions", () => {
  it("reads width and height independently and preserves them through storage", () => {
    const choice = read("width=64&height=128&landform=peninsula");
    expect(choice).toMatchObject({ width: 64, height: 128 });
    expect(toWorldOptions(choice)).toMatchObject({ cellsX: 64, cellsZ: 128 });
    expect(parseIslandChoice(formatIslandChoice(choice))).toEqual(choice);
  });

  it("keeps the other stored dimension when just one is overridden", () => {
    const choice = read("width=128&height=256");
    expect(toWorldOptions(read("width=64", choice))).toMatchObject({ cellsX: 64, cellsZ: 256 });
    expect(toWorldOptions(read("height=512", choice))).toMatchObject({ cellsX: 128, cellsZ: 512 });
    expect(toWorldOptions(read("size=192", choice))).toMatchObject({ cellsX: 192, cellsZ: 192 });
  });

  it("clamps dimensions separately and uses both axes for island capacity", () => {
    expect(toWorldOptions(read("width=3&height=900"))).toMatchObject({ cellsX: 64, cellsZ: 900 });
    expect(toWorldOptions(read("width=invalid&height=128"))).toMatchObject({ cellsX: 256, cellsZ: 128 });
    expect(read("width=192&height=512&islandCount=36").islandCount).toBe(12);
    const query = writeIslandQuery(new URLSearchParams("size=512&width=512&height=512"),
      read("width=64&height=128"));
    expect(query.has("size")).toBe(false);
    expect(query.get("width")).toBe("64");
    expect(query.get("height")).toBe("128");
  });
});
