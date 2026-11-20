import { beforeAll, describe, expect, it } from "vitest";

import {
  adventureMountainAmount, generateAdventureWorld
} from "../src/shared/world/generation/colony-world";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { createMountainField } from "../src/shared/world/rock-cover";
import type { WorldData } from "../src/shared/world/world-data";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

describe("adventure mountain frequency", () => {
  it("keeps tall relief uncommon and deterministic across island seeds", () => {
    const amounts = Array.from({ length: 1000 }, (_, seed) => adventureMountainAmount(seed));
    const tall = amounts.filter(amount => amount === 1).length;
    expect(tall).toBeGreaterThan(100);
    expect(tall).toBeLessThan(200);
    expect(amounts.every(amount => amount === 1 || amount === .35)).toBe(true);
    expect(amounts).toEqual(Array.from({ length: 1000 }, (_, seed) => adventureMountainAmount(seed)));
  });

  const island = { seed: 1308404504, size: 96 };
  let adventure: WorldData;
  beforeAll(() => {
    adventure = generateAdventureWorld(island);
  });
  const formerOptions = { ...DEFAULT_WORLD_OPTIONS, cellsX: island.size, cellsZ: island.size,
    mountains: 1, rivers: 0, seed: island.seed };
  preloadWorlds(formerOptions);

  it("reduces the reported adventure's mountain terrain without changing the generic generator", () => {
    expect(adventureMountainAmount(island.seed)).toBe(.35);
    const former = cachedWorld(formerOptions);
    const mountainCells = (world: WorldData) =>
      createMountainField(world, world.heights).filter(share => share > .5).length;
    expect(mountainCells(adventure)).toBeLessThan(mountainCells(former));
    expect(adventure.heights.length).toBe(former.heights.length);
  });
});
