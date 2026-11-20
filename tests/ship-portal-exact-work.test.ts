import { expect, it } from "vitest";

import {
  createShipClearanceMasks, createShipMoveClearance, createShipOverlapTest, ENVELOPE_REACH, moveKeepsClear, shipsOverlap
} from "../src/shared/settlement/settlement-ship-clearance";
import {
  findTurningPortal, TURNING_PORTAL_OBSTACLE_REACH, turningPortalObstacles
} from "../src/shared/settlement/settlement-ship-portal";
import { createShipSea } from "./helpers/ship-motion-scenarios";

it("preserves boolean SAT early exits including nonfinite and signed-zero inputs", () => {
  const prepared = createShipOverlapTest();
  for (const yaw of [0, -0, .217, Math.PI / 2, Infinity, NaN])
    for (const otherYaw of [0, -0, -.217, -Math.PI / 2, -Infinity, NaN])
      for (const x of [-0, 0, 3, 5.6 - 1e-10, 5.6, 5.6 + 1e-10, 11, Infinity, NaN])
        for (const z of [0, 3, 6, 11]) {
          const a = { x, z, yaw }, b = { x: 0, z: 0, yaw: otherYaw };
          expect(prepared(a, b)).toBe(shipsOverlap(a, b));
        }
});

it("memoizes identical SAT arithmetic across signed-zero, rotated and clearance-boundary poses", () => {
  const headings = [0, -0, Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI, .217, .217 + 1e-12, Math.PI * 2 + .217];
  const distances = [0, 3, 5.6 - 1e-10, 5.6, 5.6 + 1e-10, 6.2, 11 - 1e-10, 11, 11 + 1e-10,
    ENVELOPE_REACH - 1e-8, ENVELOPE_REACH, ENVELOPE_REACH + 1e-8];
  const shifts = [[.01, 0, 0], [-.01, 0, 0], [0, .02, 1e-12], [0, -.02, -1e-12], [.05, .05, .02]];
  for (const otherYaw of headings) {
    const other = { x: 0, z: 0, yaw: otherYaw }, prepared = createShipMoveClearance([other]);
    for (const yaw of headings) for (const x of distances) for (const z of [0, 5.6, 11])
      for (const [dx, dz, turn] of shifts) {
        const current = { x, z, yaw }, candidate = { x: x + dx!, z: z + dz!, yaw: yaw + turn! };
        expect(prepared(current, candidate)).toBe(moveKeepsClear(current, candidate, other));
      }
  }
});

it("retains identical bounded turning results after discarding only provably distant hulls", () => {
  const { sea, world } = createShipSea(120, { z0: 50, z1: 60, tip: 38 });
  const masks = createShipClearanceMasks(world, sea), from = { x: 25.5, z: 40.5, yaw: 0 };
  const reach = TURNING_PORTAL_OBSTACLE_REACH;
  const boundary = [{ x: from.x + reach, z: from.z, yaw: .3 },
    { x: from.x + reach + 1e-5, z: from.z, yaw: -.3 }];
  expect(turningPortalObstacles(from, boundary)).toEqual([boundary[0]]);
  for (const roomy of [false, true]) for (const maxExpansions of [0, 1, 512, 4000]) {
    const blocked = [{ x: 37.5, z: 47.5, yaw: -.2 }, ...boundary];
    expect(findTurningPortal({ blocked: turningPortalObstacles(from, blocked), masks, roomy, sea, world },
      from, maxExpansions)).toEqual(findTurningPortal({ blocked, masks, roomy, sea, world }, from, maxExpansions));
  }
});

it("retains exact SAT decisions after local/shared yaw-cache eviction and caller obstacle mutation", () => {
  const blocked = [{ x: 4, z: 3, yaw: -0 }, { x: -3, z: 4, yaw: .217 },
    { x: 2, z: -4, yaw: -Math.PI / 2 }];
  const snapshot = structuredClone(blocked), prepared = createShipMoveClearance(blocked);
  blocked[0]!.x = 1000; blocked[1]!.yaw = Math.PI;
  const headings = [0, -0, ...Array.from({ length: 4300 }, (_, index) => index / 37 - Math.PI), -0, 0, .217];
  for (const yaw of headings) for (const x of [-5.6, -1e-10, -0, 0, 1e-10, 5.6]) {
    const current = { x, z: 0, yaw }, candidate = { x: x + .02, z: .02, yaw: yaw + 1e-12 };
    expect(prepared(current, candidate)).toBe(snapshot.every(other => moveKeepsClear(current, candidate, other)));
  }
  const moved = snapshot.map(other => ({ ...other, x: other.x + 2, z: other.z - 1 }));
  const anotherQuery = createShipMoveClearance(moved);
  for (const yaw of [-0, 0, .217]) {
    const current = { x: 1, z: 2, yaw }, candidate = { x: 1.01, z: 2.01, yaw };
    expect(anotherQuery(current, candidate)).toBe(moved.every(other => moveKeepsClear(current, candidate, other)));
  }
});
