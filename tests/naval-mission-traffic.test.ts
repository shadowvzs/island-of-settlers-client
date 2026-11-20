import { afterEach, describe, expect, it, vi } from "vitest";

import { createNavalFleet, type NavalPassengerHooks } from "../src/shared/settlement/settlement-naval-fleet";
import * as routes from "../src/shared/settlement/settlement-ship-routes";
import { createShipSea } from "./helpers/ship-motion-scenarios";

afterEach(() => vi.restoreAllMocks());

describe("paid missions behind temporary fleet traffic", () => {
  const cases = (["expedition", "exploration"] as const).flatMap(kind =>
    [false, true].map(escape => ({ escape, kind })));
  it.each(cases)("retains $kind cargo and crew across reload; backed escape $escape", ({ escape, kind }) => {
    const sea = createShipSea(), source = sea.harbour(20);
    const realPlanner = routes.createShipRoutePlanner;
    let blocked = true;
    let escapeAvailable = false;
    vi.spyOn(routes, "createShipRoutePlanner").mockImplementation((...args) => {
      const planner = realPlanner(...args), route = planner.route;
      planner.route = (...args) => {
        if (blocked && args[1].x === 65 && args[1].z === 75 && args[2]?.some(ship => ship.id === 2) &&
          !(escapeAvailable && args[3])) return null;
        return route(...args);
      };
      return planner;
    });
    const found = vi.fn(() => ({ uid: 999, remaining: [], shore: { x: 65, z: 75 } }));
    const hooks: NavalPassengerHooks = { embark: () => {}, found, loadPassengers: () => true,
      ready: () => true, release: () => {} };
    const fleet = createNavalFleet(sea.context, sea.sea, hooks);
    const berth = fleet.harbourBerths(source.uid)[0]!;
    fleet.addShip(berth, berth.yaw);
    fleet.addShip({ x: 80, z: 105 });
    const ship = fleet.saveState().ships[0]!;
    const cargo = { hammer: 1, planks: 4, shovel: 1, stone: 6 };
    Object.assign(ship, { cargo: { ...cargo }, cargoCount: 15, destinationUid: source.uid,
      passengers: [10, 11, 12], phase: "loading", sourceUid: source.uid, timer: 0 });
    if (kind === "expedition") ship.expedition = { rotation: 0, water: { x: 65, z: 75 }, x: 12, z: 75 };
    else ship.exploration = { cursor: 0, points: [{ x: 65, z: 75 }], returning: false };
    fleet.update(.05);
    expect(ship.phase).toBe("stranded");
    expect(ship.cancelled).not.toBe(true);
    expect(ship.cargo).toEqual(cargo);
    expect(ship.passengers).toEqual([10, 11, 12]);
    if (kind === "expedition") expect(ship.expedition?.water).toEqual({ x: 65, z: 75 });
    else expect(ship.exploration?.returning).toBe(false);
    for (let tick = 0; tick < 40; tick++) fleet.update(.05);
    const saved = structuredClone(fleet.saveState());
    fleet.restore(saved);
    // Either the lane clears, or only the safe backed manoeuvre opens. A stranded ship must
    // reach that same recovery available to the sailing helm without losing its paid mission.
    blocked = escape;
    escapeAvailable = escape;
    for (let tick = 0; tick < 1000 && fleet.saveState().ships[0]!.phase === "stranded"; tick++) fleet.update(.05);
    const resumed = fleet.saveState().ships[0]!;
    expect(resumed.phase).toBe("sailing");
    expect(resumed.cancelled).not.toBe(true);
    expect(resumed.cargo).toEqual(cargo);
    expect(resumed.passengers).toEqual([10, 11, 12]);
    if (kind === "expedition") expect(resumed.expedition).toEqual(ship.expedition);
    else expect(resumed.exploration?.returning).toBe(false);
    expect(found).not.toHaveBeenCalled();
  });
});
