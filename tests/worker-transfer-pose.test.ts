import { describe, expect, it } from "vitest";

import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { workerTransferMaterialAction } from "../src/renderers/three/worker-transfer-pose";
import { BuildingType } from "../src/shared/settlement/building-type-ids";

const transferFrame = (height: number, direction: "pickup" | "putdown", ware = "hides", y = 0) => ({
  wareTransfer: { direction, progress: .35, target: { x: 1, y: y + height, z: 2 }, ware },
  y
} satisfies Pick<WorkerFrame, "wareTransfer" | "y">);

describe("stock transfer material pose", () => {
  it("reaches the actual Chinese Tannery stock standing across rotations and terrain elevation", () => {
    for (const rotation of [0, 1, 2, 3]) {
      for (const [kind, ware] of [["input", "hides"], ["output", "leather"]] as const) {
        const contact = getBuildingStockContact(BuildingType.Tannery, kind, ware, 0,
          12, 18, rotation, 7, undefined, undefined, { nation: "chinese" });
        expect(contact).not.toBeNull();
        const height = contact!.warePosition[1] - contact!.approach[1];
        expect(height).toBeGreaterThan(.7);
        for (const direction of ["pickup", "putdown"] as const) {
          const frame = transferFrame(height, direction, ware, contact!.approach[1]);
          const before = structuredClone(frame);
          expect(workerTransferMaterialAction(frame)).toBe("idle_breathe");
          expect(frame).toEqual(before);
        }
      }
    }
  });

  it("retains ground pickup and putdown at either terrain elevation", () => {
    for (const y of [0, 7]) {
      expect(workerTransferMaterialAction(transferFrame(.15, "pickup", "hides", y))).toBe("pickup_material");
      expect(workerTransferMaterialAction(transferFrame(.15, "putdown", "leather", y))).toBe("putdown_material");
    }
  });

  it("retains the existing standing special cases", () => {
    for (const ware of ["water", "stone", "marble", "bread"]) {
      expect(workerTransferMaterialAction(transferFrame(.15, "pickup", ware))).toBe("idle_breathe");
    }
  });
});
