import { describe, expect, it } from "vitest";

import { SAILING_SHIP_HULL_LENGTH } from "../src/render-common/ships/ship-dimensions";
import {
  arcTo, brakingSpeed, changeSpeed, OAR_TURN_RATE, sailArc, SHIP_ACCELERATION, SHIP_DECELERATION, SHIP_SPEED,
  SHIP_TURN_RADIUS, shipTurnRate, swingAbout
} from "../src/shared/settlement/settlement-ship-kinematics";
import { straightenSeaRoute } from "../src/shared/settlement/settlement-ship-routes";
import {
  desiredShipHeading, executeSailOrder, manoeuvreShip, sailOrder, SHIP_TURN_RATE, shipSailFactor
} from "../src/shared/settlement/settlement-ship-steering";

const open = () => true;
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
/** Sideways share of a step: the angle between travel and the keel at mid step. */
const slip = (before: { x: number; yaw: number; z: number }, after: { x: number; yaw: number; z: number }) =>
  Math.abs(Math.sin(Math.atan2(after.x - before.x, after.z - before.z) - (before.yaw + after.yaw) / 2));

describe("ship kinematics", () => {
  it("sails along an exact arc: the hull never moves across its keel", () => {
    const start = { x: 3, yaw: .4, z: -2 };
    for (const [distance, turn] of [[1, .3], [-1, .3], [2, -.5], [1, 0]] as const)
      expect(slip(start, sailArc(start, distance, turn))).toBeLessThan(1e-9);
  });
  it("reaches a manoeuvre pose exactly along the arc tangent to the keel", () => {
    const start = { x: 0, yaw: 0, z: 0 }, end = sailArc(start, -1.5, .4);
    const arc = arcTo(start, end, true), reached = sailArc(start, arc.length, arc.turn);
    expect(reached.x).toBeCloseTo(end.x, 9); expect(reached.z).toBeCloseTo(end.z, 9);
    expect(wrap(reached.yaw - end.yaw)).toBeCloseTo(0, 9);
  });
  it("swings round a keel point that stays put (a spring line at the bow)", () => {
    const start = { x: 5, yaw: 1, z: 5 }, bow = SAILING_SHIP_HULL_LENGTH / 2, swung = swingAbout(start, bow, .4);
    expect(swung.x + Math.sin(swung.yaw) * bow).toBeCloseTo(start.x + Math.sin(start.yaw) * bow, 9);
    expect(swung.z + Math.cos(swung.yaw) * bow).toBeCloseTo(start.z + Math.cos(start.yaw) * bow, 9);
  });
  it("gathers and takes off way at bounded rates", () => {
    expect(changeSpeed(0, 1, .05)).toBeCloseTo(SHIP_ACCELERATION * .05);
    expect(changeSpeed(1, 0, .05)).toBeCloseTo(1 - SHIP_DECELERATION * .05);
    expect(changeSpeed(.2, -.4, .05)).toBeCloseTo(.2 - SHIP_DECELERATION * .05);
    expect(brakingSpeed(1)).toBeCloseTo(Math.sqrt(2 * SHIP_DECELERATION));
  });
  it("turns no tighter than its radius under sail, and only slowly on the oars", () => {
    expect(SHIP_SPEED / shipTurnRate(SHIP_SPEED)).toBeGreaterThanOrEqual(SHIP_TURN_RADIUS - 1e-9);
    expect(shipTurnRate(0)).toBe(OAR_TURN_RATE);
    expect(shipTurnRate(10)).toBeLessThanOrEqual(SHIP_TURN_RATE);
  });
});

