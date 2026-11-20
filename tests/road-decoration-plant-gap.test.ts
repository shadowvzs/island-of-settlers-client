import { expect, it } from "vitest";

import { roadDecorationClearance } from "../src/render-common/road-decoration-clearance";
import { minimumRoadDecorationPlantGap, roadPlantEdgeGap, SMALL_ROAD_DECORATION_MARGIN }
  from "../src/render-common/road-decoration-plant-gap";
import { ROAD_DECORATIONS } from "../src/shared/settlement/road-decoration-catalog";

it("reserves measured small-decoration space between narrow plants and retains larger diameter gaps", () => {
  const floor = minimumRoadDecorationPlantGap();
  for (const definition of ROAD_DECORATIONS.filter(entry => ["flower-pot", "stone-lantern"].includes(entry.family))) {
    const volumes = roadDecorationClearance(definition).volumes;
    const extent = Math.max(...volumes.map(box => box.max[2])) - Math.min(...volumes.map(box => box.min[2]));
    expect(floor).toBeGreaterThanOrEqual(extent + SMALL_ROAD_DECORATION_MARGIN * 2);
  }
  expect(roadPlantEdgeGap(.12, .2)).toBe(floor);
  expect(roadPlantEdgeGap(.9, .7)).toBe(.9);
  expect(() => roadPlantEdgeGap(Number.NaN, .2)).toThrow("Invalid roadside plant diameter");
});
