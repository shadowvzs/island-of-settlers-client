import { expect, it } from "vitest";

import type { NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import { shipArrivalEstimate } from "../src/shared/settlement/ship-arrival-estimate";

it("includes both the off-map voyage and the remaining approach, ending at harbour arrival", () => {
  const ship = { x: 0, z: 0, yaw: 0, phase: "away", timer: 150,
    cursor: 0, route: [{ x: 0, z: 10 }] } as NavalShip;
  expect(shipArrivalEstimate(ship)).toBe(107);
  ship.timer = 120;
  expect(shipArrivalEstimate(ship)).toBe(87);
  ship.phase = "sailing"; ship.z = 5;
  expect(shipArrivalEstimate(ship)).toBe(4);
  ship.phase = "unloading";
  expect(shipArrivalEstimate(ship)).toBe(0);
});
