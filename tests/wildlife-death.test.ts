import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createCamera } from "../src/render-common/camera-state";
import { DEATH_END, DEATH_TIMING, getDeathRoll } from "../src/render-common/helpers";
import { createAnimalManager } from "../src/render-common/wildlife/animal-manager";
import { MODEL_LOD, parseAnimalAsset } from "../src/render-common/wildlife/model/animal-asset";
import {
  computeAnimalPose,
  createRestMotion
} from "../src/render-common/wildlife/model/animal-pose";
import {
  PART,
  POSE_CHANNELS,
  poseAnimalMesh} from "../src/render-common/wildlife/model/animal-rig";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { RESPAWN_SECONDS, RESPAWN_TICKS } from "../src/render-common/wildlife/population/respawn-ledger";
import { SPECIES } from "../src/render-common/wildlife/wildlife-species";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld } from "./helpers/cached-worlds";
import { wakeAllRegions } from "./helpers/wildlife-awake";

const NAMES = { [SPECIES.rabbit]: "rabbit", [SPECIES.deer]: "deer", [SPECIES.elk]: "elk" };

const loadModel = (species: number) => {
  const name = NAMES[species as keyof typeof NAMES];
  const bytes = readFileSync(`assets/models/animals/${name}/${name}.glb`);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return parseAnimalAsset(species, buffer).lods[MODEL_LOD.close]!;
};

const MODELS = Object.fromEntries([0, 1, 2].map((species) => [species, loadModel(species)]));

/**
 * Lowest vertex (of the given parts, all when empty) of an animal `death` (0 .. 1) into its
 * fall, the instance roll applied.
 */
const getFallLowest = (species: number, death: number, antlers = 0, parts: number[] = []) => {
  const model = MODELS[species]!;
  const motion = createRestMotion();
  motion.death = death;
  motion.antlers = antlers;
  const pose = new Float32Array(POSE_CHANNELS);
  const lift = computeAnimalPose(species, motion, pose, 0);
  const positions = poseAnimalMesh(model, pose, antlers).positions;
  const angle = -getDeathRoll(death);
  let lowest = Infinity;
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    if (parts.length > 0 && !parts.includes(model.parts[vertex]!)) continue;
    const y = positions[vertex * 3 + 1]!;
    const z = positions[vertex * 3 + 2]!;
    lowest = Math.min(lowest, y * Math.cos(angle) - z * Math.sin(angle) + lift);
  }
  return lowest;
};

const FALL_CASES = [
  { antlers: 0, species: SPECIES.rabbit },
  { antlers: 0, species: SPECIES.deer },
  { antlers: 1, species: SPECIES.deer },
  { antlers: 0, species: SPECIES.elk },
  { antlers: 0.5, species: SPECIES.elk },
  { antlers: 1, species: SPECIES.elk }
];

describe("death pose", () => {
  it.each(FALL_CASES)("falls onto its side without sinking into the ground (%o)", (fall) => {
    for (let step = 0; step <= 20; step += 1) {
      const lowest = getFallLowest(fall.species, step / 20, fall.antlers);
      expect(lowest, `death ${step / 20}`).toBeGreaterThan(-0.008);
    }
    expect(getDeathRoll(1)).toBeCloseTo(Math.PI / 2);
  });

  it.each(FALL_CASES)("lays the head down on the ground once settled (%o)", (fall) => {
    const head = getFallLowest(fall.species, 1, fall.antlers, [
      PART.head,
      PART.earLeft,
      PART.earRight
    ]);
    const rack = fall.antlers > 0 ? getFallLowest(fall.species, 1, fall.antlers, [PART.antler]) : 1;
    const resting = Math.min(head, rack);
    expect(resting).toBeLessThan(0.02);
    if (fall.antlers === 0) expect(head).toBeLessThan(0.02);
  });
});

describe("killing an animal", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, seed: 1234 });
  const manager = createAnimalManager(world, createIslandNav(world, []));
  const { identity, ledger, pool } = manager.debug;
  let time = 0;
  wakeAllRegions(manager, world);
  manager.step();

  /** Runs the simulation `seconds` long with the view on (x, z). */
  const run = (seconds: number, x: number, z: number) => {
    const camera = createCamera(x, z, 2);
    camera.viewportWidth = 1600;
    camera.viewportHeight = 900;
    const end = time + seconds;
    while (time < end) {
      time += 0.1;
      manager.update(time, camera);
    }
    return manager.update(time, camera);
  };
  /** A living simulated animal (a hunter's scan keeps every region awake). */
  const findLiving = () => {
    wakeAllRegions(manager, world);
    return pool.active.findIndex((active, slot) => active === 1 && !pool.pending[slot]);
  };
  const findInFrame = (frame: ReturnType<typeof run>, x: number, z: number) =>
    Array.from({ length: frame.count }, (_, slot) => slot).find(
      (slot) => frame.x[slot] === x && frame.z[slot] === z
    );

  it("falls, lies as a carcass, then fades out and despawns", () => {
    const animal = findLiving();
    const [x, z] = [pool.x[animal]!, pool.z[animal]!];
    run(1, x, z);
    const alive = manager.countAlive();
    manager.killAnimal(animal);
    expect(pool.active[animal]).toBe(0);
    expect(manager.countAlive()).toBe(alive - 1);
    expect(manager.isCarcass(animal)).toBe(false);
    run(DEATH_TIMING.fall + 0.5, x, z);
    expect(manager.isCarcass(animal)).toBe(true);
    const lying = run(DEATH_TIMING.lie / 2, x, z);
    const slot = findInFrame(lying, pool.x[animal]!, pool.z[animal]!)!;
    expect(lying.appear[slot]).toBeGreaterThan(0.99);
    const fading = run(DEATH_TIMING.lie / 2 + DEATH_TIMING.fade / 2, x, z);
    expect(fading.appear[findInFrame(fading, pool.x[animal]!, pool.z[animal]!)!]).toBeLessThan(0.9);
    run(DEATH_TIMING.fade, x, z);
    expect(pool.carcass[animal]).toBe(0);
    expect(manager.isCarcass(animal)).toBe(false);
  });

  it("owes its region a new animal five minutes after the death", () => {
    const animal = findLiving();
    const region = identity.homeRegion[animal]!;
    const owed = ledger.pending(region);
    manager.killAnimal(animal);
    expect(identity.homeRegion[animal]).toBe(-1);
    expect(ledger.pending(region)).toBe(owed + 1);
    const last = ledger.count() - 1;
    expect(ledger.region(last)).toBe(region);
    expect(ledger.dueTick(last)).toBe(manager.saveState().tick + RESPAWN_TICKS);
    expect(DEATH_END).toBeLessThan(RESPAWN_SECONDS);
  });

  it("harvests a lying carcass at once (and only once)", () => {
    const animal = findLiving();
    manager.killAnimal(animal);
    expect(manager.harvestCarcass(animal)).toBe(false);
    run(DEATH_TIMING.fall + 0.2, pool.x[animal]!, pool.z[animal]!);
    expect(manager.harvestCarcass(animal)).toBe(true);
    expect(pool.carcass[animal]).toBe(0);
    expect(manager.harvestCarcass(animal)).toBe(false);
  });
});
