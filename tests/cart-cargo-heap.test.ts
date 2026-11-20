import { describe, expect, it } from "vitest";

import { cartHeapSlot, cartLoadVariant } from "../src/render-common/logistics/cart-cargo-heap";
import { CART_CARGO_LAYOUTS } from "../src/render-common/logistics/cart-cargo-layouts";
import { CART_EXCLUDED_WARES, cartCapacityFor } from "../src/render-common/logistics/handcart-rules";

describe("hand cart load variant", () => {
  it("keeps loads within the base capacity on the audited layout", () => {
    expect(cartLoadVariant("stone", 0, .5)).toBe("base");
    expect(cartLoadVariant("stone", 6, .5)).toBe("base");
    expect(cartLoadVariant(null, 0, .5)).toBe("base");
  });
  it("heaps talent-raised partial loads and lashes a load at the raised capacity", () => {
    expect(cartLoadVariant("stone", 7, .5)).toBe("heaped");
    expect(cartLoadVariant("stone", 8, .5)).toBe("heaped");
    expect(cartLoadVariant("stone", 9, .5)).toBe("full");
    expect(cartLoadVariant("coal", 5, .5)).toBe("heaped");
    expect(cartLoadVariant("coal", 6, .5)).toBe("full");
    // Rank 2 (+20%): 7 stones fill the cart.
    expect(cartLoadVariant("stone", 7, .2)).toBe("full");
  });
  it("never lashes a base-capacity load when the talent adds no item (or there is no talent)", () => {
    expect(cartLoadVariant("stone", 6, .1)).toBe("base");
    expect(cartLoadVariant("stone", 6, 0)).toBe("base");
  });
  it("gives every cart ware a full variant at the highest talent rank", () => {
    for (const ware of Object.keys(CART_CARGO_LAYOUTS).filter(entry => !CART_EXCLUDED_WARES.has(entry)))
      expect(cartLoadVariant(ware, cartCapacityFor(ware, .5), .5), ware).toBe("full");
  });
});

describe("heaped cart slots", () => {
  it("fills the audited layout first, then one more layer from the middle outwards", () => {
    const stone = CART_CARGO_LAYOUTS.stone;
    expect([0, 1, 5].map(index => cartHeapSlot(stone, index))).toEqual([
      { column: 0, layer: 0, row: 0 }, { column: 1, layer: 0, row: 0 }, { column: 1, layer: 0, row: 2 }]);
    expect(cartHeapSlot(stone, 6)).toEqual({ column: 0, layer: 1, row: 1 });
    expect(cartHeapSlot(stone, 7)).toEqual({ column: 1, layer: 1, row: 1 });
    const logs = CART_CARGO_LAYOUTS.logs;
    expect([6, 7, 8].map(index => cartHeapSlot(logs, index))).toEqual([
      { column: 1, layer: 2, row: 0 }, { column: 0, layer: 2, row: 0 }, { column: 2, layer: 2, row: 0 }]);
  });
  it("places every item of a full load in its own slot", () => {
    for (const [ware, layout] of Object.entries(CART_CARGO_LAYOUTS)) {
      const full = cartCapacityFor(ware, .5);
      const slots = new Set(Array.from({ length: full }, (_, index) => JSON.stringify(cartHeapSlot(layout, index))));
      expect(slots.size, ware).toBe(full);
    }
  });
});
