import { expect, it } from "vitest";

import { createShipOverlapTest, ENVELOPE_REACH, shipsOverlap } from
  "../src/shared/settlement/settlement-ship-clearance";

it("preserves exact overlap decisions through signed-zero, contact boundaries and angular cache eviction", () => {
  const overlaps = createShipOverlapTest();
  const headings = [0, -0, Math.PI, -Math.PI, Math.PI / 2, -Math.PI / 2, .217,
    ...Array.from({ length: 280 }, (_, index) => index / 37), 0, -0];
  const distances = [0, -0, 5.6 - 1e-10, 5.6, 5.6 + 1e-10, 11 - 1e-10, 11, 11 + 1e-10,
    ENVELOPE_REACH - 1e-10, ENVELOPE_REACH, ENVELOPE_REACH + 1e-10];
  for (const aYaw of headings) for (const bYaw of [0, -0, .217, Math.PI / 2, -Math.PI / 2])
    for (const distance of distances) for (const z of [0, -0, 3.2, 5.6]) {
      const a = { x: 0, z: 0, yaw: aYaw }, b = { x: distance, z, yaw: bYaw };
      expect(overlaps(a, b)).toBe(shipsOverlap(a, b));
    }
});

it("rechecks changed positions and headings rather than caching collision outcomes", () => {
  const overlaps = createShipOverlapTest(), a = { x: 1, z: 2, yaw: .217 }, b = { x: 2, z: 3, yaw: -.217 };
  for (let index = 0; index < 2000; index++) {
    b.x = index % 30; b.z = (index * 7) % 30;
    if (index % 40 === 0) { a.yaw += .13; b.yaw -= .17; }
    expect(overlaps(a, b)).toBe(shipsOverlap(a, b));
  }
});
