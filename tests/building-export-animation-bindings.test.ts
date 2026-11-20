import { PropertyBinding } from "three";
import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it.each([true, false])("binds every Indigenous exported entrance track to its real model (High=%s)", detailed => {
  const materials = createPlainBuildingMaterials(), missing: unknown[] = [];
  try {
    for (const definition of BUILDING_CATALOG) {
      if (definition.id === 7) continue; // supplied static Monument63 uses its own asset scene
      const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, 1);
      const model = createRomanBuilding(definition, materials, detailed, recipe, "indigenous");
      try {
        const clip = model.root.animations.find(clip => clip.name === "door")!;
        for (const track of clip.tracks) {
          const binding = PropertyBinding.parseTrackName(track.name);
          const target = PropertyBinding.findNode(model.root, binding.nodeName);
          if (!target) missing.push({ id: definition.id, track: track.name, tentDoor: recipe.tentDoor,
            hideDoor: recipe.hideDoor, hasWoodPivot: Boolean(model.root.getObjectByName("door")) });
        }
        if (definition.id === 18) {
          expect(clip.tracks.map(track => track.name)).toEqual(["door.quaternion"]);
          expect(Array.from(clip.tracks[0]!.values)).toEqual([0, 0, 0, 1, 0, 0, 0, 1,
            0, 0, 0, 1, 0, 0, 0, 1]);
        }
        if ([19, 43, 47, 51, 55].includes(definition.id)) {
          expect(clip.tracks[0]!.name).toBe("door.quaternion");
          expect(Array.from(clip.tracks[0]!.values.slice(4, 8))).not.toEqual([0, 0, 0, 1]);
        }
      } finally { model.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
  expect(missing).toEqual([]);
});
