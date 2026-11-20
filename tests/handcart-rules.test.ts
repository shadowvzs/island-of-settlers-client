import { describe, expect, it } from "vitest";

import { CART_CARGO_LAYOUTS } from "../src/render-common/logistics/cart-cargo-layouts";
import {
  CART_EXCLUDED_WARES, cartCapacityFor, cartFitsRoad, cartLoadFits, cartPassingWidth,
HANDCART,   isUpgradedCartRoute
} from "../src/render-common/logistics/handcart-rules";
import { WARE_IDS } from "../src/render-common/wares/ware-catalog";
import { maximumTalentModifier } from "../src/shared/progression/talents";
import type { RoadSegment } from "../src/shared/settlement/road-types";
const points = [{ x: 0, z: 0 }, { x: .5, z: 0 }, { x: 1, z: 0 }];
const roads: RoadSegment[] = points.slice(1).map((end, index) => ({ start: points[index]!, end, tier: "stone" }));
describe("upgraded-road handcart prototype", () => {
  it("requires every upgraded edge and refuses gaps, dirt, preview and door roads", () => {
    expect(isUpgradedCartRoute(points, roads)).toBe(true);
    expect(isUpgradedCartRoute(points, roads.slice(1))).toBe(false);
    for (const change of [{ tier: "dirt" as const }, { doorway: true }, { preview: true }])
      expect(isUpgradedCartRoute(points, [roads[0]!, { ...roads[1]!, ...change }])).toBe(false);
    expect(isUpgradedCartRoute([{ x: 0, z: .0011 }, { x: 1, z: .0011 }], roads)).toBe(false);
  });
  it("fits a single ordinary stone road but demands a bay for two carts", () => {
    expect(cartFitsRoad()).toBe(true);
    expect(cartFitsRoad(.34)).toBe(false);
    expect(cartPassingWidth()).toBeGreaterThan(.8);
  });
  it("accepts partial loads and fills the cart by ware weight", () => {
    expect(cartLoadFits(["stone"])).toBe(true);
    expect(cartLoadFits(["stone", "planks", "bread"])).toBe(true);
    expect(cartLoadFits(Array(6).fill("stone"))).toBe(true);
    expect(cartLoadFits(Array(7).fill("stone"))).toBe(false);
    expect(cartLoadFits(["logs", "logs"])).toBe(true);
    expect(cartLoadFits([...Array(6).fill("logs"), "fish"])).toBe(false);
    expect(cartLoadFits(Array(6).fill("bread"))).toBe(true);
    expect(cartLoadFits(Array(7).fill("coins"))).toBe(false);
    expect(cartCapacityFor("logs")).toBe(6);
    expect(cartCapacityFor("stone")).toBe(6);
    expect(cartCapacityFor("planks")).toBe(6);
    expect(cartCapacityFor("fish")).toBe(6);
    expect(cartCapacityFor("axe")).toBe(6);
    // The horse ware was retired with the stable (STABLE-CLEANUP), so only the remaining exclusions are checked.
    for (const ware of ["pig", "boat"]) {
      expect(cartLoadFits([ware])).toBe(false);
      expect(cartCapacityFor(ware)).toBe(0);
    }
  });
  it("takes every capacity from the audited item layout, not a volume estimate", () => {
    for (const ware of WARE_IDS) {
      if (CART_EXCLUDED_WARES.has(ware)) {
        expect(cartCapacityFor(ware), ware).toBe(0);
        continue;
      }
      const layout = CART_CARGO_LAYOUTS[ware as keyof typeof CART_CARGO_LAYOUTS];
      expect(layout, ware).toBeDefined();
      expect(cartCapacityFor(ware), ware).toBe(layout.count);
      expect(layout.count, ware).toBeLessThanOrEqual(HANDCART.maxItems);
      expect(cartCapacityFor(ware, maximumTalentModifier("handcartCapacity")), ware)
        .toBe(Math.floor(layout.count * (1 + maximumTalentModifier("handcartCapacity")) + 1e-9));
    }
  });
});
