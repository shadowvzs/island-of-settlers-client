import { describe, expect, it } from "vitest";

import { CARRIER_WALK_SPEED } from "../src/shared/balance/economy";
import { moveActor } from "../src/shared/settlement/settlement-paths";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";

describe("civilian gameplay movement speeds", () => {
  it.each([null, "logs", "stone"])(
    "moves carriers at their walking speed times the road speed while carrying %s",
    (ware) => {
      const actor = {
        uid: 0,
        x: 5,
        z: 5,
        y: 0,
        yaw: 0,
        visible: true,
        job: "Carrier",
        phase: "deliver",
        ware,
        action: ware ? "carry" : "walk",
        path: [{ x: 10, z: 5 }],
        pathIndex: 0,
        timer: 0
      } as SettlementActor;
      const context = {
        actors: [actor],
        buildings: [],
        occupied: new Uint8Array(32 ** 2),
        options: {
          world: {
            cellsX: 32,
            cellsZ: 32,
            heights: new Float32Array(33 ** 2),
            walkCost: new Uint8Array(32 ** 2).fill(10),
            props: { count: 0 }
          },
          roads: { speedAt: () => 1 }
        }
      } as unknown as SettlementContext;
      moveActor(context, actor, 0.5);
      expect(actor.x - 5).toBeCloseTo(CARRIER_WALK_SPEED * 0.5);
      expect(actor.locomotionSpeed).toBe(CARRIER_WALK_SPEED);
      actor.x = 5;
      context.options.roads.speedAt = () => 1.5;
      moveActor(context, actor, 0.5);
      expect(actor.x - 5).toBeCloseTo(CARRIER_WALK_SPEED * 0.5 * 1.5);
      expect(actor.locomotionSpeed).toBeCloseTo(CARRIER_WALK_SPEED * 1.5);
      if (ware) {
        actor.job = "Woodcutter";
        actor.x = 5;
        moveActor(context, actor, 0.5);
        expect(actor.x - 5).toBeCloseTo(.9 * 0.5);
        expect(actor.locomotionSpeed).toBe(.9);
      }
    }
  );
  it("preserves mount movement independent of human animation metadata", () => {
    const actor = {
      uid: -1,
      x: 5,
      z: 5,
      y: 0,
      yaw: 0,
      visible: true,
      job: "Mount",
      phase: "horseDeliver",
      ware: "logs",
      action: "carry",
      path: [{ x: 10, z: 5 }],
      pathIndex: 0,
      timer: 0
    } as SettlementActor;
    const context = {
      actors: [actor],
      buildings: [],
      occupied: new Uint8Array(32 ** 2),
      options: {
        world: {
          cellsX: 32,
          cellsZ: 32,
          heights: new Float32Array(33 ** 2),
          walkCost: new Uint8Array(32 ** 2).fill(10),
          props: { count: 0 }
        },
        roads: { speedAt: () => 1.5 }
      }
    } as unknown as SettlementContext;
    moveActor(context, actor, 0.5);
    expect(actor.x - 5).toBeCloseTo(0.9 * 0.5 * 1.5);
  });
});
