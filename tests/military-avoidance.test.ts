import { describe, expect, it } from "vitest";

import {
type AvoidanceAgent, type AvoidanceNeighbour,
  createVelocityRanker, timeToCollision} from "../src/shared/settlement/military-avoidance";

/** Anticipatory avoidance (docs/archive/dated/military-motion-2026-10-13.md): pure velocity ranking. */
const agent = (overrides: Partial<AvoidanceAgent> = {}): AvoidanceAgent => ({
  horizon: 1.2, maxSpeed: 1.4, preferredX: 1.4, preferredZ: 0, vx: 1.4, vz: 0, waitCost: 0, x: 0, z: 0, ...overrides
});
const neighbour = (overrides: Partial<AvoidanceNeighbour> = {}): AvoidanceNeighbour => ({
  comfort: .14, reciprocal: false, separation: .38, vx: 0, vz: 0, x: 1, z: 0, ...overrides
});
const best = (self: AvoidanceAgent, others: AvoidanceNeighbour[]) => {
  const ranker = createVelocityRanker();
  const ranked = ranker.rank(self, others, others.length);
  return { ranked, x: ranker.x(0), z: ranker.z(0) };
};

describe("military avoidance", () => {
  it("predicts the time until two bodies touch", () => {
    expect(timeToCollision(2, 0, 1, 0, .5)).toBeCloseTo(1.5);
    expect(timeToCollision(2, 0, -1, 0, .5)).toBe(Infinity);
    expect(timeToCollision(2, 1, 1, 0, .5)).toBe(Infinity);
    // Already pressed together: closing in is soon (not a veto), moving apart is free.
    expect(timeToCollision(.3, 0, 1, 0, .5)).toBeCloseTo(.3);
    expect(timeToCollision(.3, 0, -1, 0, .5)).toBe(Infinity);
  });

  it("keeps the preferred velocity when nothing is on a collision course", () => {
    const result = best(agent(), [neighbour({ x: 0, z: 3 })]);
    expect(result.ranked).toBe(1);
    expect(result).toMatchObject({ x: 1.4, z: 0 });
  });

  it("curves round a soldier standing ahead well before contact", () => {
    // 1.4 tiles ahead: contact in under a second at walking pace.
    const result = best(agent(), [neighbour({ x: 1.4 })]);
    expect(Math.abs(result.z)).toBeGreaterThan(.2);
    expect(result.x).toBeGreaterThan(.5);
  });

  it("passes oncoming soldiers on the same side (both keep right)", () => {
    const east = best(agent({ x: 0 }), [neighbour({ reciprocal: true, vx: -1.4, x: 2 })]);
    const west = best(agent({ preferredX: -1.4, vx: -1.4, x: 2 }),
      [neighbour({ reciprocal: true, vx: 1.4, x: 0 })]);
    // Each turns to its own right: opposite z for opposite headings, so they pass instead of mirroring.
    expect(Math.sign(east.z)).toBe(-Math.sign(west.z));
    expect(east.z).not.toBe(0);
  });

  it("gives way to a soldier crossing from the right and keeps going before one from the left", () => {
    // Walking east (+x), left is +z. Crossers walk across the agent's way and meet it in about a second.
    const fromRight = best(agent(), [neighbour({ reciprocal: true, vz: 1.4, x: 1.3, z: -1.3 })]);
    const fromLeft = best(agent(), [neighbour({ reciprocal: true, vz: -1.4, x: 1.3, z: 1.3 })]);
    expect(fromLeft).toMatchObject({ x: 1.4, z: 0 });
    expect(fromRight.x).toBeLessThan(1.4);
  });

  it("prefers moving on to waiting, more so the longer it waited", () => {
    const blocked = [neighbour({ x: .5 }), neighbour({ x: .4, z: .3 }), neighbour({ x: .4, z: -.3 })];
    const patient = best(agent({ waitCost: 0 }), blocked);
    const impatient = best(agent({ waitCost: 12 }), blocked);
    expect(Math.hypot(impatient.x, impatient.z)).toBeGreaterThan(0);
    expect(Math.hypot(patient.x, patient.z)).toBeLessThanOrEqual(Math.hypot(impatient.x, impatient.z));
  });
});
