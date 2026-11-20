import { describe, expect, it } from "vitest";

import { createTrackBehind, followPuller } from "../src/app/settlement/handcart-track";
import { HANDCART } from "../src/render-common/logistics/handcart-rules";

const STEP = .02, DT = 1 / 60;

/** Walks the puller along straight legs between `points`, following with the cart each step. */
const walk = (points: readonly { x: number; z: number }[], onStep?: (track: ReturnType<typeof createTrackBehind>) => void) => {
  const first = points[0]!, second = points[1]!;
  const track = createTrackBehind({ heading: Math.atan2(second.x - first.x, second.z - first.z), ...first });
  for (let leg = 1; leg < points.length; leg++) {
    const from = points[leg - 1]!, to = points[leg]!;
    const length = Math.hypot(to.x - from.x, to.z - from.z), heading = Math.atan2(to.x - from.x, to.z - from.z);
    for (let distance = STEP; distance <= length + 1e-9; distance += STEP) {
      const x = from.x + (to.x - from.x) * distance / length, z = from.z + (to.z - from.z) * distance / length;
      followPuller(track, { heading, x, z }, true, DT);
      onStep?.(track);
    }
  }
  return track;
};

describe("hand-cart track", () => {
  it("keeps the axle the shaft length straight behind a puller on a straight road", () => {
    const track = walk([{ x: 0, z: 0 }, { x: 0, z: 5 }]);
    expect(track.x).toBeCloseTo(0, 5);
    expect(track.z).toBeCloseTo(5 - HANDCART.carrierOffset, 2);
    expect(track.yaw).toBeCloseTo(0, 3);
  });

  it("keeps the axle on the walked road through a right-angle bend", () => {
    let farthest = 0;
    walk([{ x: 0, z: 0 }, { x: 0, z: 4 }, { x: 4, z: 4 }], track => {
      // Distance from the L-shaped road centre line.
      const offRoad = Math.min(Math.abs(track.x) + Math.max(0, track.z - 4), Math.abs(track.z - 4) + Math.max(0, -track.x));
      farthest = Math.max(farthest, offRoad);
    });
    expect(farthest).toBeLessThan(.03);
  });

  it("swings round its puller when he walks back past the cart", () => {
    const track = walk([{ x: 0, z: 0 }, { x: 0, z: 4 }, { x: 0, z: 1 }]);
    expect(Math.abs(Math.atan2(Math.sin(track.yaw - Math.PI), Math.cos(track.yaw - Math.PI)))).toBeLessThan(.2);
    expect(track.z).toBeGreaterThan(1);
  });
});
