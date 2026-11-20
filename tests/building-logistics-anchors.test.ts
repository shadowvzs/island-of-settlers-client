import { MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import {
  type BuildingLogisticsAnchors,
  transformBuildingLogisticsAnchors} from "../src/render-common/buildings/building-logistics-anchors";
import {
  type BuildingSurface,
  createRomanBuildingRecipe,
  type Point3
} from "../src/render-common/buildings/building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";

const material = new MeshStandardMaterial();
const surfaces = new Set(
  BUILDING_CATALOG.flatMap((definition) =>
    createRomanBuildingRecipe(definition, true).parts.map((part) => part.surface)
  )
);
// Animated machinery also uses these surfaces even when absent from the static recipe.
for (const surface of ["steel", "wood", "dark", "cloth", "rope"] as BuildingSurface[])
  surfaces.add(surface);
const materials = Object.fromEntries([...surfaces].map((surface) => [surface, material])) as Record<
  BuildingSurface,
  MeshStandardMaterial
>;

it.each(BUILDING_CATALOG)(
  "$name reserves clear carrier service space on both LODs and all rotations",
  (definition) => {
    let highAnchors: BuildingLogisticsAnchors | undefined;
    for (const detailed of [true, false]) {
      const model = createRomanBuilding(definition, materials, detailed);
      const anchors = model.root.userData.gridPlacement.logistics as BuildingLogisticsAnchors;
      if (highAnchors) expect(anchors).toEqual(highAnchors);
      else highAnchors = anchors;
      const [width, depth] = definition.gridFootprint;
      expect(anchors.roadConnection[2]).toBe(depth / 2 + 1);
      expect(anchors.doorThreshold[0]).toBe(anchors.workerExit[0]);
      expect(
        Math.abs(anchors.carrierHandoff[0] - anchors.workerApproach[0])
      ).toBeGreaterThanOrEqual(0.4);
      expect(anchors.carrierQueue[1]![2] - anchors.carrierQueue[0]![2]).toBeCloseTo(0.28);
      const service = [anchors.carrierHandoff, anchors.carrierApproach, ...anchors.carrierQueue];
      for (const point of service) {
        expect(Math.abs(point[0])).toBeLessThan(width / 2);
        expect(point[2]).toBeGreaterThan(depth / 2);
        expect(point[2]).toBeLessThan(depth / 2 + 1);
        expect(point[1]).toBe(0);
      }
      for (const rotation of [0, 1, 2, 3]) {
        const rotated = transformBuildingLogisticsAnchors(anchors, rotation);
        const local = transformBuildingLogisticsAnchors(rotated, -rotation);
        expect(local).toEqual(anchors);
        const connection = rotated.roadConnection;
        const coordinate = rotation % 2 === 0 ? connection[2] : connection[0];
        expect(Math.abs(coordinate)).toBe(depth / 2 + 1);
        expect(rotated.carrierQueue).toHaveLength(2);
      }
      model.dispose();
    }
  }
);

it("translates anchors once in fitted grid units without mutating local metadata", () => {
  const model = createRomanBuilding(
    BUILDING_CATALOG.find((definition) => definition.id === 17)!,
    materials,
    false
  );
  const anchors = model.root.userData.gridPlacement.logistics as BuildingLogisticsAnchors;
  const snapshot = structuredClone(anchors);
  const origin: Point3 = [11, 2, -7];
  const translated = transformBuildingLogisticsAnchors(anchors, 0, origin);
  expect(translated.roadConnection).toEqual(
    anchors.roadConnection.map((value, index) => value + origin[index]!)
  );
  expect(anchors).toEqual(snapshot);
  model.dispose();
});
