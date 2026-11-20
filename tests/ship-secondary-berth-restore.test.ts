import { expect, it } from "vitest";

import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { createShipSea } from "./helpers/ship-motion-scenarios";

it("retains an admitted secondary berth on cold restore before checking a later queue leader", () => {
  const sea = createShipSea(), source = sea.harbour(20, 15, 0, 2), destination = sea.harbour(90);
  const fleet = createNavalFleet(sea.context, sea.sea), berths = fleet.harbourBerths(source.uid);
  expect(berths).toHaveLength(2);
  fleet.addShip({ x: 50.5, z: 55.5 }, 0);
  fleet.addShip({ x: 75.5, z: 90.5 }, 0);
  const state = structuredClone(fleet.saveState()), second = berths[1]!;
  Object.assign(state.ships[0]!, { phase: "positioning", sourceUid: source.uid, destinationUid: destination.uid,
    cargo: { planks: 1 }, cargoCount: 1, route: [{ ...second }], cursor: 0 });
  Object.assign(state.ships[1]!, { phase: "stranded", retryPhase: "positioning", sourceUid: source.uid,
    destinationUid: destination.uid, queuedAt: { x: 75.5, z: 90.5 }, timer: 1 });
  fleet.restore(state);
  const admitted = fleet.saveState().ships[0]!;
  expect(admitted.phase).toBe("positioning");
  expect(admitted.retryPhase).toBeUndefined();
  expect(Math.hypot(admitted.route.at(-1)!.x - second.x, admitted.route.at(-1)!.z - second.z)).toBeLessThan(1);
  expect(admitted.cargo).toEqual({ planks: 1 });
  expect(admitted.sourceUid).toBe(source.uid);
});
