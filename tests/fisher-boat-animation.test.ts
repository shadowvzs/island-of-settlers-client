import { describe, expect, it } from "vitest";
import { fisherBasketVisible, fisherBoatLandAction } from "../src/app/settlement/fisher-boat-animation";
import { getWorkerHeldProp } from "../src/render-common/workers/worker-job-actions";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { workerTransferMaterialAction } from "../src/renderers/three/worker-transfer-pose";
import { transferCarryAction } from "../src/renderers/three/worker-ware-transfer";
import { crowdSkinnedReason } from "../src/renderers/three/worker-gpu-pose";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";

const actor = (overrides: Partial<SettlementActor> = {}) => ({ action: "work", job: "Fisher", phase: "fisherBoatLift",
  timer: .8, ware: null, ...overrides }) as SettlementActor;
const frame = (overrides: Partial<WorkerFrame> = {}) => ({ action: "walk", workerJob: "Fisher", y: 0,
  ...overrides }) as WorkerFrame;

describe("fisher boat presentation", () => {
  it("selects land actions and overhead carry for any job carrying a boat", () => {
    expect(fisherBoatLandAction(actor())).toBe("boat_lift");
    expect(fisherBoatLandAction(actor({ phase: "fisherBoatLaunch" }))).toBe("boat_launch");
    expect(fisherBoatLandAction(actor({ phase: "fisherBoatBeach", timer: 1.5 }))).toBe("boat_beach");
    expect(fisherBoatLandAction(actor({ phase: "fisherBoatBeach", timer: .5 }))).toBe("fish_basket_pickup");
    expect(fisherBoatLandAction(actor({ phase: "deposit", job: "Shipwright", action: "carry", ware: "boat" })))
      .toBe("carry_overhead_boat");
    expect(fisherBoatLandAction(actor({ phase: "work", ware: "fish" }))).toBeUndefined();
  });
  it("represents the four-fish catch with a basket, while ordinary fish stays a fish", () => {
    expect(fisherBasketVisible(actor({ phase: "deposit", ware: "fish", wareUnits: 4 }))).toBe(true);
    expect(fisherBasketVisible(actor({ phase: "deposit", ware: "fish", wareUnits: 1 }))).toBe(false);
    expect(fisherBasketVisible(actor({ phase: "fisherBoatBeach", timer: .5 }))).toBe(true);
    expect(getWorkerHeldProp(frame({ carryingWare: "fish", fisherBasket: true })))
      .toEqual({ id: "fisher_basket", source: "ware" });
    expect(getWorkerHeldProp(frame({ carryingWare: "boat", action: "carry_overhead_boat" })))
      .toEqual({ id: "boat", source: "ware" });
    expect(crowdSkinnedReason(frame({ carryingWare: "boat", action: "carry_overhead_boat" }))).toBe("boatContact");
  });
  it("uses the boat hoist and overhead carry for stock transfers", () => {
    const transfer = { ware: "boat", direction: "pickup", progress: .5, target: { x: 0, y: 0, z: 0 } } as const;
    const carrying = frame({ wareTransfer: transfer });
    expect(workerTransferMaterialAction(carrying)).toBe("boat_lift");
    expect(transferCarryAction(carrying)).toBe("carry_overhead_boat");
    expect(workerTransferMaterialAction(frame({ wareTransfer: { ...transfer, direction: "putdown" } })))
      .toBe("boat_putdown");
  });
});
