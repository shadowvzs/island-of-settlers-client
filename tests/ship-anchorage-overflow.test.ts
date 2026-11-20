import { expect, it, vi } from "vitest";

import { findShipAnchorage } from "../src/shared/settlement/settlement-ship-anchorage";
import { shipsOverlap } from "../src/shared/settlement/settlement-ship-clearance";

it("keeps the ordinary nearest waiting point and bounds the separate overflow pass", () => {
  const berth = { x: 0, z: 0 };
  expect(findShipAnchorage([berth], [], [], { overlaps: shipsOverlap, usable: () => true }))
    .toEqual({ x: 0, yaw: Math.PI / 2, z: 18 });
  const farWater = { overlaps: shipsOverlap,
    usable: (point: { x: number; z: number }) => Math.hypot(point.x, point.z) >= 62 };
  expect(findShipAnchorage([berth], [], [], farWater)).toBeNull();
  const overflow = findShipAnchorage([berth], [], [], farWater, berth, true)!;
  expect(Math.hypot(overflow.x, overflow.z)).toBeGreaterThanOrEqual(64);
  expect(Math.hypot(overflow.x, overflow.z)).toBeLessThanOrEqual(128);
  const beyond = vi.fn((point: { x: number; z: number }) => Math.hypot(point.x, point.z) > 140);
  expect(findShipAnchorage([berth], [], [], { overlaps: shipsOverlap, usable: beyond }, berth, true)).toBeNull();
  expect(beyond.mock.calls.length).toBeLessThan(2200);
});
