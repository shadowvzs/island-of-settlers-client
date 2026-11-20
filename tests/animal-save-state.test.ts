import { describe, expect, it } from "vitest";

import { createAnimalManager } from "../src/render-common/wildlife/animal-manager";
import { validateAnimalSave, WILDLIFE_RULES_VERSION } from "../src/render-common/wildlife/manager/animal-save";
import { decodeTypedColumn, encodeTypedColumn } from "../src/render-common/wildlife/manager/typed-column";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";
import { forestWorld } from "./helpers/forest-world";

const WORLD_OPTIONS = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 100 };
preloadWorlds(WORLD_OPTIONS);

const sum = (values: Uint8Array) => values.reduce((total, value) => total + value, 0);

describe("wildlife save version 2", () => {
  it("preserves real animal identities, carcasses, Infinity timers and the respawn ledger bit-exactly", () => {
    const world = cachedWorld(WORLD_OPTIONS);
    const nav = createIslandNav(world, []),
      animals = createAnimalManager(world, nav);
    animals.listHuntTargets("wildlife", { x: 48, z: 48 }, 200);
    for (let tick = 0; tick < 200; tick++) animals.step();
    const live = animals.debug.pool.active.findIndex((value, slot) => value === 1 && !animals.debug.pool.pending[slot]);
    expect(live).toBeGreaterThanOrEqual(0);
    animals.killAnimal(live);
    animals.step();
    animals.step();
    const other = animals.debug.pool.active.findIndex((value) => value === 1);
    animals.debug.pool.stateLength[other] = Infinity;
    const saved = JSON.parse(JSON.stringify(animals.saveState()));
    expect(saved.version).toBe(WILDLIFE_RULES_VERSION);
    validateAnimalSave(saved);
    const restored = createAnimalManager(world, nav, saved);
    expect(restored.saveState()).toEqual(saved);
    expect(restored.debug.pool.carcass[live]).toBe(1);
    expect(restored.debug.pool.active[live]).toBe(0);
    expect(restored.debug.pool.stateLength[other]).toBe(Infinity);
    expect(restored.debug.ledger.count()).toBe(animals.debug.ledger.count());
    const deathTime = restored.debug.pool.deathTime[live]!;
    restored.step();
    expect(restored.debug.pool.deathTime[live]).toBeGreaterThan(deathTime);
  });

  it("round-trips a mix of dormant and simulated animals and continues identically after a reload", () => {
    const world = forestWorld(96, 1.8);
    const nav = createIslandNav(world, []);
    const animals = createAnimalManager(world, nav);
    for (let tick = 0; tick < 700; tick++) animals.step();
    animals.listHuntTargets("wildlife", { x: 20, z: 20 }, 10);
    for (let tick = 0; tick < 40; tick++) animals.step();
    const { identity, pool } = animals.debug;
    expect(sum(identity.dormant)).toBeGreaterThan(0);
    expect(sum(pool.active)).toBeGreaterThan(0);
    const saved = JSON.parse(JSON.stringify(animals.saveState()));
    const restored = createAnimalManager(world, nav, saved);
    expect(restored.saveState()).toEqual(saved);
    expect(restored.countAlive()).toBe(animals.countAlive());
    for (let tick = 0; tick < 60; tick++) {
      animals.step();
      restored.step();
    }
    expect(restored.saveState()).toEqual(animals.saveState());
    // A dormant region woken after the reload materialises the same animals at the same poses.
    animals.listHuntTargets("wildlife", { x: 80, z: 80 }, 10);
    restored.listHuntTargets("wildlife", { x: 80, z: 80 }, 10);
    for (let tick = 0; tick < 60; tick++) {
      animals.step();
      restored.step();
    }
    expect(restored.saveState()).toEqual(animals.saveState());
  });

  it("wakes animals that lived, slept and were saved exactly as continuous play does", () => {
    const world = forestWorld(96, 1.8);
    const nav = createIslandNav(world, []);
    const animals = createAnimalManager(world, nav);
    for (let tick = 0; tick < 200; tick++) animals.step();
    // They walk while simulated, then sleep: their slots keep the routes of that life.
    animals.listHuntTargets("wildlife", { x: 48, z: 48 }, 60);
    for (let tick = 0; tick < 1400; tick++) animals.step();
    expect(animals.countSimulatedRegions()).toBe(0);
    const restored = createAnimalManager(world, nav, JSON.parse(JSON.stringify(animals.saveState())));
    for (const manager of [animals, restored]) manager.listHuntTargets("wildlife", { x: 48, z: 48 }, 60);
    expect(restored.saveState()).toEqual(animals.saveState());
    for (let tick = 0; tick < 200; tick++) {
      animals.step();
      restored.step();
    }
    expect(restored.saveState()).toEqual(animals.saveState());
  });

  it("rejects saves of the old rules and invalid columns before any live state changes", () => {
    const world = forestWorld(64, 1.8);
    const animals = createAnimalManager(world, createIslandNav(world, []));
    for (let tick = 0; tick < 30; tick++) animals.step();
    const saved = JSON.parse(JSON.stringify(animals.saveState()));
    expect(() => validateAnimalSave({ ...saved, version: 1 })).toThrow("version");
    expect(() => validateAnimalSave({ population: {}, pool: {} } as never)).toThrow("version");
    const species = decodeTypedColumn(saved.dormant.species, Uint8Array);
    expect(species.length).toBeGreaterThan(0);
    species[0] = 9;
    expect(() => validateAnimalSave({ ...saved, dormant: { ...saved.dormant, species: encodeTypedColumn(species) } }))
      .toThrow(/Invalid saved wildlife/);
    const index = decodeTypedColumn(saved.slots.index, Int32Array);
    index[1] = index[0]!;
    expect(() => validateAnimalSave({ ...saved, slots: { ...saved.slots, index: encodeTypedColumn(index) } }))
      .toThrow(/Invalid saved wildlife slots/);
    expect(() => validateAnimalSave({ ...saved, ledger: { ...saved.ledger, region: undefined } }))
      .toThrow(/Invalid wildlife column/);
  });
});
