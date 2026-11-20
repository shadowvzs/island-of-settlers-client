import { describe, expect, it } from "vitest";

import { createAnimalManager } from "../src/render-common/wildlife/animal-manager";
import { createAnimalObstacles } from "../src/render-common/wildlife/animal-obstacles";
import { validateAnimalSave } from "../src/render-common/wildlife/manager/animal-save";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { isBodyFree } from "../src/render-common/wildlife/nav/nav-query";
import { ISLAND_ANIMAL_CAP } from "../src/render-common/wildlife/population/wildlife-regions";
import { findFreeSlot } from "../src/render-common/wildlife/sim/animal-placement";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld } from "./helpers/cached-worlds";
import { wakeAllRegions } from "./helpers/wildlife-awake";

/** A 96² island whose regions were touched before the first population: births appear in turn. */
const setup = () => {
  const world = cachedWorld({
    ...DEFAULT_WORLD_OPTIONS,
    cellsX: 96,
    cellsZ: 96,
    erosionDroplets: 10
  });
  const nav = createIslandNav(world, []),
    manager = createAnimalManager(world, nav);
  wakeAllRegions(manager, world);
  manager.step();
  const pool = manager.debug.pool;
  const first = pool.active.findIndex((value) => value === 1);
  return { world, nav, manager, pool, first };
};
/** Settlement ticks from `start` to `end` seconds (the wildlife steps once per tick). */
const advance = (manager: ReturnType<typeof createAnimalManager>, start: number, end: number) => {
  for (let tick = Math.round((end - start) / 0.05); tick > 0; tick--) manager.step();
};

