import { describe, expect, it } from "vitest";

import { createBirdBuildingAvoidance } from "../src/render-common/birds/bird-building-avoidance";
import { getBirdBuildingBounds } from "../src/render-common/birds/bird-building-bounds";
import { createFlock } from "../src/render-common/birds/bird-flock";
import type { HabitatField } from "../src/render-common/birds/bird-habitat";
import { createFlockLifecycle } from "../src/render-common/birds/bird-lifecycle";
import { updateBird } from "../src/render-common/birds/bird-motion";
import { createBirdHistory,createBirdPool } from "../src/render-common/birds/bird-pool";
import { getBirdRoofPerch, getRoofSlot } from "../src/render-common/birds/bird-roof-perches";
import { findRoofRidgeSpan } from "../src/render-common/birds/bird-roof-ridge";
import { createViewRegion } from "../src/render-common/birds/bird-view";
import type { BuildingPart, BuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { createRandom } from "../src/shared/world/rng";
const building = { uid: 42, typeId: 17, x: 10, y: 0, z: 10, rotation: 0 };
const field = {
  blocksX: 10,
  blocksZ: 10,
  surface: () => 0,
  canopy: new Float32Array(100),
  forest: new Float32Array(100),
  grass: new Float32Array(100).fill(1),
  water: new Float32Array(100),
  cover: new Float32Array(100),
  coverTop: new Float32Array(100),
  open: new Float32Array(100).fill(1)
} satisfies HabitatField;
const setup = () => {
  const buildings = createBirdBuildingAvoidance();
  buildings.refresh([building]);
  const roof = getBirdRoofPerch(building, 0.72, 3)!;
  const flock = createFlock();
  Object.assign(flock, {
    active: true,
    size: 3,
    species: 0,
    mode: "land",
    roof,
    landX: roof.x,
    landY: roof.y,
    landZ: roof.z,
    x: roof.x - 3,
    y: roof.y + 2,
    z: roof.z
  });
  const pool = createBirdPool(3);
  for (let bird = 0; bird < 3; bird++) {
    flock.members[bird] = bird;
    pool.flock[bird] = 0;
    pool.appear[bird] = 1;
    pool.x[bird] = roof.x - 3;
    pool.z[bird] = roof.z + (bird - 1) * 0.5;
    pool.y[bird] = roof.y + 2;
    pool.rateFactor[bird] = 1;
    pool.flapBoost[bird] = 1;
    pool.speedFactor[bird] = 1;
  }
  const context = { buildings, field, random: createRandom(3), step: 1 / 30, time: 0 };
  return { buildings, roof, flock, pool, context };
};
describe("deliberate bird roof perches", () => {
  it("rebuilds bounds for an in-place completed upgrade and invalidates the old perch", () => {
    const upgraded = { ...building, workshopUpgrade: { level: 0 as 0 | 1 | 2 | 3 | 4 } };
    const avoidance = createBirdBuildingAvoidance();
    const roof = getBirdRoofPerch(upgraded, .72, 3)!;
    const before = getBirdBuildingBounds(upgraded);
    expect(avoidance.refresh([upgraded])).toBe(true);
    expect(avoidance.refresh([upgraded])).toBe(false);
    upgraded.workshopUpgrade.level = 4;
    expect(avoidance.refresh([upgraded])).toBe(true);
    expect(getBirdBuildingBounds(upgraded).maxY).toBeGreaterThan(before.maxY);
    expect(avoidance.validRoof(roof, .72, 3)).toBe(false);
    expect(avoidance.refresh([upgraded])).toBe(false);
  });
  it("separates nation geometry and refreshes collisions when the nation changes", () => {
    const avoidance = createBirdBuildingAvoidance();
    expect(avoidance.refresh([{ ...building, nation: "roman" }])).toBe(true);
    expect(avoidance.refresh([{ ...building, nation: "japanese" }])).toBe(true);
    expect(avoidance.refresh([{ ...building, nation: "japanese" }])).toBe(false);
    const roman = getBirdBuildingBounds(building);
    const japanese = getBirdBuildingBounds({ ...building, nation: "japanese" });
    expect(japanese.maxY).not.toBe(roman.maxY);
  });
  it("reserves a ridge for one flock and frees it when that flock leaves", () => {
    const { buildings, roof } = setup();
    const first = { x: roof.x - 3, y: roof.y + 1, z: roof.z };
    const second = { ...first };
    expect(buildings.roofNear(first, 0.72, 3)?.uid).toBe(42);
    expect(buildings.roofNear(second, 0.72, 3)).toBeNull();
    buildings.releaseRoof(first);
    expect(buildings.roofNear(second, 0.72, 3)?.uid).toBe(42);
    expect(getBirdRoofPerch({ ...building, construction: 0.5 }, 0.72, 3)).toBeNull();
  });
  it("uses real rotated ridge positions and excludes flags and moving mill sails", () => {
    expect(getBirdRoofPerch({ ...building, typeId: 1 }, 0.72, 3)).toBeNull();
    expect(getBirdRoofPerch({ ...building, typeId: 31 }, 0.72, 3)).toBeNull();
    const roof = getBirdRoofPerch(building, 0.72, 3)!;
    const rotated = getBirdRoofPerch({ ...building, rotation: 1 }, 0.72, 3)!;
    expect(rotated.x - building.x).toBeCloseTo(roof.z - building.z);
    expect(rotated.z - building.z).toBeCloseTo(-(roof.x - building.x));
    expect(getBirdRoofPerch(building, 0.72, 100)).toBeNull();
  });
  it("ignores only its own safe roof above solid architecture, preserving adjacent collisions", () => {
    const { buildings, roof } = setup();
    expect(buildings.clear(roof, 0.43)).toBe(false);
    expect(buildings.clear(roof, 0.43, roof)).toBe(true);
    expect(buildings.clear({ ...roof, y: roof.surfaceY - 0.1 }, 0.43, roof)).toBe(false);
    buildings.refresh([building, { ...building, uid: 43 }]);
    expect(buildings.clear(roof, 0.43, roof)).toBe(false);
  });
  it("lands three visible birds in separate static slots and takes off from those exact positions", () => {
    const { buildings, context, flock, pool, roof } = setup();
    for (let step = 0; step < 450; step++) {
      context.time += context.step;
      flock.modeTime += context.step;
      for (let bird = 0; bird < 3; bird++) updateBird(pool, bird, flock, context);
    }
    for (let bird = 0; bird < 3; bird++) {
      const target = getRoofSlot(roof, bird, 3);
      expect(pool.settle[bird]).toBe(1);
      expect(pool.appear[bird]).toBe(1);
      expect(pool.x[bird]).toBeCloseTo(target.x);
      expect(pool.y[bird]).toBeCloseTo(target.y);
      expect(pool.z[bird]).toBeCloseTo(target.z);
      expect(pool.speed[bird]).toBe(0);
    }
    const positions = Array.from(pool.x);
    const region = createViewRegion();
    region.centerX = 10;
    region.centerZ = 10;
    region.halfU = 100;
    region.halfV = 100;
    const lifecycle = createFlockLifecycle(
      { ...context, region, activity: 1, noise: () => 0 },
      pool,
      createBirdHistory(3)
    );
    lifecycle.updateLifecycle(flock);
    expect(flock.mode).toBe("rest");
    flock.modeTime = 100;
    lifecycle.updateLifecycle(flock);
    expect(flock.mode).toBe("takeoff");
    expect(Array.from(pool.x)).toEqual(positions);
    expect(Array.from(pool.appear)).toEqual([1, 1, 1]);
    expect(buildings.validRoof(roof, 0.72, 3)).toBe(true);
    buildings.refresh([]);
    expect(buildings.validRoof(roof, 0.72, 3)).toBe(false);
  });
});
describe("occupation-roof ridge detection", () => {
  const recipeOf = (parts: BuildingPart[]): BuildingRecipe => ({
    door: [0, 0, 0],
    doorProfile: "flat",
    mechanism: [0, 0, 0],
    parts,
    workerExit: [0, 0, 0],
    workPoint: [0, 0, 0]
  });
  const cover = (overrides: Partial<BuildingPart> = {}): BuildingPart => ({
    occupationRoof: "gable",
    position: [1.5, 2, -0.5],
    rotation: [0, Math.PI / 2, 0],
    shape: "occupation-roof",
    size: [1.2, 0.6, 2.4],
    stage: 3,
    surface: "planks",
    ...overrides
  });
  it("puts the cover's rendered top edge on the ridge line in its rotation", () => {
    const turned = findRoofRidgeSpan([recipeOf([cover()])])!;
    expect(turned.axis).toBe(0);
    expect(turned.centre[0]).toBeCloseTo(1.5);
    expect(turned.centre[2]).toBeCloseTo(-0.5);
    expect(turned.centre[1]).toBeCloseTo(2 + 0.43 * 0.6);
    expect(turned.length).toBeCloseTo(2.4);
    const straight = findRoofRidgeSpan([
      recipeOf([cover({ position: [-0.5, 1, 0.25], rotation: undefined })])
    ])!;
    expect(straight.axis).toBe(2);
    expect(straight.centre[0]).toBeCloseTo(-0.5);
    expect(straight.centre[2]).toBeCloseTo(0.25);
    expect(straight.centre[1]).toBeCloseTo(1 + 0.43 * 0.6);
    expect(straight.length).toBeCloseTo(2.4);
  });
  it("keeps only the straight middle ridge of a hipped cover", () => {
    const halfHip = findRoofRidgeSpan([recipeOf([cover({ occupationRoof: "half-hip" })])])!;
    expect(halfHip.length).toBeCloseTo(2.4 * 0.6);
    const pyramid = findRoofRidgeSpan([recipeOf([cover({ occupationRoof: "pyramid" })])]);
    expect(pyramid).toBeNull();
  });
});
