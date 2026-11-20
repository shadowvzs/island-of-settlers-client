import { afterEach, describe, expect, it, vi } from "vitest";

import { SAILING_SHIP_HULL_BEAM, SAILING_SHIP_HULL_LENGTH } from "../src/render-common/ships/ship-dimensions";
import { createNavalFleet, type NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import { createShipHelm } from "../src/shared/settlement/settlement-naval-helm";
import * as avoidance from "../src/shared/settlement/settlement-ship-avoidance";
import { brakeKeepsHullsApart, shipHullFitsSea } from "../src/shared/settlement/settlement-ship-clearance";
import * as routes from "../src/shared/settlement/settlement-ship-routes";
import { createShipSea } from "./helpers/ship-motion-scenarios";

afterEach(() => vi.restoreAllMocks());

const stopAnticipation = () => vi.spyOn(avoidance, "avoidTraffic")
  .mockImplementation((_ship, order) => ({ ...order, speed: 0 }));
const unsafeReplan = (goal: { x: number; z: number }) => {
  const real = routes.createShipRoutePlanner;
  vi.spyOn(routes, "createShipRoutePlanner").mockImplementation((...args) => {
    const planner = real(...args);
    planner.route = () => [{ ...goal }];
    return planner;
  });
};

describe("bounded ship jam recovery", () => {
  it("retries the canonical berth approaches instead of locking the last point's chosen heading", () => {
    const { context, sea, world } = createShipSea(), planner = routes.createShipRoutePlanner(world, sea);
    const ordinary = planner.route, goal = { x: 70.5, z: 60.5, yaw: Math.PI / 2, eitherWay: true };
    const queries: routes.ShipDestination[] = [];
    vi.spyOn(planner, "route").mockImplementation((from, to, blocked, roomy) => {
      queries.push({ ...to });
      return to.eitherWay ? ordinary(from, to, blocked, roomy) : null;
    });
    stopAnticipation();
    const ship: NavalShip = { id: 1, x: 30.5, y: 0, z: 60.5, yaw: Math.PI / 2, phase: "positioning",
      cargo: { planks: 1 }, cargoCount: 1, route: [{ x: 50.5, z: 60.5 },
        { x: goal.x, z: goal.z, yaw: goal.yaw }], cursor: 0, timer: 2 };
    const helm = createShipHelm({ context, planner, sea, obstacles: () => [], makeWay: () => {},
      routeEndpoint: () => goal, arriveAtRouteEnd: arrived => { arrived.phase = "idle"; } });
    for (let tick = 0; tick < 2000 && ship.phase !== "idle"; tick++) {
      helm.refreshTraffic([ship]); helm.sailTick(ship, .05);
      expect(shipHullFitsSea(world, sea, ship)).toBe(true);
    }
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every(query => query.eitherWay && query.x === goal.x && query.z === goal.z)).toBe(true);
    expect(ship.x).toBeGreaterThan(60);
    expect(ship.cargo).toEqual({ planks: 1 });
  });

  it("escapes anticipatory deadlock along a real safe route while retaining its cargo", () => {
    const { context, sea, world } = createShipSea();
    stopAnticipation();
    const fleet = createNavalFleet(context, sea);
    fleet.addShip({ x: 30.5, z: 60.5 }, Math.PI / 2);
    fleet.addShip({ x: 50.5, z: 60.5 }, 0);
    const [ship, other] = fleet.saveState().ships;
    const path = routes.createShipRoutePlanner(world, sea).route(ship!, { x: 70.5, z: 60.5 }, [other!]);
    expect(path).not.toBeNull();
    Object.assign(ship!, { cargo: { planks: 4 }, cargoCount: 4, phase: "sailing", route: path, timer: 2 });
    for (let tick = 0; tick < 100; tick++) fleet.update(.05);
    expect(Math.hypot(ship!.x - 30.5, ship!.z - 60.5)).toBeLessThan(.001);
    for (let tick = 0; tick < 4000 && ship!.x < 60; tick++) {
      const previous = { x: ship!.x, yaw: ship!.yaw, z: ship!.z };
      fleet.update(.05);
      expect(shipHullFitsSea(world, sea, ship!)).toBe(true);
      expect(brakeKeepsHullsApart(previous, ship!, other!)).toBe(true);
    }
    expect(ship!.x).toBeGreaterThan(60);
    expect(ship!.cargo).toEqual({ planks: 4 });
    expect(ship!.visitor).toBeUndefined();
  });

  it("retains the exact hull guard even when a faulty replanner promises a path through another ship", () => {
    const { context, sea } = createShipSea(), goal = { x: 70.5, z: 60.5 };
    stopAnticipation(); unsafeReplan(goal);
    const fleet = createNavalFleet(context, sea);
    fleet.addShip({ x: 30.5, z: 60.5 }, Math.PI / 2);
    fleet.addShip({ x: 50.5, z: 60.5 }, 0);
    const [ship, other] = fleet.saveState().ships;
    Object.assign(ship!, { cargo: { planks: 4 }, cargoCount: 4, phase: "sailing", route: [goal], timer: 2 });
    for (let tick = 0; tick < 2000; tick++) {
      fleet.update(.05);
      expect(ship!.x + SAILING_SHIP_HULL_LENGTH / 2)
        .toBeLessThanOrEqual(other!.x - SAILING_SHIP_HULL_BEAM / 2 + 1e-8);
    }
    expect(ship!.x).toBeGreaterThan(33);
    expect(ship!.cargo).toEqual({ planks: 4 });
  });

  it("retains the exact shoreline guard during the same recovery", () => {
    const { context, sea, world } = createShipSea(), goal = { x: 10.5, z: 60.5 };
    stopAnticipation(); unsafeReplan(goal);
    const fleet = createNavalFleet(context, sea);
    fleet.addShip({ x: 30.5, z: 60.5 }, -Math.PI / 2);
    const ship = fleet.saveState().ships[0]!;
    Object.assign(ship, { cargo: { planks: 4 }, cargoCount: 4, phase: "sailing", route: [goal], timer: 2 });
    for (let tick = 0; tick < 2000; tick++) {
      fleet.update(.05);
      expect(shipHullFitsSea(world, sea, ship)).toBe(true);
    }
    expect(ship.x).toBeLessThan(28);
    expect(ship.cargo).toEqual({ planks: 4 });
  });
});
