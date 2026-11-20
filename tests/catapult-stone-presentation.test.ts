import { describe, expect, it } from "vitest";

import { updateCatapultWorkerFrame } from "../src/app/settlement/catapult-render-frame";
import { CATAPULT_DECK_HEIGHT } from "../src/render-common/buildings/catapult-dimensions";
import { CATAPULT_STONE_DIAMETER } from "../src/render-common/buildings/catapult-mechanism";
import {
  CATAPULT_BLOCK_REST_LIFT, catapultCarrierStoneShape, catapultDropStoneShape, catapultRestingStoneLift
} from "../src/render-common/buildings/catapult-stone-presentation";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import type { CatapultPorter, CatapultPorterPhase } from "../src/shared/settlement/military-catapult-resupply";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";

const scale = 16 / 11;
const porterFrame = (phase: CatapultPorterPhase, carrying = true) => {
  const frame = { gaitPhase: 0 } as WorkerFrame;
  const porter: CatapultPorter = { actor: 7, carrying, elapsed: 0, phase };
  updateCatapultWorkerFrame(frame, { uid: 7, catapultStoneCargo: carrying || undefined } as SettlementActor, porter);
  return frame;
};

describe("catapult stone presentation", () => {
  it("keeps the delivered block outdoors and shapes round shot only on the hidden stair and roof", () => {
    for (const phase of ["outbound", "pickup", "inbound"] as const)
      expect(porterFrame(phase).catapultStoneDiameter, phase).toBeUndefined();
    for (const phase of ["stairs-up", "roof", "place", "roof-return", "stairs-down"] as const)
      expect(porterFrame(phase).catapultStoneDiameter, phase).toBeCloseTo(CATAPULT_STONE_DIAMETER * scale);
  });

  it("returns an evacuated stone to a block on the hidden walk to the door and for later cargo", () => {
    expect(catapultCarrierStoneShape(undefined, "roof")).toBe("round");
    expect(catapultCarrierStoneShape(undefined, "stairs")).toBe("round");
    expect(catapultCarrierStoneShape(undefined, "door")).toBe("block");
    expect(catapultCarrierStoneShape(undefined)).toBe("block");
    const cargo = { gaitPhase: 0 } as WorkerFrame;
    updateCatapultWorkerFrame(cargo, { uid: 3, catapultStoneCargo: true } as SettlementActor);
    expect(cargo.catapultStoneDiameter).toBeUndefined();
  });

  it("rests the carriers' cut block on the ground and keeps raised drops round", () => {
    const block = createWareRecipe("stone", true).parts[0]!;
    expect(block.shape).toBe("stone-block");
    expect(CATAPULT_BLOCK_REST_LIFT).toBeCloseTo((block.size[1] / 2 - block.position[1]) * WORKER_SCALE);
    expect(catapultDropStoneShape(10.02, 10, scale)).toBe("block");
    expect(catapultDropStoneShape(10 + CATAPULT_DECK_HEIGHT * scale, 10, scale)).toBe("round");
    expect(catapultRestingStoneLift("block", scale)).toBe(CATAPULT_BLOCK_REST_LIFT);
    expect(catapultRestingStoneLift("round", scale)).toBeCloseTo(CATAPULT_STONE_DIAMETER / 2 * scale);
  });
});
