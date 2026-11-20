import { expect, it } from "vitest";

import { observeShip } from "../src/app/observation-subjects";
import { selectedRoutePoints } from "../src/app/selected-route";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { createShipSea } from "./helpers/ship-motion-scenarios";

it("reads bounded upcoming waypoints without exposing or changing the live ship route", () => {
  const sea = createShipSea(), harbour = sea.harbour(30), fleet = createNavalFleet(sea.context, sea.sea);
  const id = fleet.sendVisitor(harbour.uid, { fish: 1 })!;
  const ship = fleet.saveState().ships.find(ship => ship.id === id)!;
  const before = structuredClone(ship.route), first = fleet.routeView(id)!;
  expect(first.points.length).toBeGreaterThan(0);
  first.points[0]!.x += 100;
  expect(ship.route).toEqual(before);
  expect(fleet.routeView(id)!.points[0]).not.toEqual(first.points[0]);
  const long = Array.from({ length: 100 }, (_, index) => ({ x: index, z: 30 }));
  ship.route = long; ship.cursor = 20;
  const route = fleet.routeView(id)!;
  expect(route.points).toHaveLength(64); expect(route.points[0]!.x).toBe(20);
  expect(route.truncated).toBe(true); expect(route.destination).toEqual({ x: 99, z: 30 });
  ship.route = [{ x: 5, z: 6 }]; ship.cursor = 0;
  expect(fleet.routeView(id)!.destination).toEqual({ x: 5, z: 6 });
  ship.phase = "away"; expect(fleet.routeView(id)).toBeNull();
  expect(fleet.routeView(-1)).toBeNull();
});

it("shows ship routes on the water surface and follows replanned waypoints", () => {
  const frame = { id: 1, x: 0, y: 4, z: 0, yaw: 0, phase: "sailing" as const, cargoCount: 0 };
  let points = [{ x: 1, z: 2 }, { x: 3, z: 4 }];
  const resolve = observeShip("1", "Merchant", () => [frame], () => ({ points, index: 0 }));
  const subject = resolve()!;
  expect(selectedRoutePoints(subject, () => -30).every(point => point.y === 4.15)).toBe(true);
  points = [{ x: 7, z: 8 }];
  expect(selectedRoutePoints(subject, () => -30).at(-1)).toEqual({ x: 7, y: 4.15, z: 8 });
});
