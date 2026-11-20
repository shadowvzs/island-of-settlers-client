import { describe, expect, it } from "vitest";

import { createFluvialMask } from "../src/shared/world/generation/fluvial-erosion";
import { carveStreamPower, type StreamPowerSettings, VALLEY_FLOOR } from "../src/shared/world/generation/stream-power";

const SIZE = 65;
const grid = { cellsX: SIZE - 1, cellsZ: SIZE - 1 };
const CENTRE = 32, RADIUS = 26;
const vertex = (x: number, z: number) => z * SIZE + x;

/** A cone island in a sea border with a gentle deterministic ripple, so the D8 flow is not degenerate. */
const coneIsland = () => {
  const heights = new Float32Array(SIZE * SIZE);
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    const distance = Math.hypot(x - CENTRE, z - CENTRE);
    const cone = (1 - distance / RADIUS) * 10;
    const ripple = Math.sin(x * .7) * Math.cos(z * .9) * .3;
    heights[vertex(x, z)] = distance >= RADIUS ? -2 : Math.max(.2, cone + ripple);
  }
  return heights;
};

const settings = (heights: Float32Array, overrides: Partial<StreamPowerSettings> = {}): StreamPowerSettings => ({
  deposition: .5, iterations: 4, mask: createFluvialMask(heights, new Float32Array(heights.length).fill(1)),
  plainHeight: .7, strength: 1, widening: 2, ...overrides
});

describe("stream-power carving", () => {
  const heights = coneIsland();
  const carved = carveStreamPower(grid, heights, settings(heights));

  it("never raises a vertex above its design and leaves the sea untouched", () => {
    for (let index = 0; index < heights.length; index++) {
      expect(carved[index]!).toBeLessThanOrEqual(heights[index]! + 1e-6);
      if (heights[index]! <= 0) expect(carved[index]).toBe(heights[index]);
    }
  });

  it("keeps carved valley floors above the beach band", () => {
    for (let index = 0; index < heights.length; index++) {
      if (heights[index]! <= 0) continue;
      expect(carved[index]!).toBeGreaterThanOrEqual(Math.min(heights[index]!, VALLEY_FLOOR) - 1e-6);
    }
  });

  it("carves alternating valleys and interfluves around the cone", () => {
    // A linear cone is no steady-state landscape, so the whole flank turns concave: valleys are the
    // ring positions cut deeper than the ring's mean incision.
    const ring = Array.from({ length: 128 }, (_, step) => {
      const angle = step / 128 * Math.PI * 2;
      const index = vertex(Math.round(CENTRE + Math.cos(angle) * RADIUS / 2), Math.round(CENTRE + Math.sin(angle) * RADIUS / 2));
      return heights[index]! - carved[index]!;
    });
    const mean = ring.reduce((sum, depth) => sum + depth, 0) / ring.length;
    let changes = 0;
    for (let step = 1; step < ring.length; step++) if ((ring[step]! > mean) !== (ring[step - 1]! > mean)) changes++;
    expect(mean).toBeGreaterThan(.5);
    expect(changes).toBeGreaterThanOrEqual(6);
  });

  it("is deterministic across repeated calls and keeps the input intact", () => {
    const again = carveStreamPower(grid, coneIsland(), settings(heights));
    expect(Array.from(again)).toEqual(Array.from(carved));
    expect(Array.from(heights)).toEqual(Array.from(coneIsland()));
  });

  it("does nothing with an empty mask or zero strength", () => {
    const masked = carveStreamPower(grid, heights, settings(heights, { mask: new Float32Array(heights.length) }));
    const still = carveStreamPower(grid, heights, settings(heights, { strength: 0 }));
    expect(Array.from(masked)).toEqual(Array.from(heights));
    expect(Array.from(still)).toEqual(Array.from(heights));
  });
});
