import { describe, expect, it } from "vitest";

import { remainingShippingOrderNeed } from "../src/shared/settlement/settlement-shipping-priority";

describe("real automatic shipping target priority", () => {
  it("uses the uncapped need net of stock, incoming and other claims without subtracting its own batch twice", () => {
    const order = { cargo: { planks: 40 }, demand: { planks: 200 }, destinationUid: 0 };
    const targets = [{ destinationUid: 0, incoming: 30, need: 200, stock: 20, ware: "planks" }];
    expect(remainingShippingOrderNeed(order, targets, () => 90)).toBe(100);
  });

  it("does not fabricate urgency from spare storage capacity or an already covered consumer", () => {
    const order = { cargo: { planks: 40 }, demand: { planks: 200 }, destinationUid: 0 };
    expect(remainingShippingOrderNeed(order, [], () => 0)).toBe(0);
    const targets = [{ destinationUid: 0, incoming: 0, need: 200, stock: 200, ware: "planks" }];
    expect(remainingShippingOrderNeed(order, targets, () => 40)).toBe(0);
  });

  it("uses an actual consumer goal for a manual request when the target has one", () => {
    const order = { cargo: { planks: 40 }, destinationUid: 0 };
    const targets = [{ destinationUid: 0, incoming: 0, need: 200, stock: 0, ware: "planks" }];
    expect(remainingShippingOrderNeed(order, targets, () => 40)).toBe(200);
  });

  it("leaves explicit cargo and passenger requests to their own remaining manifest count", () => {
    expect(remainingShippingOrderNeed({ cargo: { planks: 4 }, destinationUid: 0 }, [], () => 0))
      .toBeUndefined();
  });
});
