import { describe, expect, it } from "vitest";

import { CRITTER_COLONIES } from "../src/render-common/critters/critter-colonies";
import { createCritterManager } from "../src/render-common/critters/critter-manager";
import { CRITTER, CRITTER_SPECIES } from "../src/render-common/critters/critter-species";
import { createCritterSites } from "../src/render-common/critters/habitat/critter-sites";
import { createCritterTerrain } from "../src/render-common/critters/habitat/critter-terrain";
import { CLIP } from "../src/render-common/critters/model/critter-model";
import { computeEnvironment } from "../src/render-common/environment";
import type { WorldData } from "../src/shared/world/world-data";
import {
  colonyIndex,
  createCritterWorld,
  createView,
  critterWorldOptions,
  runAt
} from "./critter-test-world";
import { preloadWorlds } from "./helpers/cached-worlds";

preloadWorlds(critterWorldOptions(1234, "snowy"));

const world = createCritterWorld();
const terrain = createCritterTerrain(world);
const sites = createCritterSites(terrain, CRITTER_COLONIES);
const sitesOf = (name: string, list = sites.list) =>
  list.filter((site) => site.colony === colonyIndex(name));
const SMALL_LIFE = ["hedgehogs", "frogs", "crabs", "seals", "dragonflies"];
const SPECIES = [CRITTER.hedgehog, CRITTER.frog, CRITTER.crab, CRITTER.seal, CRITTER.dragonfly];

/**
 * Runs the critters around a site with a worker stepping in after `calm` seconds, then watches
 * them `watch` seconds.
 */
const runWithWorker = (
  target: WorldData,
  site: { x: number; z: number },
  calm: number,
  hour = 13,
  watch = 8
) => {
  let worker = { x: -100, z: -100 };
  const manager = createCritterManager(target, { getWorkers: () => [worker] });
  const camera = createView(target, site.x, site.z, 3);
  const environment = computeEnvironment(target.sun, hour, 0);
  for (let time = 0; time < calm; time += 1 / 30) manager.update(time, camera, environment);
  worker = { x: site.x + 0.6, z: site.z };
  for (let time = calm; time < calm + watch; time += 1 / 30) {
    manager.update(time, camera, environment);
  }
  return manager.debug.pool;
};

/** Water a fleeing seal can swim in (deeper than its swim depth) within reach of a site. */
const SEAL_SWIM_DEPTH = 0.3;
const SEAL_WATER_REACH = 2;

const hasSwimWaterNear = (site: { x: number; z: number }) => {
  for (let dz = -SEAL_WATER_REACH; dz <= SEAL_WATER_REACH; dz += 0.5) {
    for (let dx = -SEAL_WATER_REACH; dx <= SEAL_WATER_REACH; dx += 0.5) {
      if (terrain.depth(site.x + dx, site.z + dz) > SEAL_SWIM_DEPTH) return true;
    }
  }
  return false;
};

/** Live members of a species within `radius` of a site. */
const membersNear = (
  pool: ReturnType<typeof runWithWorker>,
  species: number,
  site: { x: number; z: number },
  radius: number
) =>
  Array.from(pool.active.keys()).filter(
    (index) =>
      pool.active[index] === 1 &&
      pool.species[index] === species &&
      Math.hypot(pool.x[index]! - site.x, pool.z[index]! - site.z) < radius
  );

