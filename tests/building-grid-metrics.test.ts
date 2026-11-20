import { MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG,getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getPlacedBuildingLogistics, getRomanBuildingGridMetrics } from "../src/render-common/buildings/building-grid-metrics";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { ROMAN_MILL_ROTOR_RADIUS } from "../src/render-common/buildings/roman-mill-dimensions";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";

const material = new MeshStandardMaterial();
const surfaces: BuildingSurface[] = ["mosaic", "rope", "paint", "plaster", "stone", "wood", "bark", "endgrain",
  "fish", "sacking", "straw", "amber", "copper", "cut-stone", "bread", "roof", "steel", "iron", "cloth", "leaf", "dark", "gold"];
const materials = Object.fromEntries(surfaces.map((surface) => [surface, material])) as
  Record<BuildingSurface, MeshStandardMaterial>;

describe("shared Roman door and plot metrics", () => {
  it("Mill retains its authored portal and clear sail sweep", () => {
    const definition = getBuildingDefinition(31);
    const model = createRomanBuilding(definition, materials, true);
    const scale = getRomanBuildingGridMetrics(definition).scale;
    expect((model.recipe.mechanism[1] - ROMAN_MILL_ROTOR_RADIUS) * scale).toBeGreaterThanOrEqual(1.0625 + 0.12);
    expect(model.recipe.doorDimensions!.spring).toBe(0.63);
    expect(model.recipe.doorDimensions!.width).toBe(0.46);
    model.dispose();
  });
  it.each(BUILDING_CATALOG)("$name uses identical gameplay and rendered door centers in every rotation", (definition) => {
    for (const detailed of [true, false]) {
      const model = createRomanBuilding(definition, materials, detailed);
      model.fitToGrid();
      expect(model.root.scale.x).toBe(getRomanBuildingGridMetrics(definition).scale);
      for (let rotation = 0; rotation < 4; rotation++) {
        model.root.position.set(12.5, 0, 8.5);
        model.root.rotation.y = rotation * Math.PI / 2;
        model.root.updateMatrixWorld(true);
        const rendered = model.root.localToWorld(new Vector3(model.recipe.workerExit[0], 0, model.recipe.door[2]));
        const logistics = getPlacedBuildingLogistics(definition.id, 12.5, 8.5, rotation);
        if (definition.style === "well") {
          expect(logistics.hasDoor).toBe(false);
          expect(logistics.doorThreshold).toEqual(logistics.workerApproach);
        } else if (definition.id === 7) {
          // The standalone monument has an exterior service approach, with no staffed interior.
          expect(logistics.hasDoor).toBe(false);
          expect(logistics.doorThreshold.x).toBeCloseTo(rendered.x, 8);
          expect(logistics.doorThreshold.z).toBeCloseTo(rendered.z, 8);
        } else {
          expect(logistics.hasDoor).toBe(true);
          expect(logistics.doorThreshold.x).toBeCloseTo(rendered.x, 8);
          expect(logistics.doorThreshold.z).toBeCloseTo(rendered.z, 8);
        }
        expect(Number.isInteger(logistics.road.x * 2)).toBe(true);
        expect(Number.isInteger(logistics.road.z * 2)).toBe(true);
        const dx = logistics.road.x - 12.5, dz = logistics.road.z - 8.5;
        const width = rotation % 2 ? definition.gridFootprint[1] : definition.gridFootprint[0];
        const depth = rotation % 2 ? definition.gridFootprint[0] : definition.gridFootprint[1];
        expect(Math.abs(dx) > width / 2 || Math.abs(dz) > depth / 2).toBe(true);
      }
      model.dispose();
    }
  });
});
