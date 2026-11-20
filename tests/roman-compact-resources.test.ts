import { Box3, MeshStandardMaterial, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanBuildingGridMetrics } from "../src/render-common/buildings/building-grid-metrics";
import {
  type BuildingSurface,
  createRomanBuildingRecipe} from "../src/render-common/buildings/building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
const material = new MeshStandardMaterial();
const surfaces: BuildingSurface[] = [
  "mosaic", "rope",
  "paint",
  "plaster",
  "stone",
  "wood",
  "bark",
  "endgrain",
  "fish",
  "sacking",
  "straw",
  "amber", "copper", "cut-stone", "bread",
  "roof",
  "steel",
  "iron",
  "cloth",
  "leaf",
  "dark",
  "gold"
];
const materials = Object.fromEntries(surfaces.map((surface) => [surface, material])) as Record<
  BuildingSurface,
  MeshStandardMaterial
>;
it.each([
  { id: 17, ware: "logs" },
  { id: 22, ware: "meat" },
  { id: 35, ware: "water" }
])(
  "$id keeps six readable stocks and moving parts inside its calculated plot",
  ({ id, ware }) => {
    const definition = getBuildingDefinition(id);
    const cells = definition.gridFootprint;
    if (id === 35) expect(cells).toEqual([2, 2]);
    expect(getRomanBuildingGridMetrics(definition).scale).toBeGreaterThan(0.85);
    for (const detailed of [true, false]) {
      const recipe = createRomanBuildingRecipe(definition, detailed);
      expect(
        [
          ...new Set(
            recipe.parts.filter((part) => part.stock?.ware === ware).map((part) => part.stock!.slot)
          )
        ].sort((a, b) => a - b)
      ).toEqual([0, 1, 2, 3, 4, 5]);
      const model = createRomanBuilding(definition, materials, detailed);
      model.fitToGrid();
      for (const time of [0, 1.5, 6, 12.5, 14]) {
        model.update(time, { construction: 1, door: 0, working: true });
        model.root.updateMatrixWorld(true);
        const bounds = new Box3().setFromObject(model.root);
        expect(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x))).toBeLessThan(
          cells[0]! / 2
        );
        expect(Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z))).toBeLessThan(
          cells[1]! / 2
        );
      }
      if (id === 35) {
        const bucket = model.root.getObjectByName("well_bucket")!;
        const raised = bucket.getWorldPosition(new Vector3()).y;
        for (let step = 1; step <= 60; step++)
          model.update(14 + step * 0.05, { construction: 1, door: 0, working: true });
        expect(bucket.getWorldPosition(new Vector3()).y).toBeLessThan(raised - 0.3);
        expect(model.root.getObjectByName("well_trough_water")).toBeDefined();
      }
      model.dispose();
    }
  }
);
