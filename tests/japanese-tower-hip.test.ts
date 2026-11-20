import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import {
  createLevelPlanRecipe, createNationBuildingRecipe
} from "../src/render-common/buildings/nation-building-recipe";
import { WORKER_HEIGHT } from "../src/render-common/workers/worker-dimensions";

it("transfers one lower hip cover to the three Japanese towers while preserving all gameplay contacts", () => {
  for (const id of [4, 14, 39]) for (const detailed of [true, false]) for (const level of [1, 2, 3, 4, 5] as const) {
    const definition = getBuildingDefinition(id), original = createLevelPlanRecipe(definition, detailed, level).plan;
    const recipe = createNationBuildingRecipe(definition, "japanese", detailed, level);
    const { parts: unusedOriginal, ...expected } = original;
    const { parts, ...actual } = recipe; void unusedOriginal;
    expect(actual, `${id}/${detailed}/${level} gameplay anchors`).toEqual(expected);
    const roofs = parts.filter(part => part.shape === "occupation-roof" && part.occupationRoof === "hip"
      && part.roofTiles === "pan-cover");
    expect(roofs).toHaveLength(1);
    expect(roofs[0]!.surface).toBe("roof-slate");
    const stocks = (list: typeof parts) => list.filter(part => part.stock)
      .map(part => ({ position: part.position, size: part.size, stock: part.stock }));
    expect(stocks(parts)).toEqual(stocks(original.parts));
    if (id === 39) expect(parts.filter(part => part.shape === "nation-roof" && !part.roofLayer)).toHaveLength(2);
    if (id !== 4) continue;
    const minimum = getRomanPartBounds(roofs[0]!).min[1];
    const deck = original.archerPositions![0]![1];
    expect(minimum - deck).toBeGreaterThan(WORKER_HEIGHT / getRomanBuildingWorldSizing(definition).scale + .08);
    expect(original.flagAnchor![1] + .44).toBeLessThan(minimum);
  }
});
