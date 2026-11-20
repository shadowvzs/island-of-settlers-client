import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { getPlacedBuildingLogistics } from "../src/render-common/buildings/building-grid-metrics";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { DEFAULT_ROMAN_DOOR } from "../src/render-common/buildings/roman-door-profile";
import { createRoadGeometry } from "../src/renderers/three/settlement/road-geometry";
import { createBuildingRoadApproaches } from "../src/shared/settlement/building-road-approaches";
import { fitStoneRoadWidths } from "../src/shared/settlement/road-fitted-widths";
import { ROAD_STONE_WIDTH, roadRibbonWidth } from "../src/shared/settlement/road-types";

const nations = ["roman", "viking", "nubian", "japanese"] as const;
describe("authored door opening road widths", () => {
  for (const nation of nations) for (const detailed of [true, false])
    it(`${nation} ${detailed ? "High" : "Minimal"}: every doorway ends at its actual clear opening in all rotations`, () => {
      for (const definition of BUILDING_CATALOG) for (let rotation = 0; rotation < 4; rotation++) {
        const logistics = getPlacedBuildingLogistics(definition.id, 30, 30, rotation);
        if (!logistics.hasDoor) continue;
        const building = { ...logistics, access: logistics.road, typeId: definition.id };
        const publicRoad = { start: building.access, end: { x: building.access.x, z: building.access.z + 1 }, tier: "stone" as const };
        const segments = createBuildingRoadApproaches([publicRoad], [building]);
        const doorway = segments.find(segment => segment.doorway)!;
        const recipe = createNationBuildingRecipe(definition, nation, detailed);
        const expected = (recipe.doorDimensions ?? DEFAULT_ROMAN_DOOR).width * getRomanBuildingWorldSizing(definition).scale;
        expect(roadRibbonWidth(doorway, 1), `building ${definition.id} rotation ${rotation}`).toBeCloseTo(expected, 10);
        // Fitting an old public road around obstructions must not shrink the authored doorway.
        const fitted = fitStoneRoadWidths(segments, { isBlocked: () => true });
        expect(roadRibbonWidth(fitted.find(segment => segment.doorway)!, 1)).toBeCloseTo(expected, 10);
        expect(publicRoad).toEqual({ start: building.access, end: { x: building.access.x, z: building.access.z + 1 }, tier: "stone" });
        expect(roadRibbonWidth(publicRoad, .5)).toBe(ROAD_STONE_WIDTH);
      }
    });
});


it("draws the exact full opening span at the final doorway mesh row", () => {
  for (const detailed of [true, false]) for (const width of [.7155555555555556, .6690909090909092]) {
    const segment = { start: { x: 0, z: 1 }, end: { x: 0, z: 0 }, tier: "stone" as const,
      doorway: true, doorwayWidth: width };
    const geometry = createRoadGeometry([segment], "stone", detailed, () => 0);
    const position = geometry.getAttribute("position");
    const xs: number[] = [];
    for (let index = 0; index < position.count; index++)
      if (Math.abs(position.getZ(index)) < 1e-5) xs.push(position.getX(index));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(width, 6);
    geometry.dispose();
  }
});
