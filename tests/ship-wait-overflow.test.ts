import { expect, it, vi } from "vitest";

import { createFleetBerthing } from "../src/shared/settlement/settlement-naval-berthing";
import type { NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import { createShipRoutePlanner } from "../src/shared/settlement/settlement-ship-routes";
import { createShipSea, createShipSeaWorld } from "./helpers/ship-motion-scenarios";

it("lets a loaded ship wait beyond a long channel while retaining queue priority and live obstacles", () => {
  const sea = createShipSeaWorld(160, 180, (x, z) => z < 95 && (x < 20 || x > 34));
  const harbour = sea.harbour(25);
  const ship: NavalShip = { id: 1, x: 60.5, y: 0, z: 120.5, yaw: 0, phase: "stranded",
    cargo: { logs: 1 }, cargoCount: 1, destinationUid: harbour.uid, route: [], cursor: 0, timer: 0 };
  const later: NavalShip = { ...ship, id: 2, x: 100.5, route: [], cargo: {} };
  const ships = [ship, later];
  const berthing = createFleetBerthing({ construction: () => [], context: sea.context,
    planner: createShipRoutePlanner(sea.world, sea.sea), sea: sea.sea, ships });
  expect(berthing.anchorage(harbour.uid, ship, [], true, false)).toBeNull();
  const overflow = berthing.anchorage(harbour.uid, ship, [], true, false, true);
  expect(overflow).not.toBeNull();
  expect(berthing.waitForBerth(ship, harbour.uid)).toBe(true);
  expect(ship.queuedAt).toEqual(overflow);
  expect(ship.phase).toBe("sailing");
  expect(ship.cargo).toEqual({ logs: 1 });
  expect(berthing.dock(harbour.uid, later)).toBeUndefined();
  expect(berthing.dock(harbour.uid, ship)).toBeDefined();
  const blocker: NavalShip = { ...later, id: 3, x: overflow!.x, z: overflow!.z,
    yaw: overflow!.yaw ?? 0, phase: "idle" };
  ships.push(blocker);
  ship.phase = "stranded"; ship.route = []; ship.queuedAt = undefined;
  expect(berthing.waitForBerth(ship, harbour.uid)).toBe(true);
  expect(ship.queuedAt).not.toEqual(overflow);
  expect(Math.hypot(ship.queuedAt!.x - blocker.x, ship.queuedAt!.z - blocker.z)).toBeGreaterThan(11);
  expect(ship.cargo).toEqual({ logs: 1 });
});

it("keeps a yielding loader without a previous waiting spot behind the existing queue leader", () => {
  const sea = createShipSea(), harbour = sea.harbour(30);
  const requester: NavalShip = { id: 1, x: 45.5, y: 0, z: 40.5, yaw: 0, phase: "sailing",
    cargo: { logs: 1 }, cargoCount: 1, destinationUid: harbour.uid, route: [], cursor: 0, timer: 0 };
  const loader: NavalShip = { ...requester, id: 2, z: 60.5, phase: "stranded", retryPhase: "positioning",
    sourceUid: harbour.uid, route: [], cargo: { planks: 1 } };
  const leader: NavalShip = { ...requester, id: 3, x: 70.5, z: 90.5, phase: "stranded",
    queuedAt: { x: 70.5, z: 90.5 }, route: [], cargo: {} };
  const ships = [requester, loader, leader];
  const berthing = createFleetBerthing({ construction: () => [], context: sea.context,
    planner: createShipRoutePlanner(sea.world, sea.sea), sea: sea.sea, ships });
  expect(berthing.queuedNear(harbour.uid)).toBe(leader);
  berthing.makeWay(requester, { x: 45.5, z: 90.5 });
  expect(loader.phase).toBe("positioning");
  expect(loader.waitsAtEdge).toBe(true);
  expect(berthing.queuedNear(harbour.uid)).toBe(leader);
  expect(loader.cargo).toEqual({ planks: 1 });
});

it("does not retarget a requesting loader through its neighbour's nested yield", () => {
  const sea = createShipSea(), harbour = sea.harbour(30);
  const requester: NavalShip = { id: 1, x: 45.5, y: 0, z: 40.5, yaw: 0, phase: "stranded",
    retryPhase: "positioning", sourceUid: harbour.uid, destinationUid: harbour.uid,
    cargo: { planks: 1 }, cargoCount: 1, queuedAt: { x: 45.5, z: 90.5 }, route: [], cursor: 0, timer: 0 };
  const neighbour: NavalShip = { ...requester, id: 2, z: 60.5, queuedAt: { x: 45.5, z: 60.5 },
    waitsAtEdge: true, route: [] };
  const originalPoint = requester.queuedAt!, originalRoute = requester.route;
  let nestedPassages = 0;
  const planner = createShipRoutePlanner(sea.world, sea.sea), ordinary = planner.route;
  vi.spyOn(planner, "route").mockImplementation((from, to, blocked = [], roomy = false) => {
    if (from !== neighbour) return ordinary(from, to, blocked, roomy);
    // Its escape stays blocked while the requester remains: the nested request points back at it.
    if (!blocked.length) nestedPassages++;
    return blocked.length ? null : [{ x: requester.x, z: requester.z }, { x: to.x, z: to.z }];
  });
  const berthing = createFleetBerthing({ construction: () => [], context: sea.context,
    planner, sea: sea.sea, ships: [requester, neighbour] });
  berthing.makeWay(requester, requester.queuedAt);
  expect(nestedPassages).toBeGreaterThan(0);
  expect(requester.phase).toBe("stranded");
  expect(requester.retryPhase).toBe("positioning");
  expect(requester.queuedAt).toBe(originalPoint);
  expect(requester.route).toBe(originalRoute);
  expect(requester.cargo).toEqual({ planks: 1 });
});
