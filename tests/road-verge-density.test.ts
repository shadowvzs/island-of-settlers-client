import { expect, it } from "vitest";

import { roadVergeKeepLevel, roadVergeNear, VERGE_KEEP_LEVELS,
  vergeProjectedPixels } from "../src/render-common/road-verges/road-verge-density";

it("never adds a verge plant when the projected size shrinks", () => {
  let previous = VERGE_KEEP_LEVELS.length - 1;
  for (let pixels = 40; pixels > 0; pixels -= .25) {
    const level = roadVergeKeepLevel(pixels);
    expect(level).toBeLessThanOrEqual(previous);
    previous = level;
  }
  expect(roadVergeKeepLevel(0)).toBe(0);
  expect(VERGE_KEEP_LEVELS[roadVergeKeepLevel(40)]).toBe(1);
});

it("keeps a drawn level and the High parts through a small size change (hysteresis)", () => {
  const entered = roadVergeKeepLevel(5.6);
  expect(roadVergeKeepLevel(5.2)).toBeLessThan(entered);
  expect(roadVergeKeepLevel(5.2, entered)).toBe(entered);
  expect(roadVergeNear(17)).toBe(false);
  expect(roadVergeNear(17, true)).toBe(true);
});

it("treats the spyglass like walking closer: projected size scales with zoom over distance", () => {
  const eye = vergeProjectedPixels(.2, 40, 1.5, 800, false);
  const spyglass4x = vergeProjectedPixels(.2, 40, 1.5 * 4, 800, false);
  expect(spyglass4x).toBeCloseTo(vergeProjectedPixels(.2, 10, 1.5, 800, false));
  expect(roadVergeKeepLevel(spyglass4x)).toBeGreaterThanOrEqual(roadVergeKeepLevel(eye));
});
