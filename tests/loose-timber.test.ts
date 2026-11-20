import { Box3, MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { CART_CARGO_LAYOUTS } from "../src/render-common/logistics/cart-cargo-layouts";
import { ADVANCED_MATERIAL_SOURCE_DATA } from "../src/render-common/wares/advanced-material-source-data";
import { woodWareAppearance } from "../src/render-common/wares/advanced-material-variants";
import { looseTimberSourceChunks } from "../src/render-common/wares/loose-timber-source";
import { WARE_IDS } from "../src/render-common/wares/ware-catalog";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { createWareModel } from "../src/renderers/three/settlement/ware-models";

const material = new MeshStandardMaterial();
const materials = new Proxy({}, { get: () => material }) as Record<BuildingSurface, MeshStandardMaterial>;
const advanced = WARE_IDS.filter(id => woodWareAppearance(id));

describe("loose original timber without transport supports or bindings", () => {
  it("retains original bark/end grain and board chunks, excluding the separate support materials", () => {
    const logs = looseTimberSourceChunks("logs", ADVANCED_MATERIAL_SOURCE_DATA.logs.chunks);
    expect(new Set(logs.map(chunk => chunk.material))).toEqual(new Set([0, 1]));
    const planks = looseTimberSourceChunks("planks", ADVANCED_MATERIAL_SOURCE_DATA.planks.chunks);
    expect(new Set(planks.map(chunk => chunk.material))).toEqual(new Set([0]));
    for (const chunk of logs) expect(ADVANCED_MATERIAL_SOURCE_DATA.logs.chunks.includes(chunk)).toBe(true);
    for (const chunk of planks) expect(ADVANCED_MATERIAL_SOURCE_DATA.planks.chunks.includes(chunk)).toBe(true);
  });

  it.each(advanced)("%s preserves its cargo contact envelope and ground origin at both detail levels", ware => {
    const appearance = woodWareAppearance(ware)!;
    const layout = CART_CARGO_LAYOUTS[appearance.base];
    for (const detailed of [true, false]) {
      const model = createWareModel(ware, detailed, materials, "carry");
      model.root.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(model.root), size = bounds.getSize(new Vector3());
      expect(size.x).toBeCloseTo(layout.width / layout.scale, 6);
      expect(size.y).toBeCloseTo(layout.height / layout.scale, 6);
      expect(size.z).toBeCloseTo(layout.depth / layout.scale, 6);
      expect(bounds.min.y).toBeCloseTo(-size.y / 2, 6);
      expect(model.triangles()).toBeGreaterThan(0);
      for (const stock of [false, true]) {
        const recipe = createWareRecipe(ware, detailed, stock);
        expect(recipe.parts.some(part => part.surface === "rope" || part.surface === "iron")).toBe(false);
      }
      model.dispose();
    }
  });
});
