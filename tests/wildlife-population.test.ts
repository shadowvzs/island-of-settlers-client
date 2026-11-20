import { describe, expect, it } from "vitest";

import { createAnimalManager } from "../src/render-common/wildlife/animal-manager";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { RESPAWN_TICKS } from "../src/render-common/wildlife/population/respawn-ledger";
import { ISLAND_ANIMAL_CAP } from "../src/render-common/wildlife/population/wildlife-regions";
import type { WorldData } from "../src/shared/world/world-data";
import { forestWorld } from "./helpers/forest-world";

type Manager = ReturnType<typeof createAnimalManager>;

/** Ticks for the first population's failed placements to retry (3 s each) until it is complete. */
const SETTLE_TICKS = 600;

const createPopulation = (world: WorldData, settle = SETTLE_TICKS) => {
  const animals = createAnimalManager(world, createIslandNav(world, []));
  for (let tick = 0; tick <= settle; tick += 1) animals.step();
  return animals;
};

/** The tree props standing in `region`. */
const regionTrees = (world: WorldData, animals: Manager, region: number) =>
  Array.from({ length: world.props.count }, (_, id) => id)
    .filter((id) => animals.debug.regions.regionOf(world.props.x[id]!, world.props.z[id]!) === region);

/** A living animal of the region (woken by a kill's threat or a hunter's scan if dormant). */
const residentOf = (animals: Manager, region: number) =>
  [...animals.debug.identity.homeRegion.keys()].find((slot) => animals.debug.identity.homeRegion[slot] === region)!;

const step = (animals: Manager, ticks: number) => {
  for (let tick = 0; tick < ticks; tick += 1) animals.step();
};

describe("regional wildlife population (Wildlife 2.0)", () => {
  it("fills every region to its target on the first step and never exceeds the island cap", () => {
    const world = forestWorld(192, 1.65);
    const animals = createPopulation(world, 0);
    const { ledger, regions } = animals.debug;
    let targets = 0;
    for (let region = 0; region < regions.count; region += 1) {
      expect(regions.population[region]).toBeLessThanOrEqual(regions.target[region]!);
      expect(regions.population[region]! + ledger.pending(region)).toBe(regions.target[region]);
      expect(regions.target[region]).toBeLessThanOrEqual(regions.capacity[region]!);
      targets += regions.target[region]!;
    }
    expect(regions.sumCapacity()).toBeGreaterThan(ISLAND_ANIMAL_CAP);
    expect(targets).toBe(ISLAND_ANIMAL_CAP);
    expect(animals.countAlive()).toBeGreaterThan(ISLAND_ANIMAL_CAP / 2);
    expect(animals.countAlive()).toBeLessThanOrEqual(ISLAND_ANIMAL_CAP);
  });

  it("brings a killed animal back five minutes later, not before", () => {
    const world = forestWorld(64, 1.65);
    const animals = createPopulation(world);
    const { regions } = animals.debug;
    const before = regions.population[0]!;
    animals.killAnimal(residentOf(animals, 0));
    expect(regions.population[0]).toBe(before - 1);
    step(animals, RESPAWN_TICKS - 10);
    expect(regions.population[0]).toBe(before - 1);
    step(animals, 20);
    expect(regions.population[0]).toBe(before);
  });

  it("lowers a felled region's target: survivors stay and owed respawns are dropped", () => {
    const world = forestWorld(64, 1.65);
    const animals = createPopulation(world);
    const { ledger, regions } = animals.debug;
    animals.killAnimal(residentOf(animals, 0));
    expect(ledger.pending(0)).toBe(1);
    const living = regions.population[0]!;
    for (const tree of regionTrees(world, animals, 0).slice(0, 200)) animals.onTreeFelled(tree);
    expect(regions.target[0]).toBeLessThan(living);
    expect(regions.population[0]).toBe(living);
    expect(ledger.pending(0)).toBe(0);
    step(animals, RESPAWN_TICKS + 20);
    expect(regions.population[0]).toBe(living);
  });

  it("recovers with forestry: trees growing up raise the capacity, the newcomer arrives five minutes later", () => {
    const world = forestWorld(64, 1.65);
    const animals = createPopulation(world);
    const { ledger, regions } = animals.debug;
    const full = regions.population[0]!;
    expect(full).toBe(regions.target[0]);
    const felled = regionTrees(world, animals, 0).slice(0, 150);
    for (const tree of felled) animals.onTreeFelled(tree);
    animals.killAnimal(residentOf(animals, 0));
    expect(regions.target[0]).toBeLessThan(full - 1);
    step(animals, RESPAWN_TICKS + 20);
    const settled = regions.population[0]!;
    expect(settled).toBe(full - 1);
    for (const tree of felled) animals.onTreeGrown(tree);
    expect(regions.target[0]).toBe(full);
    expect(ledger.pending(0)).toBe(full - settled);
    step(animals, RESPAWN_TICKS - 20);
    expect(regions.population[0]).toBe(settled);
    step(animals, 40);
    expect(regions.population[0]).toBe(full);
  });
});
