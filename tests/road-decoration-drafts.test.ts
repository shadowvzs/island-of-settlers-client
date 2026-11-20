import { Box3, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { chineseRoadPailouParts, nubianRoadPortalParts, persianRoadPortalParts }
  from "../src/render-common/road-decoration-eastern";
import { createRoadDecorationRecipe } from "../src/render-common/road-decoration-models";
import type { RoadDecorationPart } from "../src/render-common/road-decoration-recipe";
import { floweringRoadPergolaParts, roadsideFlowerPotParts, vikingRoadPortalParts }
  from "../src/render-common/road-decoration-timber";
import { createRoadDecorationModel } from "../src/renderers/three/road-decoration-model";
import { ROAD_DECORATIONS, type RoadDecorationDefinition } from "../src/shared/settlement/road-decoration-catalog";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

const draft = (definition: RoadDecorationDefinition, detailed: boolean): RoadDecorationPart[] => {
  if (definition.family === "pailou") return chineseRoadPailouParts(definition, detailed);
  if (definition.family === "persian-portal") return persianRoadPortalParts(definition, detailed);
  if (definition.family === "nubian-portal") return nubianRoadPortalParts(definition, detailed);
  if (definition.family === "timber-portal") return vikingRoadPortalParts(definition, detailed);
  if (definition.family === "pergola") return floweringRoadPergolaParts(definition, detailed);
  return roadsideFlowerPotParts(definition, detailed);
};

describe("remaining nation road-decoration authoring helpers", () => {
  for (const definition of ROAD_DECORATIONS.filter(definition =>
    !["roman-arch", "torii", "stone-lantern", "maya-portal"].includes(definition.family)))
    it.each([true, false])(`${definition.id} supports its open prism and cap (High=%s)`, detailed => {
      const materials = createPlainBuildingMaterials();
      expect(createRoadDecorationRecipe(definition, detailed).parts).toEqual(draft(definition, detailed));
      const model = createRoadDecorationModel({ definition, parts: draft(definition, detailed), wind: 0 }, materials, detailed);
      model.root.updateMatrixWorld(true);
      try {
        expect(model.triangles).toBeLessThanOrEqual(definition.triangles[detailed ? 0 : 1]);
        expect(new Box3().setFromObject(model.root).min.y).toBeGreaterThanOrEqual(-.001);
        if (definition.opening) {
          const ray = new Raycaster();
          for (const x of [-.49, -.25, 0, .25, .49]) for (const y of [.05, .6, 1.1, 1.65, 2.08]) {
            ray.set(new Vector3(x * definition.opening.width, y, 2), new Vector3(0, 0, -1));
            expect(ray.intersectObject(model.root, true), `blocked x=${x},y=${y}`).toHaveLength(0);
          }
        }
      } finally {
        model.dispose(); Object.values(materials).forEach(material => material.dispose());
      }
    });
});
