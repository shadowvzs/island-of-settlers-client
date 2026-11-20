import { describe, expect, it } from "vitest";

import { CRITTER_COLONIES } from "../src/render-common/critters/critter-colonies";
import { createCritterManager } from "../src/render-common/critters/critter-manager";
import { getCritterModels } from "../src/render-common/critters/critter-models";
import { CRITTER, CRITTER_SPECIES } from "../src/render-common/critters/critter-species";
import { createCritterSites } from "../src/render-common/critters/habitat/critter-sites";
import { createCritterTerrain } from "../src/render-common/critters/habitat/critter-terrain";
import { CLIP } from "../src/render-common/critters/model/critter-model";
import { FOOD_FRAME } from "../src/render-common/critters/model/quadruped-food";
import { QUAD_FRAME } from "../src/render-common/critters/model/quadruped-models";
import { computeEnvironment } from "../src/render-common/environment";
import { DEATH_END, DEATH_TIMING } from "../src/render-common/helpers";
import { colonyIndex, createCritterWorld, createView } from "./critter-test-world";

const FOOD_QUADRUPEDS = [CRITTER.boar, CRITTER.piglet, CRITTER.chamois, CRITTER.chamoisKid];
const STEP = 1 / 30;

const world = createCritterWorld();
const sites = createCritterSites(createCritterTerrain(world), CRITTER_COLONIES);
const herd = sites.list.find((site) => site.colony === colonyIndex("chamois"))!;

/** A manager running around the chamois herd at noon. */
const createHerdRun = (options: Parameters<typeof createCritterManager>[1] = {}) => {
  const manager = createCritterManager(world, options);
  const camera = createView(world, herd.x, herd.z);
  const environment = computeEnvironment(world.sun, 12, 0);
  let time = 0;
  const run = (seconds: number) => {
    let frame = manager.update(time, camera, environment);
    for (const end = time + seconds; time < end; time += STEP) {
      frame = manager.update(time, camera, environment);
    }
    return frame;
  };
  return { manager, run };
};

const findLiving = (manager: ReturnType<typeof createCritterManager>, species: number) => {
  const { pool } = manager.debug;
  for (let index = 0; index < pool.capacity; index += 1) {
    if (pool.active[index] === 1 && pool.species[index] === species) return index;
  }
  return -1;
};

describe("food critter models", () => {
  it("gives boars, piglets and chamois a gallop and a death fall onto the side", () => {
    const models = getCritterModels();
    for (const species of FOOD_QUADRUPEDS) {
      const model = models[species]!;
      const stand = model.frames[FOOD_FRAME.stand]!;
      const fallen = model.frames.at(-1)!;
      expect(model.clips[CLIP.run]!.frames[0]).toBe(FOOD_FRAME.gallop);
      expect(model.clips[CLIP.dead]!.frames.at(-1)).toBe(model.frames.length - 1);
      expect(fallen.indices).toEqual(stand.indices);
      expect(fallen.height).toBeLessThan(stand.height * 0.75);
      let lowest = Infinity;
      for (let index = 1; index < fallen.positions.length; index += 3) {
        lowest = Math.min(lowest, fallen.positions[index]!);
      }
      expect(lowest).toBeCloseTo(0, 5);
    }
  });

  it("keeps the other four legged critters on their trot when they flee", () => {
    const fox = getCritterModels()[CRITTER.fox]!;
    expect(fox.clips[CLIP.run]!.frames[0]).toBe(QUAD_FRAME.trot);
    expect(fox.frames.length).toBe(FOOD_FRAME.gallop);
  });
});

describe("food critter life", () => {
  it("keeps the chamois when the Critters setting hides the decorative ones", () => {
    const { manager, run } = createHerdRun();
    manager.setDecorativeEnabled(false);
    let chamoisSeen = 0;
    for (let second = 0; second < 10; second += 1) {
      const frame = run(1);
      for (let index = 0; index < frame.count; index += 1) {
        expect(CRITTER_SPECIES[frame.species[index]!]!.food).toBe(true);
        if (frame.species[index] === CRITTER.chamois) chamoisSeen += 1;
      }
    }
    expect(chamoisSeen).toBeGreaterThan(0);
  });

  it("gallops away from a worker", () => {
    let worker = { x: -100, z: -100 };
    const { manager, run } = createHerdRun({ getWorkers: () => [worker] });
    run(3);
    const chamois = findLiving(manager, CRITTER.chamois);
    const { pool } = manager.debug;
    worker = { x: pool.x[chamois]! + 1, z: pool.z[chamois]! };
    run(1.5);
    expect(pool.clip[chamois]).toBe(CLIP.run);
    expect(pool.speed[chamois]).toBeGreaterThan(1.2);
  });

  it("falls, lies as a carcass, can be harvested once, else sinks and is gone", () => {
    const { manager, run } = createHerdRun();
    run(3);
    const { pool } = manager.debug;
    const chamois = findLiving(manager, CRITTER.chamois);
    expect(manager.killCritter(chamois)).toBe(true);
    expect(manager.killCritter(chamois)).toBe(false);
    expect(manager.isCarcass(chamois)).toBe(false);
    run(DEATH_TIMING.fall + 0.2);
    expect(pool.clip[chamois]).toBe(CLIP.dead);
    expect(pool.pose[chamois]).toBe(1);
    expect(manager.isCarcass(chamois)).toBe(true);
    const lying = { x: pool.x[chamois]!, z: pool.z[chamois]! };
    run(DEATH_TIMING.lie / 2);
    expect(pool.x[chamois]).toBe(lying.x);
    expect(pool.z[chamois]).toBe(lying.z);
    run(DEATH_END - DEATH_TIMING.fall - DEATH_TIMING.lie / 2);
    expect(pool.carcass[chamois]).toBe(0);
    expect(manager.isCarcass(chamois)).toBe(false);

    const kid = findLiving(manager, CRITTER.chamois);
    if (kid < 0) return;
    manager.killCritter(kid);
    expect(manager.harvestCritter(kid)).toBe(false);
    run(DEATH_TIMING.fall + 0.2);
    expect(manager.harvestCritter(kid)).toBe(true);
    expect(manager.harvestCritter(kid)).toBe(false);
    expect(pool.active[kid]).toBe(0);
  });

  it("tells the kill listeners where a food critter fell, once", () => {
    const { manager, run } = createHerdRun();
    run(3);
    const { pool } = manager.debug;
    const kills: [number, number][] = [];
    manager.onCritterKilled((x, z) => kills.push([x, z]));
    const chamois = findLiving(manager, CRITTER.chamois);
    manager.killCritter(chamois);
    manager.killCritter(chamois);
    expect(kills).toEqual([[pool.x[chamois]!, pool.z[chamois]!]]);
  });

  it("never kills a decorative critter", () => {
    const { manager, run } = createHerdRun();
    run(3);
    const { pool } = manager.debug;
    for (let index = 0; index < pool.capacity; index += 1) {
      if (pool.active[index] === 0 || CRITTER_SPECIES[pool.species[index]!]!.food) continue;
      expect(manager.killCritter(index)).toBe(false);
    }
  });
});
