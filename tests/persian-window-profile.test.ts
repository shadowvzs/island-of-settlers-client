import { expect, it } from "vitest";

import { persianWindowAngles, persianWindowCrown } from "../src/render-common/buildings/persian-window-profile";

it("keeps a rear arched opening continuous across the rounded wall's angle seam", () => {
  const window = { angle: Math.PI, bottom: -.2, halfAngle: .14, rise: .08, spring: .12 };
  expect(persianWindowCrown(window, Math.PI)).toBeCloseTo(.20);
  expect(persianWindowCrown(window, -Math.PI)).toBeCloseTo(.20);
  expect(persianWindowCrown(window, Math.PI - .14)).toBeCloseTo(.12, 7);
  expect(persianWindowCrown(window, -Math.PI + .14)).toBeCloseTo(.12, 7);
  expect(persianWindowCrown(window, 0)).toBeNull();
  for (const detailed of [true, false]) {
    const samples = persianWindowAngles([window], detailed);
    expect(samples.some(angle => angle > 3)).toBe(true);
    expect(samples.some(angle => angle < -3)).toBe(true);
    expect(samples.every(angle => persianWindowCrown(window, angle) !== null)).toBe(true);
  }
});
