import { describe, expect, it } from "vitest";

import { CART_CARGO_LAYOUTS } from "../src/render-common/logistics/cart-cargo-layouts";
import { BEER_VISUAL_SCALE } from "../src/render-common/wares/ware-dimensions";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";

describe("beer physical model scale", () => {
  it("applies the shared 30% reduction to the vessel recipe", () => {
    const beer = createWareRecipe("beer", true);
    expect(BEER_VISUAL_SCALE).toBe(.7);
    expect(beer.parts[0]).toMatchObject({ position: [0, 0, 0], shape: "ring", surface: "wood" });
    expect(beer.parts[0]!.size[0]).toBeCloseTo(.33 * .7, 12);
    expect(beer.parts[0]!.size[1]).toBeCloseTo(.25 * .7, 12);
    expect(beer.parts[0]!.size[2]).toBeCloseTo(.27 * .7, 12);
    // Every authored vessel part, including bands and staves, stays inside the reduced envelope.
    for (const part of beer.parts)
      for (const extent of part.size) expect(extent).toBeLessThanOrEqual(.34 * .7 + 1e-9);
  });

  it("keeps the generated cart envelope in step with the smaller cargo", () => {
    const layout = CART_CARGO_LAYOUTS.beer;
    expect(layout.width).toBeCloseTo(.238 * .5, 8);
    expect(layout.depth).toBeCloseTo(.1974 * .5, 8);
    expect(layout.height).toBeCloseTo(.18165 * .5, 8);
    expect(layout.count).toBe(6);
  });
});
