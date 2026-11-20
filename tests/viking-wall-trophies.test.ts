import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { ornamentSize } from "../src/render-common/buildings/viking-ornament-boxes";

/** The main sculpt of every trophy kind: one per ornament placed. */
const AUTHORED = {
  "longship-relief": ornamentSize("longship-relief", .55)[0],
  "round-shield": ornamentSize("round-shield", .27)[0],
  "viking-helmet": ornamentSize("viking-helmet", .2)[0]
} as const;
const PLANNED: Readonly<Record<number, number>> = { 1: 2, 2: 1, 9: 1, 24: 2, 36: 1, 39: 1, 40: 1 };

const trophies = (id: number, detailed: boolean) => {
  const definition = BUILDING_CATALOG.find(building => building.id === id)!;
  return createNationBuildingRecipe(definition, "viking", detailed).parts
    .filter(part => part.nationDecor && part.shape in AUTHORED)
    .map(part => part.size[0] / AUTHORED[part.shape as keyof typeof AUTHORED]);
};

it.each([true, false])("keeps every Viking wall trophy and enlarges it where the wall has room (detail %s)",
  detailed => {
    const scales = Object.entries(PLANNED).flatMap(([id, count]) => {
      const found = trophies(Number(id), detailed);
      expect(found, `building ${id}`).toHaveLength(count);
      return found;
    });
    for (const scale of scales) {
      expect(scale).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(scale).toBeLessThanOrEqual(1.3 + 1e-9);
    }
    expect(scales.filter(scale => scale >= 1.2 - 1e-9).length).toBeGreaterThanOrEqual(scales.length - 1);
  });
