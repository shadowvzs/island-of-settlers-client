import { expect, it, vi } from "vitest";

import { DMath } from "../src/shared/math/deterministic-math";
import { createShipClearanceMasks } from "../src/shared/settlement/settlement-ship-clearance";
import { sailArc, swingAbout } from "../src/shared/settlement/settlement-ship-kinematics";
import { findTurningPortal } from "../src/shared/settlement/settlement-ship-portal";
import { createShipTrigMemo } from "../src/shared/settlement/settlement-ship-trigonometry";
import { createShipSea } from "./helpers/ship-motion-scenarios";

it("preserves exact deterministic sine/cosine bits including signed zero through cache eviction", () => {
  const trig = createShipTrigMemo();
  const angles = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, Math.PI, -Math.PI, Infinity, -Infinity, NaN];
  for (let index = 0; index < 5000; index++) angles.push(index / 123.457);
  for (const angle of [...angles, ...angles.reverse()]) {
    expect(Object.is(trig.sin(angle), DMath.sin(angle))).toBe(true);
    expect(Object.is(trig.cos(angle), DMath.cos(angle))).toBe(true);
  }
});

it("preserves every arc/swing pose with identical order of arithmetic", () => {
  const trig = createShipTrigMemo();
  for (const [x, z] of [[3.75, -2.25], [0, 0], [-0, -0], [0, -0], [-0, 0]])
    for (const yaw of [0, -0, .217, -.217, Math.PI, -Math.PI, Math.PI * 2 + .217])
    for (const turn of [0, -0, 1e-10, -1e-10, 1e-9, -1e-9, 1 / 3, -1 / 3, Math.PI / 8]) {
      const pose = { x: x!, z: z!, yaw };
      for (const distance of [0, -0, .2, -.2, 1, -1])
        expect(sailArc(pose, distance, turn, trig)).toStrictEqual(sailArc(pose, distance, turn));
      for (const pivot of [0, -0, -5.5, 5.5])
        expect(swingAbout(pose, pivot, turn, trig)).toStrictEqual(swingAbout(pose, pivot, turn));
    }
});

it("returns identical complete turning paths or bounded failures with memoized and direct arithmetic", () => {
  const { sea, world } = createShipSea(120, { z0: 50, z1: 60, tip: 38 });
  const masks = createShipClearanceMasks(world, sea);
  for (const yaw of [0, -0, .217, Math.PI / 2]) for (const sternFirst of [false, true])
    for (const roomy of [false, true]) for (const maxExpansions of [0, 1, 512, 4000]) {
      const from = { x: 25.5, z: 40.5, yaw }, blocked = [{ x: 37.5, z: 47.5, yaw: -.2 }];
      const search = { blocked, masks, roomy, sea, sternFirst, world };
      expect(findTurningPortal(search, from, maxExpansions))
        .toStrictEqual(findTurningPortal(search, from, maxExpansions, DMath));
    }
});

it("actually reuses deterministic trig work inside a nontrivial tight-water search", () => {
  const { sea, world } = createShipSea(120, { z0: 50, z1: 60, tip: 38 });
  const masks = createShipClearanceMasks(world, sea), from = { x: 25.5, z: 40.5, yaw: 0 };
  const search = { blocked: [{ x: 37.5, z: 47.5, yaw: -.2 }], masks, roomy: true, sea, world };
  const cosine = vi.spyOn(DMath, "cos");
  try {
    const direct = findTurningPortal(search, from, 4000, DMath), directCalls = cosine.mock.calls.length;
    cosine.mockClear();
    const memoized = findTurningPortal(search, from, 4000), memoizedCalls = cosine.mock.calls.length;
    expect(memoized).toStrictEqual(direct);
    expect(directCalls).toBeGreaterThan(100);
    expect(memoizedCalls).toBeLessThan(directCalls);
  } finally { cosine.mockRestore(); }
});
