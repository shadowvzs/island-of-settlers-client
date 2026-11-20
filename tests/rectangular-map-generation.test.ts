import { expect, it } from "vitest";

import { DEFAULT_ISLAND_CHOICE, readIslandChoice, toWorldOptions } from "../src/app/map-generator/helpers";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { cachedWorld } from "./helpers/cached-worlds";

it.each([[64, 128], [128, 64]])("generates and saves a %s × %s map", async (width, height) => {
  const choice = readIslandChoice(new URLSearchParams(`width=${width}&height=${height}&landform=peninsula`),
    DEFAULT_ISLAND_CHOICE);
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, ...toWorldOptions(choice), seed: 77,
    erosionDroplets: 100, forest: 0, rivers: 0 });
  expect([world.cellsX, world.cellsZ]).toEqual([width, height]);
  expect(world.heights.length).toBe((width + 1) * (height + 1));
  expect(Array.from(world.heights).every(Number.isFinite)).toBe(true);
  const { world: loaded } = await readMapFile(await writeMapFile(world, {
    animals: [], name: "Rectangular map", savedAt: 1, source: `width=${width}&height=${height}`
  }));
  expect([loaded.cellsX, loaded.cellsZ]).toEqual([width, height]);
  expect(loaded.heights).toEqual(world.heights);
});
