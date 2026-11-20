import { describe, expect, it } from "vitest";

import { BEHAVIOUR, CRITTER_COLONIES } from "../src/render-common/critters/critter-colonies";
import { createCritterManager } from "../src/render-common/critters/critter-manager";
import { getCritterModels } from "../src/render-common/critters/critter-models";
import { CRITTER, CRITTER_SPECIES } from "../src/render-common/critters/critter-species";
import { createCritterSites } from "../src/render-common/critters/habitat/critter-sites";
import { createCritterTerrain } from "../src/render-common/critters/habitat/critter-terrain";
import {
  CLIP,
  createFramePair,
  resolveClipFrames
} from "../src/render-common/critters/model/critter-model";
import { computeEnvironment } from "../src/render-common/environment";
import { FOG } from "../src/shared/world/world-data";
import {
  colonyIndex,
  createCritterWorld,
  createView,
  critterWorldOptions,
  runAt
} from "./critter-test-world";
import { preloadWorlds } from "./helpers/cached-worlds";

preloadWorlds(critterWorldOptions(99), critterWorldOptions(1234, "snowy"));

const world = createCritterWorld();

describe("critter models", () => {
  it("keeps one topology per species and finite frames", () => {
    getCritterModels().forEach((model) => {
      const vertices = model.frames[0]!.positions.length;
      for (const frame of model.frames) {
        expect(frame.positions.length).toBe(vertices);
        expect(frame.positions.every(Number.isFinite)).toBe(true);
        expect(frame.normals.every(Number.isFinite)).toBe(true);
        expect(Math.max(...frame.indices)).toBeLessThan(vertices / 3);
      }
    });
  });

  it("stays within small budgets (triangles per species, High and Minimal)", () => {
    // The source-built critters (chamois, kid, bear, fox, wolf, boar, piglet, seal, heron,
    // eagle) draw 2.5k to 3k triangles on High.
    const detailed = new Set<number>([
      CRITTER.bear, CRITTER.boar, CRITTER.chamois, CRITTER.chamoisKid, CRITTER.eagle, CRITTER.fox,
      CRITTER.heron, CRITTER.piglet, CRITTER.seal, CRITTER.wolf
    ]);
    const highBudget = (species: number) => (detailed.has(species) ? 3200 : 1600);
    getCritterModels().forEach((model, species) => {
      expect(model.frames[0]!.indices.length / 3).toBeLessThan(highBudget(species));
    });
    getCritterModels(false, true).forEach((model) => {
      expect(model.frames[0]!.indices.length / 3).toBeLessThan(1600);
    });
  });

  it("resolves clips to frames of the species", () => {
    const pair = createFramePair();
    getCritterModels().forEach((model) => {
      for (let clip = 0; clip <= CLIP.air; clip += 1) {
        for (const phase of [0, 0.3, 0.99, 2.4]) {
          resolveClipFrames(model, clip, phase, pair);
          expect(pair.from).toBeLessThan(model.frames.length);
          expect(pair.to).toBeLessThan(model.frames.length);
          expect(pair.blend).toBeGreaterThanOrEqual(0);
          expect(pair.blend).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  it("floats the swimming mallards on the water line", () => {
    const duck = getCritterModels()[CRITTER.mallardDrake]!;
    const swim = duck.frames[0]!;
    let lowest = Infinity;
    for (let index = 1; index < swim.positions.length; index += 3)
      lowest = Math.min(lowest, swim.positions[index]!);
    expect(lowest).toBeGreaterThan(-0.01);
    expect(swim.height).toBeLessThan(0.25);
  });
});

describe("water critter habitats", () => {
  const terrain = createCritterTerrain(world);
  const sites = createCritterSites(terrain, CRITTER_COLONIES);

  it("places the same sites for the same seed and others for another", () => {
    const again = createCritterSites(createCritterTerrain(world), CRITTER_COLONIES);
    expect(again.list).toEqual(sites.list);
    const other = createCritterSites(
      createCritterTerrain(createCritterWorld(99)),
      CRITTER_COLONIES
    );
    expect(other.list).not.toEqual(sites.list);
  });

  it("puts each colony in its habitat, spaced apart", () => {
    for (const site of sites.list) {
      const colony = CRITTER_COLONIES[site.colony]!;
      const depth = terrain.depth(site.x, site.z);
      if (colony.name === "mallards") expect(depth).toBeGreaterThan(0.08);
      if (colony.name === "herons") expect(depth).toBeLessThan(0.4);
      if (colony.name === "beach gulls") expect(depth).toBeLessThan(0.05);
      if (colony.behaviour === BEHAVIOUR.leap) expect(depth).toBeGreaterThan(0.12);
      for (const other of sites.list) {
        if (other === site || other.colony !== site.colony) continue;
        expect(Math.hypot(other.x - site.x, other.z - site.z)).toBeGreaterThanOrEqual(
          colony.spacing
        );
      }
    }
  });

  it("finds water birds and fish on a river island", () => {
    for (const name of ["mallards", "herons", "river trout", "sea mackerel"]) {
      expect(sites.list.some((site) => site.colony === colonyIndex(name))).toBe(true);
    }
  });

  it("marks fish sites as food (always shown) and the birds as decorative", () => {
    for (const site of sites.list) {
      const behaviour = CRITTER_COLONIES[site.colony]!.behaviour;
      if (behaviour === BEHAVIOUR.leap) expect(site.food).toBe(true);
      if (behaviour <= BEHAVIOUR.shore) expect(site.food).toBe(false);
    }
    expect(CRITTER_SPECIES[CRITTER.trout]!.food).toBe(true);
    expect(CRITTER_SPECIES[CRITTER.mallardDrake]!.food).toBe(false);
  });

  it("keeps fewer ducks and herons on a snowy island", () => {
    const snowy = createCritterWorld(1234, "snowy");
    const snowSites = createCritterSites(createCritterTerrain(snowy), CRITTER_COLONIES);
    const count = (list: typeof sites.list, name: string) =>
      list.filter((site) => site.colony === colonyIndex(name)).length;
    const water = (list: typeof sites.list) => count(list, "mallards") + count(list, "herons");
    expect(water(snowSites.list)).toBeLessThanOrEqual(water(sites.list));
  });
});

describe("water critter life", () => {
  const terrain = createCritterTerrain(world);
  const sites = createCritterSites(terrain, CRITTER_COLONIES);
  const ducks = sites.list.find((site) => site.colony === colonyIndex("mallards"))!;

  it("is deterministic", () => {
    const first = runAt(world, ducks.x, ducks.z, 6).frames.at(-1);
    const second = runAt(world, ducks.x, ducks.z, 6).frames.at(-1);
    expect(second).toEqual(first);
  });

  it("keeps the ducks on the water", () => {
    const { frames } = runAt(world, ducks.x, ducks.z, 40);
    let seen = 0;
    for (const frame of frames) {
      frame.species.forEach((species, index) => {
        if (species > CRITTER.duckling) return;
        seen += 1;
        expect(terrain.depth(frame.x[index]!, frame.z[index]!)).toBeGreaterThan(0.05);
      });
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("shows nothing zoomed far out or under the fog of war", () => {
    const manager = createCritterManager(world);
    const environment = computeEnvironment(world.sun, 12, 0);
    for (let time = 0; time < 3; time += 1 / 30) {
      expect(
        manager.update(time, createView(world, ducks.x, ducks.z, 0.3), environment).count
      ).toBe(0);
    }
    const hidden = createCritterWorld();
    hidden.fog.fill(FOG.hidden);
    const { frames } = runAt(hidden, ducks.x, ducks.z, 3);
    expect(frames.every((frame) => frame.count === 0)).toBe(true);
  });

  it("lets the Critters setting clear the birds but never the fish", () => {
    const trout = sites.list.find((site) => site.food)!;
    const manager = createCritterManager(world);
    manager.setDecorativeEnabled(false);
    const camera = createView(world, trout.x, trout.z);
    const environment = computeEnvironment(world.sun, 12, 0);
    let fish = 0;
    for (let time = 0; time < 60; time += 1 / 30) {
      const frame = manager.update(time, camera, environment);
      for (let index = 0; index < frame.count; index += 1) {
        expect(CRITTER_SPECIES[frame.species[index]!]!.food).toBe(true);
        fish += 1;
      }
    }
    expect(fish).toBeGreaterThan(0);
  });

  it("lets the ducks flee a worker paddling close", () => {
    let worker = { x: -100, z: -100 };
    const manager = createCritterManager(world, { getWorkers: () => [worker] });
    const camera = createView(world, ducks.x, ducks.z);
    const environment = computeEnvironment(world.sun, 12, 0);
    let frame = manager.update(0, camera, environment);
    for (let time = 0; time < 3; time += 1 / 30) frame = manager.update(time, camera, environment);
    const before = { x: frame.x[0]!, z: frame.z[0]! };
    worker = { x: before.x + 0.8, z: before.z };
    for (let time = 3; time < 6; time += 1 / 30) frame = manager.update(time, camera, environment);
    const distance = Math.hypot(frame.x[0]! - worker.x, frame.z[0]! - worker.z);
    expect(distance).toBeGreaterThan(0.8);
  });
});
