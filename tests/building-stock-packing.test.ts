import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isBuildingCourtyardPointConnected } from "../src/render-common/buildings/building-courtyard";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { getBuildingStockLayout } from "../src/render-common/buildings/building-stock-layout";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { getRomanWareStockSlots, romanWareStockPlacement } from "../src/render-common/buildings/roman-ware-stock";

const fixture = (id: number) => {
  const { recipe, scale } = getRomanBuildingWorldSizing(getBuildingDefinition(id));
  return { raw: getRomanWareStockSlots(recipe), packed: getRomanWareStockSlots(recipe, scale), scale, recipe };
};
const spread = (slots: ReturnType<typeof getRomanWareStockSlots>, axis: number) =>
  Math.max(...slots.map(slot => slot.center[axis]!)) - Math.min(...slots.map(slot => slot.center[axis]!));

describe("Actual-ware stock packing", () => {
  it("compacts the winery's six casks in both directions without changing their identities", () => {
    const { packed, raw, recipe, scale } = fixture(6);
    const before = raw.filter(slot => slot.stock.ware === "wine");
    const after = packed.filter(slot => slot.stock.ware === "wine");
    expect(after.map(slot => slot.stock)).toEqual(before.map(slot => slot.stock));
    expect(spread(after, 0)).toBeLessThan(spread(before, 0) * .85);
    expect(spread(after, 2)).toBeLessThan(spread(before, 2) * .6);
    expect(getRomanWareStockSlots(recipe, scale)).toBe(packed);
    expect(getRomanWareStockSlots(recipe)).toBe(raw);
  });

  it("moves complete log columns and keeps each upper log on the actual lower surface", () => {
    const { packed, raw, scale } = fixture(17);
    expect(spread(packed, 2)).toBeLessThan(spread(raw, 2));
    for (const slot of packed.filter(slot => slot.stock.slot >= 2)) {
      const below = packed.find(candidate => candidate.stock.slot === slot.stock.slot - 2)!;
      const upperPlacement = romanWareStockPlacement(slot, "logs", scale);
      const lowerPlacement = romanWareStockPlacement(below, "logs", scale);
      expect(upperPlacement.center[0]).toBeCloseTo(lowerPlacement.center[0], 8);
      expect(upperPlacement.center[2]).toBeCloseTo(lowerPlacement.center[2], 8);
      expect(slot.bottom).toBeCloseTo(raw.find(candidate => candidate.stock.slot === slot.stock.slot)!.bottom, 8);
    }
  });

  it("groups pig-feed bundles and water separately while leaving all six live-animal positions intact", () => {
    const { packed, raw } = fixture(28);
    for (const ware of ["grain", "water"]) {
      const before = raw.filter(slot => slot.stock.ware === ware);
      const after = packed.filter(slot => slot.stock.ware === ware);
      expect(after).toHaveLength(3);
      expect(spread(after, 2)).toBeLessThan(spread(before, 2) * .6);
    }
    expect(packed.filter(slot => slot.stock.ware === "pig").map(slot => slot.center)).toEqual(
      raw.filter(slot => slot.stock.ware === "pig").map(slot => slot.center));
  });

  it.each(["roman", "japanese", "chinese", "persian", "maya", "nubian", "indigenous", "viking"] as const)(
    "uses the same %s physical model and carrier contact for a compact cask", nation => {
      const style = { nation, level: 1 as const };
      const { recipe, scale } = getBuildingStockLayout(6, style);
      const slot = getRomanWareStockSlots(recipe, scale).find(candidate => candidate.stock.ware === "wine" &&
        candidate.stock.slot === 5)!;
      const placement = romanWareStockPlacement(slot, "wine", scale);
      const contact = getBuildingStockContact(6, "output", "wine", 5, 0, 0, 0, 0, undefined, undefined, style)!;
      expect(contact.slot).toBe(5);
      expect(contact.warePosition).toEqual(placement.position.map(value => value * scale));
    });

  it.each(["roman", "japanese", "chinese", "persian", "maya", "nubian", "indigenous", "viking"] as const)(
    "keeps every packed drink/farm feed contact accessible for %s", nation => {
      for (const typeId of [6, 23, 28, 37]) for (const level of [1, 5] as const) {
        const style = { nation, level }, { recipe, scale } = getBuildingStockLayout(typeId, style);
        const slots = getRomanWareStockSlots(recipe, scale);
        const input: Record<string, number> = {}, output: Record<string, number> = {};
        for (const slot of slots) {
          const inventory = slot.stock.kind === "input" ? input : output;
          inventory[slot.stock.ware] = Math.max(inventory[slot.stock.ware] ?? 0, slot.stock.slot + 1);
        }
        for (const slot of slots.filter(candidate => candidate.stock.ware !== "pig")) {
          const kind = slot.stock.kind ?? "output", ware = slot.stock.ware;
          const contact = getBuildingStockContact(typeId, kind, ware, slot.stock.slot, 0, 0, 0, 0,
            kind === "input" ? input : output, kind === "input" ? output : input, style)!;
          expect(contact, `${nation}/${typeId}/${level}/${kind}/${ware}/${slot.stock.slot}`).not.toBeNull();
          expect(isBuildingCourtyardPointConnected(typeId, 0, 0, 0,
            { x: contact.approach[0], z: contact.approach[2] }, output, input, style),
          `${nation}/${typeId}/${level}/${kind}/${ware}/${slot.stock.slot}`).toBe(true);
        }
      }
    });
});
