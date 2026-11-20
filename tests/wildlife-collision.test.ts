import { describe, expect, it } from "vitest";

import { CRITTER } from "../src/render-common/critters/critter-species";
import type { CritterContext } from "../src/render-common/critters/sim/critter-context";
import {
  createCritterObstacles,
  getCritterRadius
} from "../src/render-common/critters/sim/critter-crowd";
import { createCritterPool } from "../src/render-common/critters/sim/critter-pool";
import { isRoamFree } from "../src/render-common/critters/sim/critter-roam";
import { combineObstacles } from "../src/render-common/crowd/crowd-space";
import { getTreeSpecies } from "../src/render-common/props/island-trees";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { isStandFree } from "../src/render-common/wildlife/nav/nav-query";
import { createAnimalCrowd, getAnimalRadius } from "../src/render-common/wildlife/sim/animal-crowd";
import { createAnimalPool, createMotionPool } from "../src/render-common/wildlife/sim/animal-pool";
import { ANIMAL_STATE, SPECIES } from "../src/render-common/wildlife/wildlife-species";
import { createCritterWorld } from "./critter-test-world";

const STEP = 1 / 30;
const world = createCritterWorld();
const nav = createIslandNav(world, []);

/** An open spot where a deer stands free with room around. */
const findOpenSpot = () => {
  for (let z = 20; z < world.cellsZ - 20; z += 1) {
    for (let x = 20; x < world.cellsX - 20; x += 1) {
      const room = [-1, 0, 1].every((dz) =>
        [-1, 0, 1].every((dx) => isStandFree(nav, SPECIES.deer, x + dx, z + dz))
      );
      if (room) return { x: x + 0.5, z: z + 0.5 };
    }
  }
  throw new Error("no open spot");
};

const spot = findOpenSpot();

const createDeer = (count: number) => {
  const pool = createAnimalPool(count);
  for (let animal = 0; animal < count; animal += 1) {
    pool.active[animal] = 1;
    pool.species[animal] = SPECIES.deer;
    pool.bodyScale[animal] = 1;
    pool.state[animal] = ANIMAL_STATE.idle;
    pool.x[animal] = spot.x + animal * 0.02;
    pool.z[animal] = spot.z;
  }
  const motion = createMotionPool(count);
  return { crowd: createAnimalCrowd(pool, motion, () => nav), motion, pool };
};

const gapOf = (pool: ReturnType<typeof createAnimalPool>, a: number, b: number) =>
  Math.hypot(pool.x[a]! - pool.x[b]!, pool.z[a]! - pool.z[b]!);

describe("animal collision", () => {
  it("lets two standing deer on one spot drift apart to their personal radius", () => {
    const { crowd, pool } = createDeer(2);
    for (let step = 0; step < 300; step += 1) crowd.step(STEP);
    expect(gapOf(pool, 0, 1)).toBeGreaterThan(getAnimalRadius(pool, 0) * 2 - 0.02);
  });

  it("keeps a lying deer in place and moves the standing one", () => {
    const { crowd, pool } = createDeer(2);
    pool.state[0] = ANIMAL_STATE.rest;
    const lying = { x: pool.x[0]!, z: pool.z[0]! };
    for (let step = 0; step < 300; step += 1) crowd.step(STEP);
    expect(pool.x[0]).toBe(lying.x);
    expect(pool.z[0]).toBe(lying.z);
    expect(gapOf(pool, 0, 1)).toBeGreaterThan(getAnimalRadius(pool, 0) * 2 - 0.02);
  });

  it("keeps a deer that is still rising in place (no folded body slides over the ground)", () => {
    const { crowd, motion, pool } = createDeer(2);
    motion.rest[0] = 0.6;
    const rising = { x: pool.x[0]!, z: pool.z[0]! };
    for (let step = 0; step < 300; step += 1) crowd.step(STEP);
    expect(pool.x[0]).toBe(rising.x);
    expect(pool.z[0]).toBe(rising.z);
  });

  it("reports a crowded spot (no lying down on another animal)", () => {
    const { crowd, pool } = createDeer(2);
    pool.state[0] = ANIMAL_STATE.rest;
    crowd.step(STEP);
    expect(crowd.isCrowded(1)).toBe(true);
    pool.x[1] = spot.x + 5;
    crowd.step(STEP);
    expect(crowd.isCrowded(1)).toBe(false);
  });

  it("combines obstacle sources", () => {
    const seen: number[] = [];
    const source = combineObstacles(
      (add) => add(1, 0, 0.1),
      (add) => add(2, 0, 0.1)
    );
    source((x) => seen.push(x));
    expect(seen).toEqual([1, 2]);
  });
});

describe("critter collision", () => {
  it("gives ground mammals a radius, never squirrels or lifted critters", () => {
    const pool = createCritterPool(3);
    for (const [index, species] of [CRITTER.boar, CRITTER.squirrel, CRITTER.fox].entries()) {
      pool.active[index] = 1;
      pool.species[index] = species;
      pool.scale[index] = 1;
    }
    pool.lift[2] = 1;
    expect(getCritterRadius(pool, 0)).toBeGreaterThan(0.1);
    expect(getCritterRadius(pool, 1)).toBe(0);
    expect(getCritterRadius(pool, 2)).toBe(0);
    const listed: number[] = [];
    createCritterObstacles(pool)((_x, _z, radius) => listed.push(radius));
    expect(listed).toHaveLength(1);
  });

  it("never lets a roaming critter stand in a tree trunk", () => {
    const tree = Array.from({ length: world.props.count }, (_, index) => index).find(
      (index) => getTreeSpecies(world.props.types[index]!) === "oak"
    )!;
    const context = { nav, terrain: null } as unknown as CritterContext;
    const [x, z] = [world.props.x[tree]!, world.props.z[tree]!];
    expect(isRoamFree(context, CRITTER.boar, x, z)).toBe(false);
  });
});
