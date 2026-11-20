import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isBuildingCourtyardPointConnected } from "../src/render-common/buildings/building-courtyard";
import { getRomanRecipeBounds, getRomanRecipeFitScale } from "../src/render-common/buildings/building-recipe-fit";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { getBuildingStockLayout } from "../src/render-common/buildings/building-stock-layout";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { getRomanWareStockSlots } from "../src/render-common/buildings/roman-ware-stock";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

const nations = ["roman", "chinese", "japanese", "nubian", "persian", "maya", "indigenous", "viking"] as const;

describe("brewery two-unit water input bay", () => {
  it("keeps the original brewery footprint and fit scale", () => {
    const definition = getBuildingDefinition(23), { recipe } = getBuildingStockLayout(23);
    const before = { ...recipe, parts: recipe.parts.filter(part => !(part.stock?.kind === "input" &&
      part.stock.ware === "water" && part.stock.slot === 1)) };
    expect(getRomanRecipeBounds(definition, recipe)).toEqual(getRomanRecipeBounds(definition, before));
    expect(getRomanRecipeFitScale(definition, recipe)).toBe(getRomanRecipeFitScale(definition, before));
  });

  it.each(nations)("%s uses distinct actual containers and delivery places in every rotation and level", nation => {
    const materials = createPlainBuildingMaterials(), definition = getBuildingDefinition(23);
    try {
      for (const level of [1, 2, 3, 4, 5] as const) for (const detailed of [true, false]) {
        const style = { nation, level }, { recipe: reference, scale } = getBuildingStockLayout(23, style);
        const slots = getRomanWareStockSlots(reference, scale).filter(slot => slot.stock.ware === "water");
        expect(slots.map(slot => slot.stock.slot)).toEqual([0, 1]);
        const original = getRomanWareStockSlots(reference).find(slot => slot.stock.ware === "water" && slot.stock.slot === 0)!;
        expect(slots[0]!.center[0]).toBeCloseTo(original.center[0], 12);
        expect(slots[0]!.center[2]).toBeCloseTo(original.center[2], 12);
        const model = createRomanBuilding(definition, materials, detailed,
          leveledBuildingRecipe(definition, nation, detailed, level), nation, reference);
        model.fitToGrid();
        try {
          for (const rotation of [0, 1, 2, 3]) {
            model.root.rotation.y = rotation * Math.PI / 2;
            for (const count of [0, 1, 2, 1, 0]) {
              const input = { water: count, grain: 1 }, output = { beer: 6 };
              model.update(0, { construction: 1, door: 0, working: false, inputStock: input, outputStock: output });
              model.root.updateMatrixWorld(true);
              const water = slots.map(slot => model.root.getObjectByName(`stock_input_${slot.stock.slot}_water`)!);
              expect(water.filter(object => object.visible)).toHaveLength(count);
              const grain = new Box3().setFromObject(model.root.getObjectByName("stock_input_0_grain")!);
              const boxes = water.filter(object => object.visible).map(object => new Box3().setFromObject(object));
              for (const box of boxes) expect(box.intersectsBox(grain), `${nation}/${level}/${rotation} grain`).toBe(false);
              if (count === 2) {
                expect(boxes[0]!.intersectsBox(boxes[1]!)).toBe(false);
                expect(model.triangles(false)).toBeLessThanOrEqual(nationTriangleBudget(nation, 23)[detailed ? 0 : 1]);
              }
              for (let slot = 0; slot < count; slot++) {
                const contact = getBuildingStockContact(23, "input", "water", slot, 0, 0, rotation, 0,
                  input, output, style)!;
                expect(contact).not.toBeNull();
                expect(contact.slot).toBe(slot);
                const actualPosition = water[slot]!.getWorldPosition(new Vector3());
                contact.warePosition.forEach((value, axis) => expect(value).toBeCloseTo(actualPosition.toArray()[axis]!, 6));
                // Odd-sided national vessels have a sub-centimetre asymmetric tessellation envelope.
                expect(Math.abs(contact.stock[0] - (boxes[slot]!.min.x + boxes[slot]!.max.x) / 2)).toBeLessThan(.006);
                expect(Math.abs(contact.stock[2] - (boxes[slot]!.min.z + boxes[slot]!.max.z) / 2)).toBeLessThan(.006);
                expect(isBuildingCourtyardPointConnected(23, 0, 0, rotation,
                  { x: contact.approach[0], z: contact.approach[2] }, output, input, style)).toBe(true);
              }
              if (count === 1) {
                const next = getBuildingStockContact(23, "input", "water", 1, 0, 0, rotation, 0, input, output, style)!;
                const first = getBuildingStockContact(23, "input", "water", 0, 0, 0, rotation, 0, input, output, style)!;
                expect(next.slot).toBe(1);
                expect(next.warePosition).not.toEqual(first.warePosition);
              }
            }
          }
        } finally { model.dispose(); }
      }
    } finally { Object.values(materials).forEach(material => material.dispose()); }
  }, 30_000);
});
