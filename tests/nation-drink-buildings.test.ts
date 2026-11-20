import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createBuildingOccupationSymbolSvg } from "../src/render-common/buildings/building-occupation-symbol";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { NATION_DRINK_CHAINS } from "../src/shared/settlement/nation-drinks";

const NATIONS = ["viking", "japanese", "nubian"] as const;
const DRINK_CHAIN_WARES = ["grapes", "wine", "honey", "mead", "rice", "sake", "coconut", "toddy"];
const stockWares = (parts: ReturnType<typeof createNationBuildingRecipe>["parts"]) =>
  new Set(parts.flatMap(part => part.stock ? [part.stock.ware, ...(part.stock.wares ?? [])] : []));

describe("nation drink buildings", () => {
  for (const nation of NATIONS) for (const detailed of [true, false]) {
    const chain = NATION_DRINK_CHAINS[nation];
    it(`${nation} producer and maker keep their stock and drop the Roman vines/vat (detail ${detailed})`, () => {
      const producer = createNationBuildingRecipe(getBuildingDefinition(5)!, nation, detailed);
      const maker = createNationBuildingRecipe(getBuildingDefinition(6)!, nation, detailed);
      expect(stockWares(producer.parts).has(chain.raw)).toBe(true);
      expect(stockWares(maker.parts).has(chain.raw)).toBe(true);
      expect(stockWares(maker.parts).has(chain.drink)).toBe(true);
      expect(producer.parts.some(part => part.surface === "leaf" && part.shape === "sphere")).toBe(false);
      expect(producer.parts.some(part => part.shape === "vine-foliage")).toBe(false);
    });
  }

  it("keeps the Roman vineyard's trained vines and press", () => {
    const vineyard = createNationBuildingRecipe(getBuildingDefinition(5)!, "roman", true);
    expect(vineyard.parts.filter(part => part.shape === "vine-foliage")).toHaveLength(12);
  });

  it("paints each nation's drink pictogram on the signposts", () => {
    const roman = createBuildingOccupationSymbolSvg(getBuildingDefinition(5)!);
    for (const nation of NATIONS) for (const id of [5, 6]) {
      const svg = createBuildingOccupationSymbolSvg(getBuildingDefinition(id)!, nation);
      expect(svg).not.toBe(createBuildingOccupationSymbolSvg(getBuildingDefinition(id)!));
      expect(svg).toMatch(/<(rect|ellipse|polygon)/);
    }
    expect(createBuildingOccupationSymbolSvg(getBuildingDefinition(5)!, "roman")).toBe(roman);
  });
});

describe("drink chain wares", () => {
  for (const ware of DRINK_CHAIN_WARES) it(`${ware} has a full and a lean stock model`, () => {
    const full = createWareRecipe(ware, true), lean = createWareRecipe(ware, true, true);
    expect(full.id).toBe(ware);
    expect(full.parts.length).toBeGreaterThan(2);
    expect(lean.parts.length).toBeLessThanOrEqual(full.parts.length);
    for (const part of [...full.parts, ...lean.parts])
      expect([...part.position, ...part.size].every(Number.isFinite)).toBe(true);
  });
});
