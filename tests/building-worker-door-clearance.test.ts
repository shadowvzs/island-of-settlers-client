import { MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { getRomanBuildingGridMetrics } from "../src/render-common/buildings/building-grid-metrics";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { WORKER_HEIGHT, WORKER_RADIUS } from "../src/render-common/workers/worker-dimensions";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";

const material = new MeshStandardMaterial();
const surfaces: BuildingSurface[] = ["mosaic", "rope", "paint", "plaster", "stone", "wood", "roof", "steel", "iron",
  "cloth", "leaf", "dark", "gold", "bark", "endgrain", "fish", "sacking", "straw", "amber", "copper", "cut-stone", "bread"];
const materials = Object.fromEntries(surfaces.map((surface) => [surface, material])) as
  Record<BuildingSurface, MeshStandardMaterial>;

it.each(BUILDING_CATALOG.filter((definition) => definition.style !== "well"))(
  "$name admits the fixed 1.0625-high worker through its actual open doorway in both LODs and rotations",
  (definition) => {
    const { scale } = getRomanBuildingGridMetrics(definition);
    for (const detailed of [true, false]) {
      const model = createRomanBuilding(definition, materials, detailed);
      const dimensions = model.recipe.doorDimensions!;
      expect(dimensions.width * scale).toBeGreaterThanOrEqual(0.44);
      expect((model.recipe.doorProfile === "arched" ? dimensions.spring : dimensions.height) * scale)
        .toBeGreaterThanOrEqual(1.12 - 1e-6);
      model.root.scale.setScalar(scale);
      model.update(0, { construction: 1, working: false, door: 1 });
      const center = model.recipe.door[0] + dimensions.width / 2;
      for (let turn = 0; turn < 4; turn++) {
        const yaw = turn * Math.PI / 2;
        model.root.rotation.y = yaw;
        model.root.updateMatrixWorld(true);
        const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        for (const lateral of [-WORKER_RADIUS, 0, WORKER_RADIUS])
          for (const height of [0.04 * scale + 0.01, WORKER_HEIGHT / 2, WORKER_HEIGHT + 0.0125]) {
          const point = new Vector3(center * scale + lateral, height, model.recipe.door[2] * scale)
            .applyAxisAngle(new Vector3(0, 1, 0), yaw);
          const ray = new Raycaster(point.addScaledVector(forward, 0.15), forward.clone().negate(), 0, 0.30);
          expect(ray.intersectObject(model.root, true), `${definition.name}, detail:${detailed}, turn:${turn}, x:${lateral}, y:${height}`)
            .toHaveLength(0);
        }
      }
      model.dispose();
    }
  }
);
