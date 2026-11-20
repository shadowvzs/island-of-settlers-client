import { Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { createRubbleRoadArchRecipe } from "../src/render-common/road-decoration-rubble";
import { createRoadDecorationModel } from "../src/renderers/three/road-decoration-model";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it("rubble arch uses varied native stone topology, recessed mortar and a real open traffic prism", () => {
  const materials = createPlainBuildingMaterials();
  try {
    for (const detailed of [true, false]) {
      const recipe = createRubbleRoadArchRecipe(detailed), model = createRoadDecorationModel(recipe, materials, detailed);
      try {
        expect(model.triangles).toBeLessThanOrEqual(detailed ? 7_000 : 1_800);
        expect(recipe.parts.some(part => "kind" in part && part.kind === "rubble-stone")).toBe(true);
        expect(recipe.parts.some(part => "kind" in part && part.kind === "arch-stone" && part.mortar)).toBe(true);
        for (const part of recipe.parts) if ("kind" in part && part.kind === "arch-stone" && part.mortar) {
          expect(part.to - part.from).toBeLessThan(.007);
          expect(part.depth).toBeLessThan(.54);
        }
        model.root.updateMatrixWorld(true);
        for (const y of [.15, .8, 1.5, 2.1]) for (const x of [-.81, 0, .81]) {
          const ray = new Raycaster(new Vector3(x, y, 3), new Vector3(0, 0, -1));
          expect(ray.intersectObject(model.root, true), `${detailed}/${x}/${y}`).toHaveLength(0);
        }
      } finally { model.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});
