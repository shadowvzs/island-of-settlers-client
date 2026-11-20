import { describe, expect, it } from "vitest";

import { BODY_HIT_RADIUS, bodyHitAt } from "../src/app/settlement/army-target/body-hit";

/** A plain screen projection: 40 px per world unit, y up the screen (smaller screen y). */
const project = (x: number, y: number, z: number) => ({ x: 400 + x * 40, y: 400 - y * 40 + z * 10 });
const soldier = { uid: 1, x: 0, y: 0, z: 0 };
const rider = { mounted: true, uid: 2, x: 5, y: 0, z: 0 };

describe("enemy body hit (on the body chases, near it attack-moves)", () => {
  it.each<[string, { x: number; y: number }, number | undefined]>([
    ["chest", { x: 400, y: 378 }, 1],
    ["feet", { x: 400, y: 400 }, 1],
    ["head", { x: 400, y: 334 }, 1],
    ["just beside the shoulder (within the 10 px half width)", { x: 409, y: 370 }, 1],
    ["near but off the body", { x: 418, y: 370 }, undefined],
    ["above the head", { x: 400, y: 315 }, undefined],
    ["a rider's raised head", { x: 600, y: 312 }, 2]
  ])("%s", (_name, point, expected) => {
    expect(bodyHitAt([soldier, rider], project, point)?.uid).toBe(expected);
  });

  it("gives a finger more tolerance than a mouse", () => {
    const point = { x: 413, y: 370 };
    expect(bodyHitAt([soldier], project, point, BODY_HIT_RADIUS.mouse)).toBeUndefined();
    expect(bodyHitAt([soldier], project, point, BODY_HIT_RADIUS.touch)?.uid).toBe(1);
  });

  it("keeps a far body clickable and prefers the most central of overlapping bodies", () => {
    const far = (x: number, y: number, z: number) => ({ x: 400 + x * 2, y: 400 - y * 2 });
    expect(bodyHitAt([soldier], far, { x: 403, y: 398 })?.uid).toBe(1);
    const behind = { uid: 3, x: .2, y: 0, z: 0 };
    expect(bodyHitAt([behind, soldier], project, { x: 401, y: 380 })?.uid).toBe(1);
  });
});