describe("staggered wildlife appearance", () => {
  it("reserves initial quotas and starts leaders before followers without invisible hunting or obstacles", () => {
    const { manager, pool } = setup();
    const reserved = manager.countAlive();
    expect(reserved).toBeGreaterThan(2);
    // The first arrival is due at once and appeared on the first step; the others wait in turn.
    expect(pool.pending.reduce((sum, n) => sum + n, 0)).toBe(reserved - 1);
    const scheduled = Array.from(pool.active.keys()).filter((id) => pool.active[id])
      .sort((a, b) => pool.arrivalTime[a]! - pool.arrivalTime[b]!);
    for (let index = 1; index < scheduled.length; index++) {
      const animal = scheduled[index]!;
      expect(pool.appear[animal]).toBe(0);
      expect(manager.getAnimalInfo(animal)!.isHuntable).toBe(false);
      expect(pool.arrivalTime[animal]! - pool.arrivalTime[scheduled[index - 1]!]!).toBeCloseTo(0.4, 4);
      expect(pool.arrivalTime[pool.group[animal]!]!).toBeLessThanOrEqual(pool.arrivalTime[animal]!);
    }
    let obstacles = 0;
    createAnimalObstacles(pool, false)(() => obstacles++);
    expect(obstacles).toBe(2);
    advance(manager, 0.05, 0.3);
    expect(pool.pending[scheduled[0]!]).toBe(0);
    expect(pool.pending[scheduled[1]!]).toBe(1);
    expect(pool.appear[scheduled[0]!]).toBeCloseTo(0.25, 4);
    expect(manager.countAlive()).toBe(reserved);
    advance(manager, 0.3, 1.3);
    expect(pool.appear[scheduled[0]!]).toBe(1);
    expect(pool.appear[scheduled[3]!]).toBeLessThan(0.13);
  });
  it("delays an arrival when edited navigation no longer fits its body, without losing its quota", () => {
    const { manager, nav, pool } = setup();
    const waiting = pool.pending.findIndex((value) => value === 1);
    const quota = manager.countAlive(),
      previousLast = Math.max(...pool.arrivalTime);
    nav.isExcluded = () => true;
    advance(manager, 0.05, pool.arrivalTime[waiting]! + 0.05);
    expect(pool.pending[waiting]).toBe(1);
    expect(pool.arrivalTime[waiting]).toBeGreaterThan(previousLast);
    expect(pool.appear[waiting]).toBe(0);
    expect(manager.countAlive()).toBe(quota);
    expect(manager.getAnimalInfo(waiting)!.isHuntable).toBe(false);
  });
  it("brings followers near a living moved leader on valid ground", () => {
    const { manager, nav, pool } = setup();
    const follower = pool.active.findIndex((alive, id) => alive === 1 && pool.group[id] !== id &&
      pool.arrivalTime[pool.group[id]!]! < pool.arrivalTime[id]!);
    expect(follower).toBeGreaterThanOrEqual(0);
    const leader = pool.group[follower]!;
    const arrival = pool.arrivalTime[follower]!;
    advance(manager, 0.05, pool.arrivalTime[leader]! + 0.1);
    for (const offset of [0.5, -0.5, 0.25, -0.25]) {
      if (
        !isBodyFree(
          nav,
          pool.species[leader]!,
          pool.x[leader]! + offset,
          pool.z[leader]!,
          pool.heading[leader]!,
          pool.bodyScale[leader]!
        )
      )
        continue;
      pool.x[leader]! += offset;
      break;
    }
    advance(manager, pool.arrivalTime[leader]! + 0.1, arrival + 0.15);
    expect(pool.pending[follower]).toBe(0);
    expect(
      isBodyFree(
        nav,
        pool.species[follower]!,
        pool.x[follower]!,
        pool.z[follower]!,
        pool.heading[follower]!,
        pool.bodyScale[follower]!
      )
    ).toBe(true);
    expect(Math.hypot(pool.x[follower]! - pool.x[leader]!, pool.z[follower]! - pool.z[leader]!)).toBeLessThan(4);
  });
  it("keeps pending order, partially completed fades and future respawn clocks across save/load", () => {
    const { manager, nav, pool, world } = setup();
    advance(manager, 0.05, 0.7);
    const saved = JSON.parse(JSON.stringify(manager.saveState()));
    validateAnimalSave(saved);
    const restored = createAnimalManager(world, nav, saved);
    expect(restored.saveState()).toEqual(saved);
    advance(manager, 0.7, 1.4);
    advance(restored, 0.7, 1.4);
    expect(restored.saveState()).toEqual(manager.saveState());
    expect(restored.countAlive()).toBe(pool.active.reduce((sum, value) => sum + value, 0));
  });
  it("fades ordinary editor removals, reserves departing slots and retains the death sequence", () => {
    const { first, manager, pool } = setup();
    advance(manager, 0.05, 1.3);
    // Treat an existing finite editor slot as visible without bypassing removal/home identity logic.
    const slot = ISLAND_ANIMAL_CAP;
    for (const key of ["x", "y", "z", "homeX", "homeZ", "bodyScale", "shade", "age"] as const)
      pool[key][slot] = pool[key][first]!;
    pool.active[slot] = 1;
    pool.appear[slot] = 1;
    pool.species[slot] = pool.species[first]!;
    const before = manager.countAlive();
    expect(
      manager.removePlacedAnimal(pool.species[slot]!, pool.homeX[slot]!, pool.homeZ[slot]!)
    ).toBe(true);
    expect(manager.countAlive()).toBe(before - 1);
    expect(pool.departing[slot]).toBe(1);
    expect(findFreeSlot(pool, slot)).not.toBe(slot);
    advance(manager, 1.3, 1.9);
    expect(pool.appear[slot]).toBeGreaterThan(0.46);
    expect(pool.appear[slot]).toBeLessThan(0.54);
    advance(manager, 1.9, 2.6);
    expect(pool.departing[slot]).toBe(0);
    expect(findFreeSlot(pool, slot)).toBe(slot);
    manager.killAnimal(first);
    expect(pool.carcass[first]).toBe(1);
    expect(pool.departing[first]).toBe(0);
    expect(pool.appear[first]).toBe(1);
  });
});
