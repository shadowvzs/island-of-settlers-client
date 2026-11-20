import { expect, it } from "vitest";

import { createFleetBerthing } from "../src/shared/settlement/settlement-naval-berthing";
import { createNavalFleet, type NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import { createShipRoutePlanner } from "../src/shared/settlement/settlement-ship-routes";
import { createShipSea } from "./helpers/ship-motion-scenarios";

it("lets a saved idle hull sailing aside ask its harbour neighbours to yield", () => {
  const sea = createShipSea();
  sea.harbour(30);
  const moving: NavalShip = { id: 1, x: 45.5, y: 0, z: 40.5, yaw: 0, phase: "sailing", cargo: {}, cargoCount: 0,
    route: [], cursor: 0, timer: 0, anchorage: { x: 45.5, z: 80.5 } };
  const idle: NavalShip = { id: 2, x: 45.5, y: 0, z: 60.5, yaw: 0, phase: "idle", cargo: {}, cargoCount: 0,
    route: [], cursor: 0, timer: 0 };
  const ships = [moving, idle];
  const berthing = createFleetBerthing({ construction: () => [], context: sea.context,
    planner: createShipRoutePlanner(sea.world, sea.sea), sea: sea.sea, ships });
  // Neither cargo endpoint exists for an idle ship sent aside. Its persisted anchorage is enough.
  expect(moving.sourceUid).toBeUndefined();
  expect(moving.destinationUid).toBeUndefined();
  berthing.makeWay(moving, moving.anchorage);
  expect(idle.phase).toBe("sailing");
  expect(idle.anchorage).toBeDefined();
  expect(idle.route.length).toBeGreaterThan(0);
  expect(ships.map(ship => ship.id)).toEqual([1, 2]);
  expect(idle.cargo).toEqual({});
});

it("resumes the saved parking course after restore", () => {
  const sea = createShipSea();
  sea.harbour(30);
  const fleet = createNavalFleet(sea.context, sea.sea);
  fleet.addShip({ x: 45.5, z: 40.5 }, 0);
  fleet.addShip({ x: 45.5, z: 80.5 }, 0);
  const state = structuredClone(fleet.saveState()), ship = state.ships[0]!;
  const goal = { x: 45.5, z: 80.5 };
  Object.assign(ship, { phase: "sailing", anchorage: goal, route: [goal] });
  fleet.restore(state);
  // Restore keeps the saved endpoint and course; it does not force a transient stranded retry.
  expect(fleet.saveState().ships[0]!.phase).toBe("sailing");
  // The transient obstruction clears; the saved parking destination must be retried.
  fleet.saveState().ships[1]!.x = 70.5;
  for (let tick = 0; tick < 6000 && fleet.saveState().ships[0]!.phase !== "idle"; tick++) fleet.update(.05);
  const after = fleet.saveState().ships[0]!;
  expect(after.phase).toBe("idle");
  expect(Math.hypot(after.x - goal.x, after.z - goal.z)).toBeLessThan(3);
  expect(after.id).toBe(ship.id);
  expect(after.cargo).toEqual({});
  expect(after.destinationUid).toBeUndefined();
});