describe("meadow and shore critter classification and habitats", () => {
  it("keeps the small life and seals decorative", () => {
    for (const species of SPECIES) expect(CRITTER_SPECIES[species]!.food).toBe(false);
  });

  it("finds every meadow and shore colony on a river island", () => {
    for (const name of SMALL_LIFE) expect(sitesOf(name).length).toBeGreaterThan(0);
  });

  it("puts each in its habitat", () => {
    for (const site of sitesOf("hedgehogs")) {
      expect(terrain.depth(site.x, site.z)).toBeLessThan(0.01);
      expect(terrain.hidden(site.x, site.z)).toBe(false);
    }
    for (const site of sitesOf("frogs")) expect(terrain.depth(site.x, site.z)).toBeLessThan(0.01);
    for (const site of sitesOf("crabs")) {
      expect(terrain.sand(site.x, site.z)).toBeGreaterThanOrEqual(0.5);
      expect(
        world.coastDistance[Math.round(site.z) * (world.cellsX + 1) + Math.round(site.x)]!
      ).toBeLessThanOrEqual(2.5);
    }
    for (const site of sitesOf("seals")) expect(terrain.depth(site.x, site.z)).toBeLessThan(0.05);
    for (const site of sitesOf("dragonflies")) {
      expect(terrain.depth(site.x, site.z)).toBeGreaterThan(0.04);
      expect(terrain.stillness(site.x, site.z)).toBeGreaterThan(0.3);
    }
  });

  it("is deterministic and keeps frogs, hedgehogs and dragonflies out of the snow", () => {
    const again = createCritterSites(createCritterTerrain(world), CRITTER_COLONIES);
    expect(again.list).toEqual(sites.list);
    const snowy = createCritterSites(
      createCritterTerrain(createCritterWorld(1234, "snowy")),
      CRITTER_COLONIES
    ).list;
    for (const name of ["hedgehogs", "frogs", "dragonflies"]) {
      expect(sitesOf(name, snowy).length).toBeLessThanOrEqual(sitesOf(name).length);
    }
  });
});

describe("meadow and shore critter life", () => {
  it("sends frogs plopping into the water when a worker comes", () => {
    const site = sitesOf("frogs")[0]!;
    const pool = runWithWorker(world, site, 4);
    const frogs = membersNear(pool, CRITTER.frog, site, 3);
    expect(frogs.length).toBeGreaterThan(0);
    for (const frog of frogs) expect(pool.hidden[frog]).toBe(1);
  });

  it("makes crabs dig in and hedgehogs roll up when a worker comes", () => {
    const beach = sitesOf("crabs")[0]!;
    const crabs = runWithWorker(world, beach, 4);
    const nearCrabs = membersNear(crabs, CRITTER.crab, beach, 3);
    expect(nearCrabs.length).toBeGreaterThan(0);
    for (const crab of nearCrabs) expect(crabs.hidden[crab]).toBe(1);
    const meadow = sitesOf("hedgehogs")[0]!;
    const hedgehogs = runWithWorker(world, meadow, 2, 21);
    const nearHedgehogs = membersNear(hedgehogs, CRITTER.hedgehog, meadow, 4);
    expect(nearHedgehogs.length).toBeGreaterThan(0);
    for (const hedgehog of nearHedgehogs) {
      expect(hedgehogs.clip[hedgehog]).toBe(CLIP.rest);
    }
  });

  it("keeps dragonflies hovering low over their water", () => {
    const pond = sitesOf("dragonflies")[0]!;
    const { frames } = runAt(world, pond.x, pond.z, 20, 13);
    let seen = 0;
    for (const frame of frames) {
      frame.species.forEach((species, index) => {
        if (species !== CRITTER.dragonfly) return;
        seen += 1;
        const [x, y, z] = [frame.x[index]!, frame.y[index]!, frame.z[index]!];
        expect(y - terrain.water(x, z)).toBeGreaterThan(0.15);
        expect(y - terrain.water(x, z)).toBeLessThan(0.9);
      });
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("lets seals lie on the shore and take to the water when a worker comes", () => {
    const shore = sitesOf("seals").find(hasSwimWaterNear);
    if (!shore) throw new Error("no seal shore with swimming water in reach");
    /** A fleeing seal humps 0.3 units a second to water up to 3.9 away (time to reach it). */
    const pool = runWithWorker(world, shore, 3, 13, 16);
    const seals = membersNear(pool, CRITTER.seal, shore, 6);
    expect(seals.length).toBeGreaterThan(0);
    for (const seal of seals) {
      const wet = terrain.depth(pool.x[seal]!, pool.z[seal]!) > 0.1 || pool.hidden[seal] === 1;
      expect(wet).toBe(true);
    }
  });
});
