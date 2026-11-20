import { expect, it } from "vitest";

import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";

// Stock above the six-item shelf (in-flight batches, or old saves from the former 6→8 workshop
// buffer, replaced 2026-10-19) is kept and handed off from the last authored slot.
it("uses the last authored shelf contact for overflow without adding unreachable stock positions", () => {
  for (const [id, ware, count] of [[17, "logs", 31], [33, "planks", 31], [37, "grain", 31], [35, "water", 8],
    [28, "pig", 8], [22, "meat", 8]] as const)
    for (const rotation of [0, 1, 2, 3]) {
      const contact = getBuildingStockContact(id, "output", ware, count - 1, 20, 30, rotation, 2, { [ware]: count });
      expect(contact, `${id} ${rotation}`).not.toBeNull();
      expect(contact!.slot).toBeLessThanOrEqual(5);
      expect(contact!.approach.every(Number.isFinite)).toBe(true);
    }
});
