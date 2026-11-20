import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { BUILDING_CATALOG, getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { isChineseWindowLattice } from "../src/render-common/buildings/chinese-window-clearance";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createLevelPlanRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { createRomanBuilding, createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { checkTriangleBudget } from "../tools/bench/triangle-budget";
import { createPlainBuildingMaterials, stubPaintCanvas } from "./helpers/building-materials";

it.each([true, false])("keeps Chinese wall members out of every rectangular window aperture at every tier (%s)", detailed => {
  const material = new MeshBasicMaterial({ side: DoubleSide });
  try {
    for (const { id } of BUILDING_CATALOG) for (const level of [1, 2, 3, 4, 5] as const) {
      const recipe = leveledBuildingRecipe(getBuildingDefinition(id), "chinese", detailed, level);
      const panes = recipe.parts.filter(part => part.windowShadow && !part.doorwayShadow && !part.windowShadowDecorative);
      const obstacles = recipe.parts.filter(part => !part.windowShadow && !part.stock && ["box", "bevel-box", "cylinder"].includes(part.shape)).map(part => {
        const mesh = new Mesh(createRomanPartGeometry(part, detailed), material);
        mesh.userData.original = part;
        mesh.userData.part = { shape: part.shape, surface: part.surface, position: part.position, size: part.size };
        return mesh;
      });
      try {
        for (const pane of panes) {
          const at = pane.windowOpeningPosition!, size = pane.windowOpeningSize!;
          if (pane.windowShadowDecorative || pane.rotation || !at || !size || at[1] <= .4 || size[1] <= .15 || size[1] > .7 || Math.min(size[0], size[2]) >= .06) continue;
          const across = size[0] < size[2] ? 0 : 2, along = across === 0 ? 2 : 0;
          const sign = Math.sign(at[across]) || 1;
          // The ray crosses the complete wall and recessed plane. Broad working furnaces
          // and equipment farther outside the room are not wall battens or window infill.
          for (const x of [-.32, 0, .32]) for (const y of [-.3, 0, .3]) {
            const start = new Vector3(...at), direction = new Vector3();
            start.setComponent(across, start.getComponent(across) + sign * .12);
            start.setComponent(along, start.getComponent(along) + x * size[along]); start.y += y * size[1];
            direction.setComponent(across, -sign);
            const hits = new Raycaster(start, direction, 0, .20).intersectObjects(obstacles.filter(mesh => mesh.userData.original.size[across] <= .31 && !isChineseWindowLattice(mesh.userData.original, along, size[along], size[1])))
              .map(hit => ({ distance: hit.distance, ...hit.object.userData.part }));
            expect(hits, `${id}/${level}/${JSON.stringify(at)}: clear window`).toEqual([]);
          }
        }
      } finally { obstacles.forEach(mesh => mesh.geometry.dispose()); }
    }
  } finally { material.dispose(); }
}, 20_000);


it.each([true, false])("preserves Chinese anchors, stock contacts, budgets and exact black backing material (%s)", detailed => {
  stubPaintCanvas();
  const materials = createPlainBuildingMaterials();
  try {
    for (const definition of BUILDING_CATALOG) for (const level of [1, 2, 3, 4, 5] as const) {
      const recipe = leveledBuildingRecipe(definition, "chinese", detailed, level);
      const original = createLevelPlanRecipe(definition, detailed, level).plan;
      for (const key of ["door", "doorDimensions", "doorProfile", "mechanism", "workerExit", "workPoint"] as const)
        expect(recipe[key], `${definition.id}/${level}: ${key}`).toEqual(original[key]);
      if (definition.id === 16) continue; // The round catapult reveal has no rectangular wall-window members.
      const model = createRomanBuilding(definition, materials, detailed, recipe, "chinese");
      try {
        expect(checkTriangleBudget(model.triangles(false), nationTriangleBudget("chinese", definition.id)[detailed ? 0 : 1]),
          `${definition.id}/${level}: existing export budget policy`).not.toBe("fail");
        model.root.traverse(object => {
          if (!(object instanceof Mesh) || !object.userData.windowShadow) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            expect(material.opacity).toBe(.5); expect(material.transparent).toBe(true);
            expect(material.color.getHex()).toBe(0);
          }
        });
      } finally { model.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
}, 90_000);
