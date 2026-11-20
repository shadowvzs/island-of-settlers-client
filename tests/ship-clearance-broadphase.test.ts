import { describe, expect, it } from "vitest";

import { SAILING_SHIP_SPACING } from "../src/render-common/ships/ship-dimensions";
import { ENVELOPE_REACH, moveKeepsClear, shipsOverlap, shipsPenetration } from
  "../src/shared/settlement/settlement-ship-clearance";

describe("ship clearance broad phase", () => {
  it("preserves exact clearance decisions for rotated close, distant and touching hulls", () => {
    // Compare against the unchanged exact test, including legacy overlapping starts.
    for (let heading = 0; heading < 32; heading++) {
      const current = { x: 20, z: 20, yaw: heading * Math.PI / 16 };
      const candidate = { x: 20.2, z: 19.9, yaw: current.yaw + .04 };
      for (let direction = 0; direction < 16; direction++) {
        const angle = direction * Math.PI / 8;
        for (const radius of [0, 1, 3, 6, ENVELOPE_REACH - 1e-8,
          ENVELOPE_REACH, ENVELOPE_REACH + 1e-8, ENVELOPE_REACH + .2, 30]) {
          const other = { x: candidate.x + Math.sin(angle) * radius,
            z: candidate.z + Math.cos(angle) * radius, yaw: angle - .13 };
          const depth = shipsPenetration(candidate, other);
          expect(shipsOverlap(candidate, other)).toBe(depth > .00001);
          expect(moveKeepsClear(current, candidate, other)).toBe(depth <= SAILING_SHIP_SPACING ||
            depth <= shipsPenetration(current, other) + 1e-9);
        }
      }
    }
  });
});
