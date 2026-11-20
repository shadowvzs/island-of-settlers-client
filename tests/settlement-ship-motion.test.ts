import { describe, expect, it } from "vitest";

import {
  avoidTraffic, capsuleGap, giveWayWeight, type ShipTraffic
} from "../src/shared/settlement/settlement-ship-avoidance";
import { shipsOverlap } from "../src/shared/settlement/settlement-ship-clearance";
import { SHIP_TURN_RATE } from "../src/shared/settlement/settlement-ship-kinematics";
import {
  busyHarbourScenario, flushBerthScenario, fourVisitorsScenario, headlandScenario, headOnScenario,
  measureShipScenario
} from "./helpers/ship-motion-scenarios";

const vessel = (x: number, z: number, yaw: number, speed = 1): ShipTraffic =>
  ({ inbound: false, restricted: false, speed, x, yaw, z });
const afloat = () => true;

describe("anticipatory avoidance", () => {
  it("capsules contain the rig envelope with its clearance gap", () => {
    expect.hasAssertions();
    for (const yaw of [0, .4, Math.PI / 2]) for (const offset of [6, 8, 11.5]) {
      const a = { x: 0, yaw: 0, z: 0 }, b = { x: Math.sin(yaw) * offset, yaw, z: Math.cos(yaw) * offset };
      if (shipsOverlap(a, b)) expect(capsuleGap(a, b)).toBeLessThan(0);
    }
  });
  it("follows the rules of the road: head on both give way, the ship with the other to starboard gives way", () => {
    const north = vessel(0, 0, 0), south = vessel(0, 30, Math.PI);
    expect(giveWayWeight(north, south)).toBe(1); expect(giveWayWeight(south, north)).toBe(1);
    const crossing = vessel(15, 15, -Math.PI / 2);
    expect(giveWayWeight(north, crossing)).toBe(1);
    expect(giveWayWeight(crossing, north)).toBeLessThan(1);
    const docking = { ...vessel(0, 20, Math.PI), inbound: true };
    expect(giveWayWeight(docking, north)).toBe(1); expect(giveWayWeight(north, docking)).toBeLessThan(1);
  });
  it("alters to starboard early when meeting a ship head on", () => {
    const north = vessel(0, 0, 0), south = vessel(.5, 26, Math.PI);
    const order = avoidTraffic(north, { heading: 0, speed: 1, stop: 200 }, { afloat, traffic: [south] });
    expect(order.heading!).toBeGreaterThan(0);
  });
  it("holds its course as the stand-on ship; the give-way ship never crosses ahead to port", () => {
    const north = vessel(0, 0, 0), nominal = { heading: 0, speed: 1, stop: 200 };
    expect(avoidTraffic(north, nominal, { afloat, traffic: [vessel(-14, 12, Math.PI / 2)] })).toEqual(nominal);
    const order = avoidTraffic(north, nominal, { afloat, traffic: [vessel(14, 12, -Math.PI / 2)] });
    expect(order.heading! >= 0 || order.speed < nominal.speed).toBe(true);
  });
  it("keeps its course when nothing is in the way, and stops short of a ship lying across it", () => {
    const north = vessel(0, 0, 0), nominal = { heading: 0, speed: 1, stop: 200 };
    expect(avoidTraffic(north, nominal, { afloat, traffic: [vessel(30, 0, 0)] })).toBe(nominal);
    const moored = { ...vessel(0, 12, Math.PI / 2, 0), restricted: true };
    const order = avoidTraffic(north, nominal, { afloat: pose => Math.abs(pose.x) < 3, traffic: [moored] });
    expect(order.speed).toBeLessThan(1);
  });
  it("turns away from the shore it would otherwise run onto", () => {
    const ship = vessel(0, 0, 0), nominal = { heading: 0, speed: 1, stop: 200 };
    const order = avoidTraffic(ship, nominal, { afloat: pose => pose.z < 6 || pose.x > 2, traffic: [] });
    expect(order).not.toEqual(nominal);
  });
});

/** Every scenario: no hull ever touches another or the shore, and no hull slides sideways. */
const expectNaturalMotion = (metrics: ReturnType<typeof measureShipScenario>) => {
  expect(metrics.completed).toBe(true);
  expect(metrics.hullContactTicks).toBe(0);
  expect(metrics.shoreTicks).toBe(0);
  expect(metrics.maxSlipDeg).toBeLessThan(1);
  expect(metrics.maxTurnRate).toBeLessThanOrEqual(SHIP_TURN_RATE + 1e-9);
};

describe("ship motion scenarios", { timeout: 60_000 }, () => {
  it("passes a ship met head on without touching or coming close", () => {
    const metrics = measureShipScenario(headOnScenario());
    expectNaturalMotion(metrics);
    expect(metrics.envelopeTicks).toBe(0);
    // Each ship finds the other at the pier and waits off it: the give-way ship may wait briefly.
    expect(metrics.blockedSeconds).toBeLessThan(20);
    // Way changes stay gentle; the largest step is where a manoeuvre's last arc meets open water.
    expect(metrics.maxAcceleration).toBeLessThan(5);
  });
  it("resolves a harbour where four ships load in turn", () => {
    expectNaturalMotion(measureShipScenario(busyHarbourScenario()));
  });
  it("brings four visitors sent at once in one after another", () => {
    expectNaturalMotion(measureShipScenario(fourVisitorsScenario()));
  });
  it("sails round a headland on a smooth course and berths bow first at the pier", () => {
    const metrics = measureShipScenario(headlandScenario());
    expectNaturalMotion(metrics);
    // The voyages are short; lining up with the pier and coming in bow first add their own way.
    expect(metrics.pathRatio).toBeLessThan(2.2);
    expect(metrics.minTurnRadius).toBeGreaterThan(1);
  });
  it("gets a hull lying flush along the shore clear without sliding sideways", () => {
    expectNaturalMotion(measureShipScenario(flushBerthScenario()));
  });
});
