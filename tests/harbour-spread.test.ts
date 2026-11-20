import { describe, expect, it } from "vitest";

import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { createShipSea, SHIP_TICK } from "./helpers/ship-motion-scenarios";

/** Two finished harbours on one coast; the first is the home harbour. */
const twoHarbours = () => {
  const sea = createShipSea(), home = sea.harbour(30), second = sea.harbour(90);
  const fleet = createNavalFleet(sea.context, sea.sea);
  return { fleet, home, second, sea };
};
const run = (fleet: ReturnType<typeof createNavalFleet>, until: () => boolean, seconds = 600) => {
  for (let tick = 0; tick < seconds / SHIP_TICK && !until(); tick++) fleet.update(SHIP_TICK);
};

// Owner 2026-10-15: a second harbour relieves a busy one.
describe("ships spread over the player's harbours", () => {
  it("sends a visitor to the home harbour while it is quiet, to the other one while it is busy", () => {
    const { fleet, home, second } = twoHarbours();
    expect(fleet.bestHarbour([], home.uid)).toBe(home.uid);
    const first = fleet.sendVisitor(fleet.bestHarbour([], home.uid)!, { fish: 5 });
    expect(first).not.toBeNull();
    // The first visitor is on its way to the home harbour: the next one calls at the second.
    const next = fleet.bestHarbour([], home.uid)!;
    expect(next).toBe(second.uid);
    expect(fleet.sendVisitor(next, { fish: 5 })).not.toBeNull();
    run(fleet, () => (home.inventory.fish ?? 0) >= 5 && (second.inventory.fish ?? 0) >= 5);
    expect(home.inventory.fish).toBe(5);
    expect(second.inventory.fish).toBe(5);
  }, 60000);

  it("takes a load waiting at the home harbour into account, and sends a pickup where the wares are", () => {
    const { fleet, home, second } = twoHarbours();
    home.inventory = { planks: 10 };
    fleet.addShip({ x: 40.5, z: 30.5 }, 0);
    expect(fleet.queueTransport(home.uid, second.uid, { planks: 10 })).not.toBeNull();
    run(fleet, () => fleet.frames()[0]?.phase === "loading");
    expect(fleet.bestHarbour([], home.uid)).toBe(second.uid);
    second.inventory = { ...second.inventory, stone: 8 };
    expect(fleet.bestHarbour(["stone"], home.uid)).toBe(second.uid);
    home.inventory = { ...home.inventory, coal: 4 };
    expect(fleet.bestHarbour(["coal"], home.uid)).toBe(home.uid);
  }, 60000);
});
