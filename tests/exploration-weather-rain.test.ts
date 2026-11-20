import { describe, expect, it, vi } from "vitest";

import {
  createExplorationRainField,
  createExplorationSplashField,
  type ExplorationRainDrop
} from "../src/renderers/three/exploration-weather";

const baseUpdate = {
  cameraX: 10,
  cameraY: 4,
  cameraZ: -2,
  deltaSeconds: 0.05,
  intensity: 1,
  timeSeconds: 0,
  windX: 0,
  windZ: 0
};

describe("exploration rain field", () => {
  it("keeps every drop inside the camera-local volume and reuses the fixed pool", () => {
    const model = createExplorationRainField({
      capacity: 64, height: 10, radius: 5, seed: 3
    });
    let sample = model.update(baseUpdate);
    expect(sample.drops).toHaveLength(64);
    for (let step = 0; step < 120; step++) {
      sample = model.update({ ...baseUpdate, timeSeconds: step * 0.05 });
    }
    expect(sample.capacity).toBe(64);
    expect(sample.drops).toBe(model.sample().drops);
    for (const drop of sample.drops) {
      expect(drop.active).toBe(true);
      expect(Math.hypot(drop.x - baseUpdate.cameraX, drop.z - baseUpdate.cameraZ))
        .toBeLessThanOrEqual(5 * 1.35 + 0.001);
      expect(drop.y).toBeGreaterThanOrEqual(baseUpdate.cameraY - 6 - 0.001);
      expect(drop.y).toBeLessThanOrEqual(baseUpdate.cameraY - 6 + 10 + 0.001);
    }
  });

  it("slanting wind moves the volume and the tail leads against the wind direction", () => {
    const calm = createExplorationRainField({ capacity: 32, height: 10, radius: 8, seed: 9 });
    const windy = createExplorationRainField({ capacity: 32, height: 10, radius: 8, seed: 9 });
    let calmSample = calm.update(baseUpdate);
    let windySample = windy.update({ ...baseUpdate, windX: 2, windZ: 0.5 });
    for (let step = 1; step <= 10; step++) {
      calmSample = calm.update({ ...baseUpdate, timeSeconds: step * 0.05 });
      windySample = windy.update({
        ...baseUpdate, timeSeconds: step * 0.05, windX: 2, windZ: 0.5
      });
    }
    const averageX = (drops: readonly ExplorationRainDrop[]) =>
      drops.reduce((sum, drop) => sum + drop.x, 0) / drops.length;
    expect(averageX(windySample.drops)).toBeGreaterThan(averageX(calmSample.drops) + 0.5);
    expect(windySample.windX).toBe(2);
    const slanted = windySample.drops.find(drop => drop.visible);
    expect(slanted).toBeDefined();
    expect(slanted!.tailX).toBeLessThan(slanted!.x);
    expect(slanted!.tailY).toBeGreaterThan(slanted!.y);
  });

  it("rejects drops outside the near/far depth range", () => {
    const model = createExplorationRainField({
      capacity: 64, far: 5, height: 12, near: 1, radius: 5, seed: 11
    });
    const sample = model.update({
      ...baseUpdate,
      forwardX: 0,
      forwardY: 0,
      forwardZ: 1
    });
    expect(sample.depthRejected).toBeGreaterThan(0);
    expect(sample.count).toBeLessThan(64);
    for (const drop of sample.drops) {
      if (drop.visible) {
        expect(drop.depth).toBeGreaterThanOrEqual(1);
        expect(drop.depth).toBeLessThanOrEqual(5);
      }
    }
  });

  it("samples shelter on a bounded rotating probe budget and hides covered drops", () => {
    const shelter = vi.fn(() => 1);
    const model = createExplorationRainField({
      capacity: 32, height: 10, radius: 6, seed: 4, shelter, shelterProbeBudget: 3
    });
    const sample = model.update({ ...baseUpdate, deltaSeconds: 0 });
    expect(shelter).toHaveBeenCalledTimes(3);
    expect(sample.sheltered).toBe(3);
    expect(sample.drops.filter(drop => drop.sheltered).every(drop => !drop.visible)).toBe(true);
    const uncovered = createExplorationRainField({
      capacity: 4, height: 10, radius: 2, seed: 4, shelter: () => 1, shelterProbeBudget: 4
    });
    const covered = uncovered.update({ ...baseUpdate, deltaSeconds: 0 });
    expect(covered.sheltered).toBe(4);
    expect(covered.count).toBe(0);
    expect(covered.drops.every(drop => !drop.visible)).toBe(true);
  });

  it("uses only its own seeded presentation randomness", () => {
    const random = vi.spyOn(Math, "random");
    const first = createExplorationRainField({ capacity: 8, seed: 21 });
    const second = createExplorationRainField({ capacity: 8, seed: 21 });
    const a = first.update(baseUpdate);
    const b = second.update(baseUpdate);
    expect(a.drops.map(drop => [drop.x, drop.y, drop.z]).slice(0, 8))
      .toEqual(b.drops.map(drop => [drop.x, drop.y, drop.z]).slice(0, 8));
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});

describe("exploration splash field", () => {
  const updateRain = () => {
    const rain = createExplorationRainField({ capacity: 32, height: 10, radius: 5, seed: 7 });
    return rain.update({ ...baseUpdate, forwardX: 0, forwardY: 0, forwardZ: 1 }).drops;
  };

  it("caps splash and ripple slots while reusing their fixed buffers", () => {
    const splash = createExplorationSplashField({
      rippleCapacity: 3,
      rippleSpawnsPerUpdate: 2,
      seed: 2,
      splashCapacity: 4,
      splashChance: 1,
      splashSpawnsPerUpdate: 2,
      rippleChance: 1
    });
    const drops = updateRain();
    const surfaceY = vi.fn(() => 0);
    let sample = splash.update({
      ...baseUpdate, drops, intensity: 1, surfaceY
    });
    for (let step = 1; step <= 30; step++) {
      sample = splash.update({
        ...baseUpdate, deltaSeconds: 0.05, drops, intensity: 1, surfaceY
      });
    }
    expect(sample.splashes).toHaveLength(4);
    expect(sample.ripples).toHaveLength(3);
    expect(sample.splashCount).toBeLessThanOrEqual(4);
    expect(sample.rippleCount).toBeLessThanOrEqual(3);
    expect(sample.spawns).toBeGreaterThan(4);
    expect(surfaceY.mock.calls.length).toBeLessThanOrEqual(sample.spawns);
  });

  it("does not allocate when the weather is dry and clears both pools", () => {
    const splash = createExplorationSplashField({
      rippleCapacity: 2, seed: 2, splashCapacity: 2, splashChance: 1, rippleChance: 1
    });
    const drops = updateRain();
    splash.update({ ...baseUpdate, drops, intensity: 1 });
    const dry = splash.update({ ...baseUpdate, drops, intensity: 0 });
    expect(dry.active).toBe(false);
    expect(dry.splashCount).toBe(0);
    expect(dry.rippleCount).toBe(0);
  });

  it("never calls Math.random", () => {
    const random = vi.spyOn(Math, "random");
    const splash = createExplorationSplashField({
      rippleCapacity: 2, seed: 2, splashCapacity: 2, splashChance: 1, rippleChance: 1
    });
    splash.update({ ...baseUpdate, drops: updateRain(), intensity: 1 });
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it("keeps impacts small, short and varied and puts ripples only on water", () => {
    const splash = createExplorationSplashField({
      rippleCapacity: 8, rippleSpawnsPerUpdate: 4, seed: 3, splashCapacity: 8, splashChance: 1,
      splashSpawnsPerUpdate: 4, rippleChance: 1
    });
    const drops = updateRain();
    const sample = splash.update({ ...baseUpdate, drops, intensity: 1, waterAt: () => false });
    const active = sample.splashes.filter(item => item.active);
    expect(active.length).toBeGreaterThan(1);
    expect(sample.rippleCount).toBe(0);
    for (const item of active) {
      expect(item.duration).toBeLessThan(0.2);
      expect(item.scale).toBeLessThanOrEqual(0.1);
    }
    expect(new Set(active.map(item => item.angle.toFixed(3))).size).toBe(active.length);
    const wet = splash.update({ ...baseUpdate, deltaSeconds: 0.05, drops, intensity: 1, waterAt: () => true });
    expect(wet.rippleCount).toBeGreaterThan(0);
  });
});
