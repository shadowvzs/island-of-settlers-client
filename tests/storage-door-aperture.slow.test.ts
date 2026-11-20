import { Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanBuildingGridMetrics } from "../src/render-common/buildings/building-grid-metrics";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import type { WorkerNation } from "../src/render-common/workers/worker-nation";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials, stubPaintCanvas } from "./helpers/building-materials";

const nations: WorkerNation[] = ["roman", "viking", "nubian", "japanese", "maya", "persian", "chinese", "indigenous"];

it("preserves two full civilian lanes through real storage frames, upgrades and independently moving leaves", () => {
  stubPaintCanvas();
  const materials = createPlainBuildingMaterials();
  try {
    for (const id of [0, 29, 39]) for (const nation of nations)
      for (const level of [1, 5] as const) for (const detailed of [true, false]) {
        const definition = getBuildingDefinition(id), scale = getRomanBuildingGridMetrics(definition).scale;
        const recipe = leveledBuildingRecipe(definition, nation, detailed, level);
        const model = createRomanBuilding(definition, materials, detailed, recipe, nation);
        try {
          model.fitToGrid();
          const state = { construction: 1, door: 1, inputStock: {}, outputStock: {}, working: false };
          model.update(0, state);
          const center = recipe.door[0] + recipe.doorDimensions!.width / 2;
          expect(recipe.doubleDoor).toBe(true);
          const doorway = model.root.getObjectByName("door")!;
          expect(doorway.getObjectByName("door_left")).toBeDefined();
          expect(doorway.getObjectByName("door_right")).toBeDefined();
          const tracks = model.root.animations.find(clip => clip.name === "door")!.tracks.map(track => track.name);
          expect(tracks).toContain("door_left.quaternion");
          expect(tracks).toContain("door_right.quaternion");
          const rayAt = (offset: number, height: number, yaw: number) => {
            const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
            const start = new Vector3(center * scale + offset, recipe.door[1] * scale + height,
              (recipe.door[2] + .18) * scale).applyAxisAngle(new Vector3(0, 1, 0), yaw);
            return new Raycaster(start, forward.negate(), 0, .5 * scale).intersectObject(model.root, true)
              .filter(hit => !hit.object.userData.windowShadow && !hit.object.userData.doorwayShadow);
          };
          for (const turn of [0, 1, 2, 3]) {
            const yaw = turn * Math.PI / 2;
            model.root.rotation.y = yaw; model.root.updateMatrixWorld(true);
            for (const offset of [-.45, -.25, -.05, .05, .25, .45]) for (const height of [.15, .55, .95, 1.075])
              expect(rayAt(offset, height, yaw), `${id}/${nation}/L${level}/${detailed}/r${turn}/${offset}/${height}`)
                .toHaveLength(0);
          }
          model.root.rotation.y = 0;
          model.update(1, { ...state, doorLeaves: [0, 1] }); model.root.updateMatrixWorld(true);
          expect(rayAt(-.25, .55, 0).some(hit => doorway.getObjectById(hit.object.id))).toBe(true);
          expect(rayAt(.25, .55, 0)).toHaveLength(0);
        } finally { model.dispose(); }
      }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});
