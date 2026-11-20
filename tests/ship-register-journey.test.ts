import { expect, it } from "vitest";

import { shipJourneyLabel } from "../src/app/settlement-ui/ship-journey-label";
import type { NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import { shipRegisterJourney } from "../src/shared/settlement/ship-register-journey";

const vessel = (values: Partial<NavalShip> = {}) => ({
  x: 0, z: 0, yaw: 0, phase: "sailing", timer: 0, cursor: 0,
  route: [{ x: 0, z: 10 }], sourceUid: 3, destinationUid: 8, ...values
} as NavalShip);

it("distinguishes the outbound leg from the remaining round trip", () => {
  const ship = vessel({ phase: "away", timer: 250, route: [],
    colony: { expeditionId: 12, voyageSeconds: 150, exit: { x: 0, z: 0 }, boxes: 1 } });
  expect(shipRegisterJourney(ship)).toMatchObject({ origin: "Harbour 3", destination: "Expedition 12",
    leg: "Outbound voyage", legSeconds: 67 });
  ship.timer = 120; ship.colony!.arrived = true;
  expect(shipRegisterJourney(ship)).toMatchObject({ origin: "Expedition 12", destination: "Harbour 3",
    leg: "Return voyage", legSeconds: 80 });
});

it("shows the current island visitor's direction and changes it after unloading", () => {
  const ship = vessel({ visitor: { sourceColony: 7, exit: { x: 0, z: 0 }, pickup: [] } });
  expect(shipRegisterJourney(ship)).toMatchObject({ origin: "Expedition 7", destination: "Harbour 8",
    legSeconds: 7 });
  ship.visitor!.leaving = true;
  expect(shipRegisterJourney(ship)).toMatchObject({ origin: "Harbour 8", destination: "Expedition 7" });
});

it("does not invent arrival timers for idle, blocked, loading or queued ships", () => {
  for (const phase of ["idle", "stranded", "loading", "unloading"] as const)
    expect(shipRegisterJourney(vessel({ phase })).legSeconds).toBeUndefined();
  expect(shipRegisterJourney(vessel({ phase: "away", timer: 0, route: [] })))
    .toMatchObject({ leg: "Waiting for entry", legSeconds: undefined });
  const ship = vessel({ queuedAt: { x: 1, z: 1 } });
  expect(shipRegisterJourney(ship)).toMatchObject({ leg: "Waiting for harbour", legSeconds: undefined });
  // Lying at the waiting spot (the pier queue): still waiting, not blocked; a terrain block is.
  expect(shipRegisterJourney(vessel({ phase: "stranded", queuedAt: { x: 1, z: 1 } })).leg).toBe("Waiting for harbour");
  expect(shipRegisterJourney(vessel({ phase: "stranded", queuedAt: { x: 1, z: 1 }, terrainBlocked: true })).leg)
    .toBe("Route blocked");
  expect(shipJourneyLabel({ id: "1", name: "Ship", status: "idle", ...shipRegisterJourney(ship) }))
    .not.toContain("≈");
});
