import { describe, expect, it } from "vitest";

import { snapBuildingPlot } from "../src/app/settlement/building-plot";
import { nearestRoadSection } from "../src/app/settlement/placement-controls";
import { BUILDING_CATALOG, getBuildingDefinition } from "../src/render-common/buildings/building-catalog";

describe("live building footprint snapping", () => {
  it.each([2, 31])("rotates calculated rectangular plot %s and returns it after four turns", (id) => {
    const point = { x: 21.17, z: 14.11 };
    const [width, depth] = getBuildingDefinition(id).gridFootprint;
    expect(width).not.toBe(depth);
    const original = snapBuildingPlot(id, point, 0);
    const rotated = snapBuildingPlot(id, point, 1);
    expect([original.width, original.depth]).toEqual([width, depth]);
    expect([rotated.width, rotated.depth]).toEqual([depth, width]);
    expect(snapBuildingPlot(id, point, 4)).toEqual(original);
    expect(snapBuildingPlot(id, point, -3)).toEqual(rotated);
    expect(Number.isInteger(original.x - width / 2)).toBe(true);
    expect(Number.isInteger(rotated.z - width / 2)).toBe(true);
  });

  it("preserves integer terrain-cell corners and plot area for all models in all orientations", () => {
    for (const building of BUILDING_CATALOG) {
      for (let rotation = 0; rotation < 4; rotation++) {
        const plot = snapBuildingPlot(building.id, { x: 13.137, z: 7.919 }, rotation);
        expect(Number.isInteger(plot.x - plot.width / 2), building.name).toBe(true);
        expect(Number.isInteger(plot.z - plot.depth / 2), building.name).toBe(true);
        expect(plot.width * plot.depth).toBe(building.gridFootprint[0] * building.gridFootprint[1]);
      }
    }
  });
});


it("targets one road section under the cursor without snapping to building access", () => {
  const first = { start: { x: 2, z: 3 }, end: { x: 2.5, z: 3 } };
  const second = { start: first.end, end: { x: 3, z: 3 } };
  expect(nearestRoadSection({ x: 2.7, z: 3.15 }, [first, second])).toBe(second);
  expect(nearestRoadSection({ x: 2.3, z: 3 }, [first, second])).toBe(first);
  expect(nearestRoadSection({ x: 2.3, z: 4 }, [first, second])).toBeNull();
  expect(nearestRoadSection({ x: 2.3, z: 3 }, [])).toBeNull();
});
