import { expect, it } from "vitest";

import {
  canRetryCarrierDetour,
  carrierJourneyStalled} from "../src/shared/settlement/settlement-carrier-detours";
import { createPathFrontier } from "../src/shared/settlement/settlement-path-frontier";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
const carrier = () =>
  ({
    uid: 1,
    x: 1,
    z: 1,
    phase: "deliver",
    pathIndex: 0,
    path: [{ x: 8, z: 1 }],
    timer: 0
  }) as SettlementActor;

it("recognizes circling as no progress even when sideways movement continually resets the collision timer", () => {
  const actor = carrier();
  let stalled = false;
  for (let step = 0; step < 140; step++) {
    actor.z = 1 + Math.sin(step) * 0.3;
    actor.timer = 0;
    stalled = carrierJourneyStalled(actor, 0.05);
  }
  expect(stalled).toBe(true);
  actor.x += 0.25;
  expect(carrierJourneyStalled(actor, 0.05)).toBe(false);
});
it("retains retry cooldown across a replacement path for the same journey", () => {
  const actor = carrier();
  expect(canRetryCarrierDetour(actor, 0.05, true)).toBe(true);
  actor.path = [
    { x: 2, z: 2 },
    { x: 8, z: 1 }
  ];
  expect(canRetryCarrierDetour(actor, 0.05, true)).toBe(false);
  expect(canRetryCarrierDetour(actor, 1, true)).toBe(true);
});
it("pops the least costly search priorities with stable ties", () => {
  const frontier = createPathFrontier();
  for (const [id, priority] of [
    [0, 8],
    [1, 3],
    [2, 3],
    [3, 1],
    [4, 5]
  ])
    frontier.push(id!, priority!, priority!);
  expect(Array.from({ length: 5 }, () => frontier.pop()?.id)).toEqual([3, 1, 2, 4, 0]);
  expect(frontier.pop()).toBeUndefined();
});
