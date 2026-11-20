import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { isBuildingCourtyardPointWalkable } from "../src/render-common/buildings/building-courtyard";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { PRODUCTION_RULES } from "../src/shared/settlement/production-rules";

describe("complete exterior production stock contracts", () => {
  for (const definition of BUILDING_CATALOG) {
    const rule = PRODUCTION_RULES[definition.id];
    if (!rule || rule.service) continue;
    it(`${definition.name} has visible input categories and complete output places in both LODs`, () => {
      for (const detailed of [true, false]) {
        const recipe = createRomanBuildingRecipe(definition, detailed);
        for (const kind of ["input", "output"] as const) {
          const wares = kind === "input" ? rule.inputs : rule.outputs.filter(ware => ware !== "horse");
          for (const ware of wares) {
            const parts = recipe.parts.filter(part => part.stock && (part.stock.kind ?? "output") === kind &&
              (part.stock.ware === ware || part.stock.wares?.includes(ware)));
            expect(parts.length, `${kind} ${ware}`).toBeGreaterThan(0);
            if (kind === "output") expect(new Set(parts.map(part => part.stock!.slot)).size)
              .toBe(definition.id === 18 ? 9 : 6);
          }
        }
      }
    });
    it(`${definition.name} transfers at actual stock positions in all rotations`, () => {
      for (const kind of ["input", "output"] as const) {
        const wares = kind === "input" ? rule.inputs : rule.outputs.filter(ware => ware !== "horse");
        for (const ware of wares) for (const slot of kind === "output" ? [0, 1, 2, 3, 4, 5] : [0, 1, 5]) for (const turns of [0, 1, 2, 3]) {
          const contact = getBuildingStockContact(definition.id, kind, ware, slot, 40, 50, turns, 2)!;
          expect(contact).not.toBeNull();
          expect([...contact.stock, ...contact.approach, ...contact.warePosition, ...contact.wareScale,
            contact.wareYaw, contact.yaw].every(Number.isFinite)).toBe(true);
          expect(isBuildingCourtyardPointWalkable(definition.id, 40, 50, turns,
            {x: contact.approach[0], z: contact.approach[2]})).toBe(true);
          const reach = Math.hypot(contact.approach[0] - contact.stock[0], contact.approach[2] - contact.stock[2]);
          expect(reach).toBeGreaterThan(.225);
          expect(reach).toBeLessThan(1.6);
          const canonical = createWareRecipe(ware, true).parts.map(part => getRomanPartBounds(part));
          const center = [0, 1, 2].map(axis => (Math.min(...canonical.map(p => p.min[axis]!)) +
            Math.max(...canonical.map(p => p.max[axis]!))) * contact.wareScale[axis]! / 2);
          const cosine = Math.cos(contact.wareYaw), sine = Math.sin(contact.wareYaw);
          const actual = [contact.warePosition[0] + center[0]! * cosine + center[2]! * sine,
            contact.warePosition[1] + center[1]!, contact.warePosition[2] - center[0]! * sine + center[2]! * cosine];
          actual.forEach((value, axis) => expect(value).toBeCloseTo(contact.stock[axis]!, 8));
        }
      }
    });
  }
  it("removes continuous below-ground stone skirts from every village recipe", () => {
    for (const definition of BUILDING_CATALOG.filter(building => building.id !== 39)) {
      const recipe = createRomanBuildingRecipe(definition, true);
      expect(recipe.parts.filter(part => part.surface === "stone" && part.stage === 0 &&
        part.position[1] < 0 && (part.size[0] > .7 || part.size[2] > .7))).toEqual([]);
    }
  });
});
