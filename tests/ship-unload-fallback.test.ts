import { afterEach, expect, it, vi } from "vitest";

import * as berthing from "../src/shared/settlement/settlement-naval-berthing";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { createShipSea } from "./helpers/ship-motion-scenarios";

afterEach(() => vi.restoreAllMocks());

it("commits an alternative berth without retaining the old source waiting point", () => {
  const original = berthing.createFleetBerthing;
  vi.spyOn(berthing, "createFleetBerthing").mockImplementation(options => {
    const result = original(options);
    // The preferred entrance is unavailable; the ship-specific fallback still has a valid berth.
    return { ...result, dock: (uid, ship) => ship ? result.dock(uid, ship) : undefined };
  });
  const sea = createShipSea(), source = sea.harbour(20), destination = sea.harbour(90);
  const fleet = createNavalFleet(sea.context, sea.sea);
  fleet.addShip({ x: 45.5, z: 60.5 }, 0);
  const state = structuredClone(fleet.saveState());
  Object.assign(state.ships[0]!, { phase: "stranded", sourceUid: source.uid, destinationUid: destination.uid,
    cargo: { logs: 1 }, cargoCount: 1, timer: 0, queuedAt: { x: 80.5, z: 30.5 } });
  fleet.restore(state);
  fleet.update(.05);
  expect(fleet.saveState().ships[0]!.phase).toBe("sailing");
  expect(fleet.saveState().ships[0]!.queuedAt).toBeUndefined();
  for (let tick = 0; tick < 10_000 && destination.inventory.logs !== 1; tick++) fleet.update(.05);
  expect(destination.inventory.logs).toBe(1);
  expect(fleet.saveState().ships.map(ship => ship.id)).toEqual([state.ships[0]!.id]);
});
