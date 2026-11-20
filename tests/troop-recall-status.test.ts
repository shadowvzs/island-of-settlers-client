import { expect, it } from "vitest";

import { troopRecallStatus } from "../src/app/settlement/troop-recall-status";

it("counts down pickup arrival and replaces the timer with boarding and return status", () => {
  const ship = { troopRecall: true, phase: "away" as const, awaySeconds: 150, returningHome: false };
  expect(troopRecallStatus([ship])).toBe("Ship arriving in 2:30");
  expect(troopRecallStatus([{ ...ship, awaySeconds: 89.2 }])).toBe("Ship arriving in 1:30");
  expect(troopRecallStatus([{ ...ship, phase: "loading", awaySeconds: 0 }])).toBe("Soldiers boarding the ship");
  expect(troopRecallStatus([{ ...ship, phase: "loading", returningHome: true }])).toBe("Ship returning to the home island");
  expect(troopRecallStatus([{ ...ship, troopRecall: false }])).toBeUndefined();
});

it("keeps the arrival timer until the last requested pickup ship arrives", () => {
  const ship = { troopRecall: true, phase: "away" as const, awaySeconds: 30, returningHome: false };
  expect(troopRecallStatus([ship, { ...ship, awaySeconds: 75 }])).toBe("Ship arriving in 1:15");
});