describe("ship helm", () => {
  it("straightens a grid staircase into one diagonal leg through open water", () => {
    const staircase = Array.from({ length: 10 }, (_, index) => ({
      x: 10.5 + Math.ceil(index / 2), z: 10.5 + Math.floor(index / 2)
    }));
    expect(straightenSeaRoute({ x: 10.5, z: 10.5 }, staircase, open)).toEqual([staircase.at(-1)]);
  });
  it("keeps a corner where the straight line is not clear", () => {
    const route = [{ x: 10.5, z: 0.5 }, { x: 10.5, z: 10.5 }];
    expect(straightenSeaRoute({ x: 0.5, z: 0.5 }, route, (_, to) => to.z < 5)).toEqual(route);
  });
  it("slows to steerage way while the bow comes round, and turns at its rate limit along the keel", () => {
    const ship = { speed: 1, x: 0, yaw: 0, z: 0 }, route = [{ x: 0, z: -30 }];
    const order = sailOrder(ship, route, 0);
    expect(order.speed).toBeLessThan(.3);
    const moved = executeSailOrder(ship, order, .05);
    expect(Math.abs(moved.yaw)).toBeCloseTo(shipTurnRate(moved.speed) * .05);
    expect(slip(ship, moved)).toBeLessThan(1e-9);
  });
  it("sails at full speed on a straight course and brakes to stop on the route end", () => {
    const route = [{ x: 0, z: 40 }];
    expect(sailOrder({ speed: 1, x: 0, yaw: 0, z: 0 }, route, 0).speed).toBe(SHIP_SPEED);
    expect(sailOrder({ speed: 1, x: 0, yaw: 0, z: 39.5 }, route, 0).speed).toBeCloseTo(brakingSpeed(.5));
  });
  it("starts turning before a corner and slows for the bend", () => {
    const route = [{ x: 0, z: 10 }, { x: 10, z: 10 }];
    expect(desiredShipHeading({ speed: 0, x: 0, yaw: 0, z: 0 }, route, 0)).toBeCloseTo(0);
    expect(desiredShipHeading({ speed: 1, x: 0, yaw: 0, z: 8 }, route, 0)).toBeGreaterThan(.5);
    expect(shipSailFactor(0)).toBe(1);
    expect(shipSailFactor(.8)).toBeLessThan(1);
    expect(shipSailFactor(Math.PI / 2)).toBeGreaterThan(0);
  });
  it("backs astern along manoeuvre arcs, carrying its way from one leg into the next", () => {
    const start = { x: 0, yaw: 0, z: 0 };
    const first = { ...sailArc(start, -.02, -.01), astern: true }, second = { ...sailArc(first, -1, -.3), astern: true };
    const moved = manoeuvreShip({ ...start, speed: -.4 }, [first, second], 0, .1);
    expect(moved.advance).toBe(1);
    expect(moved.z).toBeLessThan(first.z);
    expect(slip(start, moved)).toBeLessThan(.02);
  });
  it("finishes a berth heading before leaving an in-place swing", () => {
    const route = [{ pivot: 0, x: 10, yaw: Math.PI / 2, z: 10 }];
    let ship = { speed: 0, x: 10, yaw: 0, z: 10 };
    const first = manoeuvreShip(ship, route, 0, .05);
    expect(first.advance).toBe(0);
    expect(first).toMatchObject({ x: 10, z: 10 });
    for (let tick = 0; tick < 1000; tick++) {
      const move = manoeuvreShip(ship, route, 0, .05);
      ship = { ...move };
      if (move.advance) break;
    }
    expect(ship.yaw).toBeCloseTo(Math.PI / 2);
  });
  it("swings on the oars slowly, easing in and out", () => {
    const route = [{ x: 0, yaw: 0, z: 0 }, { pivot: 0, x: 0, yaw: .4, z: 0 }];
    const first = manoeuvreShip({ speed: 0, x: 0, yaw: 0, z: 0 }, route, 1, .05);
    expect(first.yaw).toBeGreaterThan(0);
    expect(first.yaw).toBeLessThan(OAR_TURN_RATE * .05);
    const middle = manoeuvreShip({ speed: 0, x: 0, yaw: .2, z: 0 }, route, 1, .05);
    expect(middle.yaw - .2).toBeCloseTo(OAR_TURN_RATE * .05);
  });
});
