import { describe, expect, it } from "vitest";

import { CRITTER_COLONIES } from "../src/render-common/critters/critter-colonies";
import { CRITTER } from "../src/render-common/critters/critter-species";
import { createCritterSites } from "../src/render-common/critters/habitat/critter-sites";
import { createCritterTerrain } from "../src/render-common/critters/habitat/critter-terrain";
import type { WorldData } from "../src/shared/world/world-data";
import { colonyIndex, createCritterWorld, createRockVolume, runAt } from "./critter-test-world";

const SEEDS = [1234, 7, 42, 2024];
const ROCK_DWELLERS = new Set<number>([
  CRITTER.chamois,
  CRITTER.chamoisKid,
  CRITTER.marmot,
  CRITTER.burrow
]);

const mountainSites = (world: WorldData) => {
  const sites = createCritterSites(createCritterTerrain(world), CRITTER_COLONIES);
  const wanted = new Set([colonyIndex("chamois"), colonyIndex("marmots")]);
  return sites.list.filter((site) => wanted.has(site.colony));
};

describe("mountain critters on visible ground", () => {
  it.each(SEEDS)("never homes a chamois herd or a burrow inside rock (seed %i)", (seed) => {
    const world = createCritterWorld(seed);
    const isInsideRock = createRockVolume(world);
    const sites = mountainSites(world);
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) expect(isInsideRock(site.x, site.z)).toBe(false);
  });

  it.each(SEEDS)("never walks a chamois or a marmot into rock (seed %i)", (seed) => {
    const world = createCritterWorld(seed);
    const isInsideRock = createRockVolume(world);
    const herds = mountainSites(world).filter((site) => site.colony === colonyIndex("chamois"));
    let seen = 0;
    for (const herd of herds.slice(0, 2)) {
      for (const frame of runAt(world, herd.x, herd.z, 40).frames) {
        frame.species.forEach((species, index) => {
          if (!ROCK_DWELLERS.has(species)) return;
          seen += 1;
          expect(isInsideRock(frame.x[index]!, frame.z[index]!)).toBe(false);
        });
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
