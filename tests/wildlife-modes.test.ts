import { describe, expect, it } from "vitest";

import { type CameraState, createCamera } from "../src/render-common/camera-state";
import { createAnimalManager } from "../src/render-common/wildlife/animal-manager";
import { HOLD_TICKS } from "../src/render-common/wildlife/manager/animal-modes";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { evaluateDormantPose } from "../src/render-common/wildlife/sim/dormant-routine";
import { ANIMAL_STATE } from "../src/render-common/wildlife/wildlife-species";
import type { WorldData } from "../src/shared/world/world-data";
import { forestWorld } from "./helpers/forest-world";

type Manager = ReturnType<typeof createAnimalManager>;

const sum = (values: Uint8Array) => values.reduce((total, value) => total + value, 0);

/** A 96² forest (nine regions) whose first population has settled, every region dormant. */
const createSettled = (world: WorldData) => {
  const animals = createAnimalManager(world, createIslandNav(world, []));
  for (let tick = 0; tick < 200; tick += 1) animals.step();
  return animals;
};

const step = (animals: Manager, ticks: number) => {
  for (let tick = 0; tick < ticks; tick += 1) animals.step();
};

const view = (x: number, z: number): CameraState =>
  ({ ...createCamera(x, z, 1), viewportHeight: 900, viewportWidth: 1600 });

describe("active and dormant wildlife regions", () => {
  it("costs nothing away from activity: every region of a quiet island is dormant", () => {
    const animals = createSettled(forestWorld(96, 1.8));
    const { identity, pool } = animals.debug;
    expect(animals.countSimulatedRegions()).toBe(0);
    expect(sum(pool.active)).toBe(0);
    expect(sum(identity.dormant)).toBe(animals.countAlive());
    expect(animals.countAlive()).toBeGreaterThan(20);
  });

  it("wakes the regions a hunter scans, holds them 30 s, then lets them sleep once calm", () => {
    const animals = createSettled(forestWorld(96, 1.8));
    const { identity, pool, regions } = animals.debug;
    const targets = animals.listHuntTargets("wildlife", { x: 16, z: 16 }, 6);
    expect(animals.countSimulatedRegions()).toBeGreaterThan(0);
    const awake = [...identity.homeRegion.keys()].filter((slot) => pool.active[slot] === 1);
    expect(awake.length).toBeGreaterThan(0);
    for (const slot of awake) {
      expect(regions.regionOf(pool.homeX[slot]!, pool.homeZ[slot]!)).toBe(identity.homeRegion[slot]);
    }
    for (const target of targets) expect(pool.active[target.id]).toBe(1);
    step(animals, HOLD_TICKS - 1);
    expect(animals.countSimulatedRegions()).toBeGreaterThan(0);
    step(animals, 400);
    expect(animals.countSimulatedRegions()).toBe(0);
    expect(sum(pool.active)).toBe(0);
  });

  it("keeps a hunted animal's region simulated until it is calm, then lets it sleep", () => {
    const animals = createSettled(forestWorld(96, 1.8));
    const { pool } = animals.debug;
    const [prey] = animals.listHuntTargets("wildlife", { x: 48, z: 48 }, 40);
    expect(prey).toBeDefined();
    expect(animals.hitHuntedAnimal(prey!.id, { x: prey!.x - 3, z: prey!.z })).toBe(true);
    step(animals, HOLD_TICKS * 2);
    expect(pool.huntState[prey!.id]).toBe(2);
    expect(pool.active[prey!.id]).toBe(1);
    expect(animals.countSimulatedRegions()).toBeGreaterThan(0);
    animals.killAnimal(prey!.id);
    step(animals, HOLD_TICKS + 400);
    expect(animals.countSimulatedRegions()).toBe(0);
  });

  it("materialises a woken animal exactly at its routine pose of the tick", () => {
    const animals = createSettled(forestWorld(96, 1.8));
    const { dormant, identity, pool } = animals.debug;
    step(animals, 137);
    const slot = [...identity.dormant.keys()].find((index) => identity.dormant[index] === 1)!;
    const tick = animals.saveState().tick;
    const pose = evaluateDormantPose(dormant, slot, tick);
    const expected = { heading: pose.heading, walking: pose.walking, x: pose.x, z: pose.z };
    animals.ensureSimulated(slot);
    expect(identity.dormant[slot]).toBe(0);
    expect(pool.active[slot]).toBe(1);
    expect(pool.x[slot]).toBe(Math.fround(expected.x));
    expect(pool.z[slot]).toBe(Math.fround(expected.z));
    expect(pool.heading[slot]).toBe(Math.fround(expected.heading));
    expect(pool.state[slot]).toBe(expected.walking ? ANIMAL_STATE.walk : pool.state[slot]);
  });

  it("draws dormant animals at their routine pose without waking or changing anything", () => {
    const world = forestWorld(96, 1.8);
    const animals = createSettled(world);
    const before = JSON.stringify(animals.saveState());
    let drawn = 0;
    for (let frame = 0; frame < 30; frame += 1) {
      drawn = Math.max(drawn, animals.update(frame / 30, view(48, 48), (frame % 10) / 10).count);
    }
    expect(drawn).toBeGreaterThan(0);
    expect(animals.countSimulatedRegions()).toBe(0);
    expect(JSON.stringify(animals.saveState())).toBe(before);
  });

  it("never draws a dormant animal walking its routine while lying (bedded when its region slept)", () => {
    const animals = createSettled(forestWorld(96, 1.8));
    const { dormant, identity, motion, pool } = animals.debug;
    animals.listHuntTargets("wildlife", { x: 48, z: 48 }, 40);
    step(animals, HOLD_TICKS - 1);
    for (let tick = 0; tick < 400 && animals.countSimulatedRegions() > 0; tick += 1) {
      pool.active.forEach((active, slot) => { if (active) motion.rest[slot] = 1; });
      animals.step();
    }
    const bedded = [...identity.dormant.keys()]
      .filter((slot) => identity.dormant[slot] === 1 && dormant.restAtAnchor[slot]! > 0.9);
    expect(bedded.length).toBeGreaterThan(0);
    let walking = 0;
    for (let frame = 0; frame < 2400; frame += 1) {
      animals.step();
      animals.update(frame * 0.05, view(48, 48), 0.5);
      for (const slot of bedded) {
        if (pool.velocityX[slot] === 0 && pool.velocityZ[slot] === 0) continue;
        walking += 1;
        expect(motion.rest[slot]).toBe(0);
      }
    }
    expect(walking).toBeGreaterThan(0);
  });

  it("gives the same wildlife whether or not frames are drawn in between (camera independence)", () => {
    const world = forestWorld(96, 1.8);
    const drawnRun = createSettled(world), headless = createSettled(world);
    for (const animals of [drawnRun, headless]) animals.listHuntTargets("wildlife", { x: 48, z: 48 }, 12);
    for (let tick = 0; tick < 900; tick += 1) {
      drawnRun.step();
      headless.step();
      if (tick % 3 === 0) drawnRun.update(tick * 0.05, view(20 + (tick % 50), 40), 0.5);
    }
    expect(JSON.stringify(drawnRun.saveState())).toBe(JSON.stringify(headless.saveState()));
  });
});
