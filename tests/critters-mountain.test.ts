import { describe, expect, it } from "vitest";

import { CRITTER_COLONIES } from "../src/render-common/critters/critter-colonies";
import { createCritterManager } from "../src/render-common/critters/critter-manager";
import { getCritterModels } from "../src/render-common/critters/critter-models";
import { CRITTER, CRITTER_SPECIES } from "../src/render-common/critters/critter-species";
import { CHAMOIS_SLOPE } from "../src/render-common/critters/habitat/critter-habitats-mountain";
import { createCritterSites } from "../src/render-common/critters/habitat/critter-sites";
import { createCritterTerrain } from "../src/render-common/critters/habitat/critter-terrain";
import { MARMOT_FRAME } from "../src/render-common/critters/model/marmot";
import { computeEnvironment } from "../src/render-common/environment";
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
const sitesOf = (name: string) => sites.list.filter((site) => site.colony === colonyIndex(name));
const MOUNTAIN = [
  CRITTER.chamois,
  CRITTER.chamoisKid,
  CRITTER.marmot,
  CRITTER.burrow,
  CRITTER.eagle
];

describe("mountain critter models and classification", () => {
  it("marks chamois and kids as food, keeps marmots, burrows and eagles decorative", () => {
    for (const species of MOUNTAIN) {
      const food = species === CRITTER.chamois || species === CRITTER.chamoisKid;
      expect(CRITTER_SPECIES[species]!.food).toBe(food);
    }
    for (const site of sitesOf("chamois")) expect(site.food).toBe(true);
    for (const name of ["marmots", "golden eagles"]) {
      for (const site of sitesOf(name)) expect(site.food).toBe(false);
    }
  });

  it("sinks the marmot into its hole (nothing left above the mound when deep)", () => {
    const marmot = getCritterModels()[CRITTER.marmot]!;
    const deep = marmot.frames[MARMOT_FRAME.deep]!;
    const sitting = marmot.frames[MARMOT_FRAME.sitUp]!;
    expect(deep.height).toBeLessThan(0.02);
    expect(sitting.height).toBeGreaterThan(marmot.frames[MARMOT_FRAME.stand]!.height);
  });
});

describe("mountain critter habitats", () => {
  it("finds chamois, marmots and eagles on a mountain island", () => {
    for (const name of ["chamois", "marmots", "golden eagles"]) {
      expect(sitesOf(name).length).toBeGreaterThan(0);
    }
  });

  it("puts chamois on stony slopes, marmots on grass at the mountain foot, eagles on peaks", () => {
    for (const site of sitesOf("chamois")) {
      expect(terrain.stony(site.x, site.z)).toBeGreaterThanOrEqual(0.5);
      expect(terrain.slope(site.x, site.z)).toBeLessThanOrEqual(CHAMOIS_SLOPE);
      expect(terrain.hidden(site.x, site.z)).toBe(false);
    }
    for (const site of sitesOf("marmots")) {
      expect(terrain.stony(site.x, site.z)).toBeLessThanOrEqual(0.2);
      expect(terrain.rocky(site.x, site.z)).toBeGreaterThanOrEqual(0.25);
      expect(terrain.hidden(site.x, site.z)).toBe(false);
    }
    for (const site of sitesOf("golden eagles")) {
      expect(terrain.ground(site.x, site.z)).toBeGreaterThan(6.5);
    }
  });

  it("places the same mountain sites for the same seed, fewer marmots in winter", () => {
    const again = createCritterSites(createCritterTerrain(world), CRITTER_COLONIES);
    expect(again.list).toEqual(sites.list);
    const snowy = createCritterSites(
      createCritterTerrain(createCritterWorld(1234, "snowy")),
      CRITTER_COLONIES
    );
    const marmots = (list: typeof sites.list) =>
      list.filter((site) => site.colony === colonyIndex("marmots")).length;
    expect(marmots(snowy.list)).toBeLessThanOrEqual(marmots(sites.list));
  });
});

describe("mountain critter life", () => {
  it("keeps the chamois on dry, climbable ground and is deterministic", () => {
    const herd = sitesOf("chamois")[0]!;
    const first = runAt(world, herd.x, herd.z, 30);
    expect(runAt(world, herd.x, herd.z, 30).frames.at(-1)).toEqual(first.frames.at(-1));
    let seen = 0;
    for (const frame of first.frames) {
      frame.species.forEach((species, index) => {
        if (species !== CRITTER.chamois && species !== CRITTER.chamoisKid) return;
        seen += 1;
        expect(terrain.depth(frame.x[index]!, frame.z[index]!)).toBeLessThan(0.02);
        expect(terrain.slope(frame.x[index]!, frame.z[index]!)).toBeLessThan(CHAMOIS_SLOPE * 1.2);
      });
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("lets marmots come up and dive into their burrow when a worker comes", () => {
    const burrow = sitesOf("marmots")[0]!;
    let worker = { x: -100, z: -100 };
    const manager = createCritterManager(world, { getWorkers: () => [worker] });
    const camera = createView(world, burrow.x, burrow.z, 3);
    const environment = computeEnvironment(world.sun, 11, 0);
    const marmotsUp = () => {
      const frame = manager.update(time, camera, environment);
      let count = 0;
      for (let index = 0; index < frame.count; index += 1) {
        const near = Math.hypot(frame.x[index]! - burrow.x, frame.z[index]! - burrow.z) < 2.5;
        if (near && frame.species[index] === CRITTER.marmot) count += 1;
      }
      return count;
    };
    let time = 0;
    let up = 0;
    for (; time < 40 && up === 0; time += 1 / 30) up = marmotsUp();
    expect(up).toBeGreaterThan(0);
    worker = { x: burrow.x + 1.5, z: burrow.z };
    for (const end = time + 6; time < end; time += 1 / 30) up = marmotsUp();
    expect(up).toBe(0);
  });

  it("flies the eagles high over their peak", () => {
    const peak = sitesOf("golden eagles")[0]!;
    const { frames } = runAt(world, peak.x, peak.z, 20);
    let seen = 0;
    for (const frame of frames) {
      frame.species.forEach((species, index) => {
        if (species !== CRITTER.eagle) return;
        seen += 1;
        expect(frame.y[index]!).toBeGreaterThan(terrain.ground(peak.x, peak.z) + 2.4);
        expect(Math.hypot(frame.x[index]! - peak.x, frame.z[index]! - peak.z)).toBeLessThan(14);
      });
    }
    expect(seen).toBeGreaterThan(0);
  });
});
