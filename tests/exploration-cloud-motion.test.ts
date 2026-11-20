import { expect, it } from "vitest";

import { EXPLORATION_CLOUD_DRIFT } from "../src/render-common/atmosphere/cloud-drift";
import { createExplorationCloudMotion } from "../src/renderers/three/exploration-weather/exploration-cloud-motion";

const { lower, upper } = EXPLORATION_CLOUD_DRIFT;

it("continues in the same direction through the game's rain-to-clear wind fade", () => {
  const motion = createExplorationCloudMotion();
  let previous = [...motion.update(1000, .8 * 2.4, .35 * 2.4)];
  for (let frame = 1; frame <= 900; frame++) {
    const rain = Math.max(0, 1 - frame / 60 * .07);
    const wind = 1 + rain * 1.4;
    const next = motion.update(1000 + frame / 60, .8 * wind, .35 * wind);
    expect(next[0]!).toBeGreaterThan(previous[0]!);
    expect(next[2]!).toBeGreaterThan(previous[2]!);
    // At most the strongest (rain) wind for one 1/60 s frame: no jump.
    expect(next[0]! - previous[0]!).toBeLessThan(.8 * 2.4 / 60 * lower * 1.01);
    previous = [...next];
  }
});

it("keeps clouds travelling when wind changes would cancel wind times absolute time", () => {
  const motion = createExplorationCloudMotion();
  const initial = [...motion.update(1000, 1.2, .525)];
  const changedWind = 1.2 * 1000 / 1000.1;
  expect(changedWind * 1000.1).toBeCloseTo(1200);
  const next = motion.update(1000.1, changedWind, .525 * 1000 / 1000.1);
  expect(next[0]!).toBeGreaterThan(initial[0]!);
  expect(next[2]!).toBeGreaterThan(initial[2]!);
  expect(next[0]! - initial[0]!).toBeCloseTo(.12 * lower, 3);
});

it("keeps an independent cirrus drift, changes velocity without repositioning, and reuses storage", () => {
  const motion = createExplorationCloudMotion();
  const values = motion.update(0, 1, .5);
  for (let frame = 1; frame <= 60; frame++) motion.update(frame / 60, 1, .5);
  const afterOneSecond = [lower, lower * .5, upper, upper * .5];
  [...values].forEach((value, index) => expect(value).toBeCloseTo(afterOneSecond[index]!));
  expect(motion.update(1, 2, 1)).toBe(values);
  [...values].forEach((value, index) => expect(value).toBeCloseTo(afterOneSecond[index]!));
  motion.update(1.1, 2, 1);
  expect(values[0]).toBeCloseTo(lower * 1.2);
  expect(values[2]).toBeCloseTo(upper * 1.2);
});

it("avoids a background-gap jump and ignores invalid or backward timestamps", () => {
  const motion = createExplorationCloudMotion();
  const values = motion.update(0, 1, 0);
  motion.update(3600, 1, 0);
  expect([...values]).toEqual([.25 * lower, 0, .25 * upper, 0]);
  const snapshot = [...values];
  motion.update(Number.NaN, 1, 0);
  motion.update(3599, 1, 0);
  expect([...values]).toEqual(snapshot);
  motion.update(3600.1, 1, 0);
  expect(values[0]).toBeCloseTo(.35 * lower);
});
