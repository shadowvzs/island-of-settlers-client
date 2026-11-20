import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { DonorRayConstraint } from "../tools/analysis/source-cloth-donor-ray-fit";
import { solveHardClothContacts } from "../tools/analysis/source-cloth-hard-contacts";
import { createHardClothState } from "../tools/analysis/source-cloth-hard-state";

const fixture = (cap: number) => {
  const basis = [new Vector3(1, 1, .5), new Vector3(-2, 1, .5), new Vector3(1, 1, .5), new Vector3(1, 1, .5)];
  const state = createHardClothState([1, 0, 0, 0], [1, 0, 0, 0], [{
    basis, caseIndex: 0, group: 0, maximumMotion: cap, original: basis[0]!.clone(), vertex: 137,
  }]);
  const fixed = (base: Vector3) => ({ base, delta: new Vector3(), group: -1 });
  const target: DonorRayConstraint = {
    corners: [{ base: basis[0]!, basis, delta: new Vector3(), group: 0 },
      fixed(new Vector3(1, -1, .5)), fixed(new Vector3(2, 0, .5))],
    direction: new Vector3(0, 0, 1), length: 1, origin: new Vector3(), target: true,
  };
  const preservation = { ...target, target: false, corners: [fixed(new Vector3(-1, -1, .3)),
    fixed(new Vector3(1, -1, .3)), fixed(new Vector3(0, 1, .3))] };
  return { state, constraints: [preservation, target] };
};

describe("hard integer source-cloth contacts", () => {
  it("finds an exactly stored target contact while retaining a separate hard preservation contact", () => {
    const { constraints, state } = fixture(2.9);
    const result = solveHardClothContacts(state, constraints, 40);
    expect(result.allHardContactsSatisfied).toBe(true);
    expect(result.targetFailures).toBe(0);
    expect(result.preservationFailures).toBe(0);
    expect(result.motion.allMotionBoundsSatisfied).toBe(true);
    expect(result.weights.map(value => Math.round(value * 65535)).reduce((sum, value) => sum + value, 0)).toBe(65535);
  });

  it("reports local failure rather than trading a target against an authorized motion bound", () => {
    const { constraints, state } = fixture(1);
    const result = solveHardClothContacts(state, constraints, 40);
    expect(result.allHardContactsSatisfied).toBe(false);
    expect(result.targetFailures).toBe(1);
    expect(result.preservationFailures).toBe(0);
    expect(result.motion.allMotionBoundsSatisfied).toBe(true);
    expect(result.motion.maximumMotion).toBeLessThanOrEqual(1);
  });
});
