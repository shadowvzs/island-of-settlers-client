import { Box3, MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { CART_CARGO_LAYOUTS } from "../src/render-common/logistics/cart-cargo-layouts";
import { CART_EXCLUDED_WARES, cartCapacityFor } from "../src/render-common/logistics/handcart-rules";
import { WARE_IDS } from "../src/render-common/wares/ware-catalog";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { placeCartCargo } from "../src/renderers/three/settlement/roman-handcart";
import { createWareModel } from "../src/renderers/three/settlement/ware-models";

it("provides a fixed measured cargo layout for every cart-eligible ware", () => {
  const missing = WARE_IDS.filter(ware => !CART_EXCLUDED_WARES.has(ware) && !(ware in CART_CARGO_LAYOUTS));
  expect(missing).toEqual([]);
});

it("packs six full-size Spyglasses inside the cart bed in both detail levels", () => {
  const material = new MeshStandardMaterial();
  const materials = Object.fromEntries(createWareRecipe("spyglass", true).parts.map(part =>
    [part.surface, material])) as Record<BuildingSurface, MeshStandardMaterial>;
  expect(cartCapacityFor("spyglass")).toBe(6);
  for (const detailed of [true, false]) {
    const boxes: Box3[] = [];
    for (let index = 0; index < 6; index++) {
      const model = createWareModel("spyglass", detailed, materials);
      placeCartCargo(model.root, "spyglass", index, 6);
      const box = new Box3().setFromObject(model.root);
      expect(box.min.x).toBeGreaterThanOrEqual(-.210001);
      expect(box.max.x).toBeLessThanOrEqual(.210001);
      expect(box.min.z).toBeGreaterThanOrEqual(-.365001);
      expect(box.max.z).toBeLessThanOrEqual(.275001);
      expect(box.min.y).toBeCloseTo(.427, 6);
      expect(box.max.y).toBeLessThanOrEqual(.727001);
      for (const previous of boxes) expect(box.intersectsBox(previous)).toBe(false);
      boxes.push(box);
      model.dispose();
    }
  }
  material.dispose();
});
