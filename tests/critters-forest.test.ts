import { describe, expect, it } from "vitest";

import { CRITTER_COLONIES } from "../src/render-common/critters/critter-colonies";
import { createCritterManager } from "../src/render-common/critters/critter-manager";
import { CRITTER, CRITTER_SPECIES } from "../src/render-common/critters/critter-species";
import { createCritterSites } from "../src/render-common/critters/habitat/critter-sites";
import { createCritterTerrain } from "../src/render-common/critters/habitat/critter-terrain";
import { computeEnvironment } from "../src/render-common/environment";
import { colonyIndex, createCritterWorld, createView, runAt } from "./critter-test-world";

const world = createCritterWorld();
const terrain = createCritterTerrain(world);
const sites = createCritterSites(terrain, CRITTER_COLONIES);
const FOREST_COLONIES = ["foxes", "wild boars", "wolf packs", "squirrels", "brown bears"];
const sitesOf = (name: string) => sites.list.filter((site) => site.colony === colonyIndex(name));

describe("forest critter classification", () => {
  it("marks wild boars and their piglets as food, the rest of the forest as critters", () => {
    expect(CRITTER_SPECIES[CRITTER.boar]!.food).toBe(true);
    expect(CRITTER_SPECIES[CRITTER.piglet]!.food).toBe(true);
    for (const species of [CRITTER.fox, CRITTER.wolf, CRITTER.bear, CRITTER.squirrel]) {
      expect(CRITTER_SPECIES[species]!.food).toBe(false);
    }
    for (const site of sitesOf("wild boars")) expect(site.food).toBe(true);
    for (const site of sitesOf("foxes")) expect(site.food).toBe(false);
  });
});

describe("forest critter habitats", () => {
  it("finds every forest colony on a wooded island", () => {
    for (const name of ["foxes", "wild boars", "squirrels"]) {
      expect(sitesOf(name).length).toBeGreaterThan(0);
    }
  });

  it("puts dens on dry wooded ground, packs and bears near the mountains", () => {
    for (const name of FOREST_COLONIES) {
      for (const site of sitesOf(name)) {
        expect(terrain.depth(site.x, site.z)).toBeLessThan(0.01);
        expect(terrain.forest(site.x, site.z)).toBeGreaterThan(0.14);
      }
    }
    for (const site of [...sitesOf("wolf packs"), ...sitesOf("brown bears")]) {
      expect(terrain.rocky(site.x, site.z)).toBeGreaterThanOrEqual(0.12);
    }
    for (const site of sitesOf("wild boars")) {
      expect(terrain.forest(site.x, site.z)).toBeLessThanOrEqual(0.72);
    }
  });

  it("places the same forest sites for the same seed", () => {
    const again = createCritterSites(createCritterTerrain(world), CRITTER_COLONIES);
    const forest = (list: typeof sites.list) =>
      list.filter((site) => FOREST_COLONIES.includes(CRITTER_COLONIES[site.colony]!.name));
    expect(forest(again.list)).toEqual(forest(sites.list));
  });
});

describe("forest critter life", () => {
  /** Seed 7 has a sow with piglets. */
  const lifeWorld = createCritterWorld(7);
  const lifeTerrain = createCritterTerrain(lifeWorld);
  const boars = createCritterSites(lifeTerrain, CRITTER_COLONIES).list.find((site) =>
    site.members.includes(CRITTER.piglet)
  )!;

  it("is deterministic and keeps the sounder on dry land, the piglets near the sow", () => {
    const first = runAt(lifeWorld, boars.x, boars.z, 30);
    const second = runAt(lifeWorld, boars.x, boars.z, 30);
    expect(second.frames.at(-1)).toEqual(first.frames.at(-1));
    let piglets = 0;
    for (const frame of first.frames) {
      const sow = frame.species.indexOf(CRITTER.boar);
      frame.species.forEach((species, index) => {
        if (species !== CRITTER.boar && species !== CRITTER.piglet) return;
        expect(lifeTerrain.depth(frame.x[index]!, frame.z[index]!)).toBeLessThan(0.05);
        if (species !== CRITTER.piglet || sow < 0) return;
        piglets += 1;
        const gap = Math.hypot(frame.x[index]! - frame.x[sow]!, frame.z[index]! - frame.z[sow]!);
        expect(gap).toBeLessThan(4);
      });
    }
    expect(first.frames.at(-1)!.count).toBeGreaterThan(0);
    expect(piglets).toBeGreaterThan(0);
  });

  it("keeps the boars when the Critters setting hides the foxes", () => {
    const manager = createCritterManager(lifeWorld);
    manager.setDecorativeEnabled(false);
    const camera = createView(lifeWorld, boars.x, boars.z);
    const environment = computeEnvironment(lifeWorld.sun, 12, 0);
    let boarsSeen = 0;
    for (let time = 0; time < 10; time += 1 / 30) {
      const frame = manager.update(time, camera, environment);
      for (let index = 0; index < frame.count; index += 1) {
        expect(CRITTER_SPECIES[frame.species[index]!]!.food).toBe(true);
        if (frame.species[index] === CRITTER.boar) boarsSeen += 1;
      }
    }
    expect(boarsSeen).toBeGreaterThan(0);
  });

  it("makes the boars trot away from a worker", () => {
    let worker = { x: -100, z: -100 };
    const manager = createCritterManager(lifeWorld, { getWorkers: () => [worker] });
    const camera = createView(lifeWorld, boars.x, boars.z);
    const environment = computeEnvironment(lifeWorld.sun, 12, 0);
    let frame = manager.update(0, camera, environment);
    for (let time = 0; time < 3; time += 1 / 30) frame = manager.update(time, camera, environment);
    const sow = frame.species.subarray(0, frame.count).indexOf(CRITTER.boar);
    const start = { x: frame.x[sow]!, z: frame.z[sow]! };
    worker = { x: start.x + 1, z: start.z };
    for (let time = 3; time < 7; time += 1 / 30) frame = manager.update(time, camera, environment);
    const now = frame.species.subarray(0, frame.count).indexOf(CRITTER.boar);
    expect(Math.hypot(frame.x[now]! - worker.x, frame.z[now]! - worker.z)).toBeGreaterThan(1.5);
  });
});
