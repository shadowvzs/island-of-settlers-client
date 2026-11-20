import { Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it.each([true, false])("uses real openings in Persian civic and military buildings (%s)", detailed => {
  for (const id of [0, 2, 4, 9, 14]) {
    const recipe = createNationBuildingRecipe(getBuildingDefinition(id), "persian", detailed);
    const bodies = recipe.parts.filter(part => part.persianWindows?.length);
    const materials = createPlainBuildingMaterials();
    const model = createRomanBuilding(getBuildingDefinition(id), materials, detailed, recipe, "persian");
    model.root.updateMatrixWorld(true);
    expect(model.triangles(false)).toBeLessThanOrEqual(nationTriangleBudget("persian", id)[detailed ? 0 : 1]);
    for (const body of bodies.filter(part => part.militaryTower)) for (const window of body.persianWindows!) {
      if (window.bottom <= -.5 || window.spring >= .5) continue;
      const y = (window.bottom + window.spring) / 2, angle = window.angle + (body.rotation?.[1] ?? 0);
      const sx = 1 + ((body.topScale?.[0] ?? 1) - 1) * (y + .5);
      const sz = 1 + ((body.topScale?.[2] ?? 1) - 1) * (y + .5);
      const front = new Vector3(body.position[0] + Math.sin(angle) * body.size[0] * sx / 2,
        body.position[1] + y * body.size[1], body.position[2] + Math.cos(angle) * body.size[2] * sz / 2);
      const outward = new Vector3(Math.sin(angle), 0, Math.cos(angle));
      const ray = new Raycaster(front.clone().addScaledVector(outward, .25), outward.clone().negate(), 0, .27);
      expect(ray.intersectObject(model.root, true), `${id}/${detailed}/${window.angle}/clear`).toEqual([]);
    }
    model.dispose(); Object.values(materials).forEach(material => material.dispose());
    if (detailed || id === 0) expect(bodies.length, `${id}/${detailed}`).toBeGreaterThan(0);
    if (detailed && [2, 4, 9].includes(id)) expect(recipe.garrisonWindows?.length).toBeGreaterThan(0);
  }
});
