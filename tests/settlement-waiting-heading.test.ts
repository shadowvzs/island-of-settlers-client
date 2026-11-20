import { expect, it } from "vitest";

import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { faceWaitingDestination } from "../src/shared/settlement/settlement-waiting-heading";

it.each(["deliveryStockWalk", "carrierDeliveryBlocked"])(
  "turns a waiting construction carrier %s toward its handoff smoothly without changing cargo or position",
  (phase) => {
    const actor = {
      x: 4,
      z: 4,
      yaw: 0,
      visible: true,
      ware: "stone",
      phase,
      path: [{ x: 4, z: 5 }],
      pathIndex: 0,
      stockContact: { approach: { x: 6, z: 4 } }
    } as SettlementActor;
    faceWaitingDestination(actor, 0.05);
    expect(actor.yaw).toBeCloseTo(0.3);
    for (let tick = 0; tick < 20; tick++) faceWaitingDestination(actor, 0.05);
    expect(actor.yaw).toBeCloseTo(Math.PI / 2);
    const fixedYaw = actor.yaw;
    faceWaitingDestination(actor, 0.05);
    expect(actor.yaw).toBe(fixedYaw);
    expect([actor.x, actor.z, actor.ware, actor.phase]).toEqual([4, 4, "stone", phase]);
  }
);
it("does not rotate hidden or already-at-target crews", () => {
  const actor = {
    x: 4,
    z: 4,
    yaw: 1,
    visible: false,
    path: [{ x: 8, z: 4 }],
    pathIndex: 0
  } as SettlementActor;
  faceWaitingDestination(actor, 0.05);
  expect(actor.yaw).toBe(1);
  actor.visible = true;
  actor.path = [{ x: 4, z: 4 }];
  faceWaitingDestination(actor, 0.05);
  expect(actor.yaw).toBe(1);
});
