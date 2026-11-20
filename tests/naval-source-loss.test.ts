import { describe, expect, it } from "vitest";

import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { registerStorageAccess } from "../src/shared/settlement/shared-storage";
import { createShipSea } from "./helpers/ship-motion-scenarios";

const fixture = () => {
  const sea = createShipSea(), source = sea.harbour(20), destination = sea.harbour(68);
  source.inventory = { planks: 4 };
  registerStorageAccess(sea.context, source); registerStorageAccess(sea.context, destination);
  const fleet = createNavalFleet(sea.context, sea.sea);
  fleet.addShip({ x: 50, z: 90 });
  expect(fleet.queueTransport(source.uid, destination.uid, { planks: 4 })).not.toBeNull();
  return { destination, fleet, sea, source };
};

describe("assigned ship cargo when its source is forcibly removed", () => {
  it("refunds paid ashore reserves into the original pool and clears the unpicked manifest once", () => {
    const { destination, fleet, sea, source } = fixture();
    fleet.update(.05);
    expect(fleet.saveState().orders).toHaveLength(0);
    expect(fleet.saveState().ships[0]!.phase).toBe("positioning");
    expect(source.shipReserve).toEqual({ planks: 4 });
    fleet.releaseHarbourReserves(source.uid);
    expect(source.inventory.planks).toBe(4);
    expect(source.shipReserve).toBeUndefined();
    expect(fleet.saveState().ships[0]).toMatchObject({ cargo: {}, cargoCount: 0, phase: "idle" });
    sea.context.buildings.splice(sea.context.buildings.indexOf(source), 1);
    fleet.releaseHarbourReserves(source.uid);
    expect(sea.context.storagePools!.pools[0]!.available.planks).toBe(4);
    expect(destination.inventory.planks).toBe(4); // One shared balance, not a second refund.
  });

  it("keeps actually picked-up cargo aboard instead of refunding it on source loss", () => {
    const { fleet, sea, source } = fixture();
    for (let tick = 0; tick < 6000 && fleet.saveState().ships[0]!.phase !== "sailing"; tick++) fleet.update(.05);
    const ship = fleet.saveState().ships[0]!;
    expect(ship).toMatchObject({ cargo: { planks: 4 }, phase: "sailing" });
    expect(source.shipReserve).toBeUndefined();
    fleet.releaseHarbourReserves(source.uid);
    sea.context.buildings.splice(sea.context.buildings.indexOf(source), 1);
    expect(ship.cargo).toEqual({ planks: 4 });
    expect(sea.context.storagePools!.pools[0]!.available.planks ?? 0).toBe(0);
  });
});
