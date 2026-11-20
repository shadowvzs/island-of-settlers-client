import { Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import {
  type BuildingSurface,
  createRomanBuildingRecipe} from "../src/render-common/buildings/building-recipe";
import {
  createRomanBuilding,
  createRomanPartGeometry
} from "../src/renderers/three/buildings/roman-building";

const material = new MeshStandardMaterial();
describe("round hollow well output buckets", () => {
  it.each([true, false])(
    "LOD detailed=%s has six open round buckets with recessed round water",
    (detailed) => {
      const recipe = createRomanBuildingRecipe(getBuildingDefinition(35), detailed);
      for (let slot = 0; slot < 6; slot++) {
        const parts = recipe.parts.filter(
          (part) => part.stock?.ware === "water" && part.stock.slot === slot
        );
        const body = parts.find((part) => part.surface === "wood" && part.shape === "ring")!;
        const water = parts.find((part) => part.surface === "paint" && part.shape === "cylinder")!;
        expect(body).toBeDefined();
        expect(parts.some((part) => part.surface === "iron" && part.shape === "ring")).toBe(true);
        const geometry = createRomanPartGeometry(body, detailed);
        const mesh = new Mesh(geometry, material);
        mesh.updateMatrixWorld(true);
        const ray = new Raycaster(
          new Vector3(body.position[0], body.position[1] + 1, body.position[2]),
          new Vector3(0, -1, 0)
        );
        expect(ray.intersectObject(mesh)).toHaveLength(0);
        const positions = geometry.getAttribute("position");
        const angles = new Set<number>();
        for (let vertex = 0; vertex < positions.count; vertex++) {
          const x = positions.getX(vertex) - body.position[0];
          const z = positions.getZ(vertex) - body.position[2];
          const radius = Math.hypot(x, z);
          expect(radius).toBeCloseTo(radius > 0.11 ? 0.12 : 0.096, 5);
          angles.add(Math.round(Math.atan2(x, z) * 1000));
        }
        expect(angles.size).toBeGreaterThanOrEqual(8);
        geometry.dispose();
        const waterGeometry = createRomanPartGeometry(water, detailed);
        waterGeometry.computeBoundingBox();
        expect(waterGeometry.boundingBox!.max.y).toBeLessThan(body.position[1] + body.size[1] / 2);
        const liquid = new Mesh(waterGeometry, material);
        liquid.updateMatrixWorld(true);
        expect(ray.intersectObject(liquid).length).toBeGreaterThan(0);
        waterGeometry.dispose();
      }
    }
  );
  it.each([true, false])(
    "LOD detailed=%s keeps all six buckets within its model budget",
    (detailed) => {
      const definition = getBuildingDefinition(35);
      const recipe = createRomanBuildingRecipe(definition, detailed);
      const materials = Object.fromEntries(
        recipe.parts.map((part) => [part.surface, material])
      ) as Record<BuildingSurface, MeshStandardMaterial>;
      const model = createRomanBuilding(definition, materials, detailed);
      let triangles = 0;
      model.root.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        triangles +=
          (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3;
      });
      expect(triangles).toBeLessThanOrEqual(detailed ? 10000 : 1800);
      model.dispose();
    }
  );
});
