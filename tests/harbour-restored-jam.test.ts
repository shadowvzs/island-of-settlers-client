import { describe, expect, it } from "vitest";

import { createNavalFleet, type NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import { createShipSea, measureShipScenario } from "./helpers/ship-motion-scenarios";

/**
 * The owner's 2026-10-13 "(1)" save in miniature: two loaded-to-be ships held up in front of the
 * harbour's only berth (restored as waiting to position), a third idle ship lying beside the berth
 * and one more load queued. Before the fix the idle ship took the berth and the two in front of it
 * waited for good, blocking its way out.
 */
const restoredJam = () => {
  const sea = createShipSea(), source = sea.harbour(60), destination = sea.harbour(100);
  const fleet = createNavalFleet(sea.context, sea.sea);
  // The three loads' planks lie reserved in the harbour's storage until carried aboard.
  source.shipReserve = { planks: 30 };
  const [berth] = fleet.harbourBerths(source.uid);
  expect(berth).toBeDefined();
  const ship = (id: number, x: number, z: number, yaw: number, waiting: boolean): NavalShip => ({
    cargo: waiting ? { planks: 10 } : {}, cargoCount: waiting ? 10 : 0, cursor: 0, id,
    phase: waiting ? "stranded" : "idle", route: [], timer: 1, x, y: sea.world.seaLevel, yaw, z,
    ...(waiting ? { destinationUid: destination.uid, orderId: id, retryPhase: "positioning" as const,
      sourceUid: source.uid } : {}) });
  fleet.restore({
    nextOrder: 4, nextShip: 4,
    orders: [{ cargo: { planks: 10 }, destinationUid: destination.uid, id: 3, sourceUid: source.uid }],
    ships: [ship(1, berth!.x + 9.5, berth!.z + 3, -2.15, true), ship(2, berth!.x + 16, berth!.z - 6.5, .8, true),
      ship(3, berth!.x + 7, berth!.z - 6, 0, false)]
  });
  return { destination, fleet, sea };
};

describe("a harbour jam restored from a save", () => {
  it("clears: every queued load reaches the other harbour, without a collision", () => {
    const { destination, fleet, sea } = restoredJam();
    const metrics = measureShipScenario({ done: () => (destination.inventory.planks ?? 0) >= 30, fleet,
      seconds: 1500, sea });
    expect(metrics.completed).toBe(true);
    expect(metrics.hullContactTicks).toBe(0);
    expect(metrics.shoreTicks).toBe(0);
  }, 60000);
});
