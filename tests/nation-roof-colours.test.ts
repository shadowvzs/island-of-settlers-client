import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { ROOF_GEOMETRY_SURFACES } from "../src/render-common/buildings/nation-roof-colours";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";

const NATIONS: readonly WorkerNation[] = ["roman", "viking", "nubian", "japanese"];
const ROOF_SURFACES = new Set(["roof", ...ROOF_GEOMETRY_SURFACES]);
/** Natural tile-to-tile brightness variation is fine; a hue of its own is not. */
const MAX_CHANNEL_SPREAD = .08;

describe("retained production roof palette before candidate approval", () => {
  it.each(NATIONS.flatMap(nation => [true, false].map(detailed => [nation, detailed] as const)))(
    "%s production fallback has no unapproved per-building hue (high=%s)", (nation, detailed) => {
      for (const definition of BUILDING_CATALOG) {
        const roofs = createNationBuildingRecipe(definition, nation, detailed).parts
          .filter(part => ROOF_SURFACES.has(part.surface) && !part.roofLayer);
        for (const { tint } of roofs) {
          if (!tint) continue;
          expect(Math.max(...tint) - Math.min(...tint), `${nation} ${definition.id}`).toBeLessThan(MAX_CHANNEL_SPREAD);
        }
      }
    });

  it("Roman roofs are all clay tile surfaces (no thatch)", () => {
    for (const definition of BUILDING_CATALOG) for (const detailed of [true, false]) {
      const surfaces = createNationBuildingRecipe(definition, "roman", detailed).parts.map(part => part.surface);
      expect(surfaces, `${definition.id}`).not.toContain("roof-thatch");
    }
  });
});
