import { describe, expect, it } from "vitest";

import { createNavalFleet, type NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import { ANCHORAGE_SPACING } from "../src/shared/settlement/settlement-ship-anchorage";
import { createShipSea, SHIP_TICK } from "./helpers/ship-motion-scenarios";

/** Harbour queue rules (owner, 2026-10-20): only the first ship in a harbour's queue waits off it. */
type Fleet = ReturnType<typeof createNavalFleet>;

/** The harbour a waiting ship queues for: where it loads while positioning, else where it unloads. */
const queuedFor = (ship: NavalShip) =>
  ship.phase === "positioning" || ship.retryPhase === "positioning" ? ship.sourceUid : ship.destinationUid;
/** Ships waiting off harbour `uid` (not at the map edge, not beyond it). */
const waitingOff = (fleet: Fleet, uid: number) => fleet.saveState().ships.filter(ship =>
  ship.queuedAt !== undefined && !ship.waitsAtEdge && ship.phase !== "away" && queuedFor(ship) === uid).length;
const twoHarbours = () => {
  // Level 3 harbours: two berths each where the shore allows (owner, 2026-10-21).
  const sea = createShipSea(), source = sea.harbour(20, 15, 0, 2), destination = sea.harbour(90, 15, 0, 2);
  return { destination, fleet: createNavalFleet(sea.context, sea.sea), source };
};

describe("harbour queue", () => {
  it("lets one visitor wait off a busy harbour while the others wait beyond the map edge", () => {
    const { destination, fleet } = twoHarbours();
    for (let visitor = 0; visitor < 4; visitor++)
      expect(fleet.sendVisitor(destination.uid, { stone: 2000 }, [], "reward")).not.toBeNull();
    let mostWaitingOff = 0, mostBeyondEdge = 0;
    for (let tick = 0; tick < 2400 / SHIP_TICK && fleet.frames().length; tick++) {
      fleet.update(SHIP_TICK);
      mostWaitingOff = Math.max(mostWaitingOff, waitingOff(fleet, destination.uid));
      mostBeyondEdge = Math.max(mostBeyondEdge, fleet.saveState().ships.filter(ship => ship.phase === "away").length);
    }
    expect(fleet.frames()).toEqual([]);
    expect(destination.inventory.stone).toBe(8000);
    expect(mostWaitingOff).toBe(1);
    expect(mostBeyondEdge).toBeGreaterThanOrEqual(2);
  }, 60000);

  it("sends an unloaded ship off the berth to a waiting spot instead of idling there", () => {
    const { destination, fleet, source } = twoHarbours();
    source.inventory = { stone: 5 };
    fleet.addShip({ x: 30.5, z: 30.5 }, 0);
    expect(fleet.queueTransport(source.uid, destination.uid, { stone: 5 })).not.toBeNull();
    const berth = fleet.harbourBerths(destination.uid)[0]!;
    for (let tick = 0; tick < 900 / SHIP_TICK && destination.inventory.stone !== 5; tick++) fleet.update(SHIP_TICK);
    expect(destination.inventory.stone).toBe(5);
    for (let tick = 0; tick < 300 / SHIP_TICK && fleet.saveState().ships[0]!.phase !== "idle"; tick++)
      fleet.update(SHIP_TICK);
    const ship = fleet.saveState().ships[0]!;
    expect(ship.phase).toBe("idle");
    expect(Math.hypot(ship.x - berth.x, ship.z - berth.z)).toBeGreaterThanOrEqual(ANCHORAGE_SPACING);
  }, 60000);

  it("keeps own ships behind the first in the queue at the map edge; each comes in when it is its turn", () => {
    const { destination, fleet, source } = twoHarbours();
    // Two long unloading visitors hold the destination's berths while five own loads arrive there.
    for (let visitor = 0; visitor < 2; visitor++)
      expect(fleet.sendVisitor(destination.uid, { stone: 2000 }, [], "reward")).not.toBeNull();
    // Ten boxes a load (a boat is a box of its own, owner box sizes 2026-10-21); no rowers for the boats
    // stored at the destination, so no lighters: this is the berths' queue.
    source.inventory = { boat: 50 };
    destination.idleSettlers = 0;
    for (const z of [10.5, 30.5, 45.5, 60.5, 75.5]) fleet.addShip({ x: 40.5, z }, 0);
    for (let load = 0; load < 5; load++)
      expect(fleet.queueTransport(source.uid, destination.uid, { boat: 10 })).not.toBeNull();
    let mostWaitingOff = 0, atEdge = false;
    const done = () => destination.inventory.stone === 4000 && destination.inventory.boat === 50;
    for (let tick = 0; tick < 2400 / SHIP_TICK && !done(); tick++) {
      fleet.update(SHIP_TICK);
      mostWaitingOff = Math.max(mostWaitingOff, waitingOff(fleet, destination.uid), waitingOff(fleet, source.uid));
      atEdge ||= fleet.saveState().ships.some(ship => ship.waitsAtEdge);
    }
    expect(destination.inventory).toMatchObject({ boat: 50, stone: 4000 });
    expect(mostWaitingOff).toBe(1);
    expect(atEdge).toBe(true);
  }, 60000);
});
