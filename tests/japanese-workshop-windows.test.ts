import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { JAPANESE_OPEN_WORKSHOPS } from "../src/render-common/buildings/japanese-workshop-windows";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createLevelPlanRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { createRomanBuilding, createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials, stubPaintCanvas } from "./helpers/building-materials";

it.each([true, false])("keeps Japanese workshop and HQ window sightlines clear at every tier (%s)", detailed => {
  const material = new MeshBasicMaterial({ side: DoubleSide });
  try {
    for (const id of [0, ...JAPANESE_OPEN_WORKSHOPS]) for (const level of [1, 2, 3, 4, 5] as const) {
      const recipe = leveledBuildingRecipe(getBuildingDefinition(id), "japanese", detailed, level);
      const panes = recipe.parts.filter(part => part.windowShadow && !part.doorwayShadow);
      if (detailed || ![19, 43, 47, 51, 55].includes(id))
        expect(panes.length, `${id}/${level}: authored windows`).toBeGreaterThan(0);
      const obstacles = recipe.parts.filter(part => !part.windowShadow && !part.stock).map(part => {
        const mesh = new Mesh(createRomanPartGeometry(part, detailed), material);
        mesh.userData.part = { shape: part.shape, surface: part.surface, position: part.position, size: part.size };
        return mesh;
      });
      try {
        for (const pane of panes) {
          const at = pane.windowOpeningPosition!, size = pane.windowOpeningSize!;
          if (id !== 0 && at[1] > 1.4) continue; // Roof ventilation is separate from the workshop wall window.
          const across = size[0] < size[2] ? 0 : 2, along = across === 0 ? 2 : 0;
          const sign = Math.sign(at[across]) || 1;
          // The ray crosses the complete .07 wall and recessed plane. The pagoda's sloping
          // roof/floor farther inside the room is real structure, not a false window fill.
          for (const x of [-.32, 0, .32]) for (const y of [-.3, 0, .3]) {
            const start = new Vector3(...at), direction = new Vector3();
            start.setComponent(across, start.getComponent(across) + sign * .12);
            start.setComponent(along, start.getComponent(along) + x * size[along]); start.y += y * size[1];
            direction.setComponent(across, -sign);
            const hits = new Raycaster(start, direction, 0, .20).intersectObjects(obstacles)
              .map(hit => ({ distance: hit.distance, ...hit.object.userData.part }));
            expect(hits, `${id}/${level}/${JSON.stringify(at)}: clear window`).toEqual([]);
          }
        }
      } finally { obstacles.forEach(mesh => mesh.geometry.dispose()); }
    }
  } finally { material.dispose(); }
});

it("removes the Japanese specialist wall trellis and keeps productive nursery stock", () => {
  for (const detailed of [true, false]) for (const id of [41, 45, 49, 53]) {
    const recipe = leveledBuildingRecipe(getBuildingDefinition(id), "japanese", detailed, 5);
    expect(recipe.parts.filter(part => !part.stock && !part.workyardAssembly && part.surface === "leaf" &&
      part.position[2] < .8 && part.position[1] > .45)).toEqual([]);
    expect(recipe.parts.some(part => part.workyardAssembly === "resource-20")).toBe(true);
    expect(recipe.parts.some(part => part.shape === "forester-tree-sign")).toBe(true);
  }
});

it("preserves all physical anchors and budgets, with one exact50%black material", () => {
  stubPaintCanvas();
  const materials = createPlainBuildingMaterials();
  try {
    for (const detailed of [true, false]) for (const id of [0, ...JAPANESE_OPEN_WORKSHOPS])
      for (const level of [1, 2, 3, 4, 5] as const) {
        const definition = getBuildingDefinition(id), recipe = leveledBuildingRecipe(definition, "japanese", detailed, level);
        const original = createLevelPlanRecipe(definition, detailed, level).plan;
        for (const key of ["door", "doorDimensions", "doorProfile", "mechanism", "workerExit", "workPoint"] as const)
          expect(recipe[key], `${id}/${level}: ${key}`).toEqual(original[key]);
        const model = createRomanBuilding(definition, materials, detailed, recipe, "japanese");
        try {
          expect(model.triangles(false), `${id}/${level}: triangle budget`)
            .toBeLessThanOrEqual(nationTriangleBudget("japanese", id)[detailed ? 0 : 1]);
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
});
