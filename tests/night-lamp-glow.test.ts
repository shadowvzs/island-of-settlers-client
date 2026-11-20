import { Mesh, MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import {
  isNightLampMesh, updateNightLampGlow
} from "../src/renderers/three/buildings/night-lamp-glow";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it("marks the Nubian wall lamp and the Japanese headquarters stone lantern as lamps", () => {
  const woodcutter = leveledBuildingRecipe(getBuildingDefinition(17), "nubian", true, 1);
  const wallLamp = woodcutter.parts.filter(part => part.surface === "amber");
  expect(wallLamp.length).toBeGreaterThan(0);
  expect(wallLamp.every(part => part.nightLamp === true)).toBe(true);

  const headquarters = leveledBuildingRecipe(getBuildingDefinition(0), "japanese", true, 4);
  const lanternPanes = headquarters.parts.filter(part => part.surface === "amber");
  expect(lanternPanes.length).toBe(2);
  expect(lanternPanes.every(part => part.nightLamp === true)).toBe(true);
});

it("glows only the marked lamp meshes at night and restores every day material", () => {
  const materials = createPlainBuildingMaterials(), definition = getBuildingDefinition(17);
  const recipe = leveledBuildingRecipe(definition, "nubian", true, 1);
  // An ordinary amber ornament proves the swap follows the marker, not the amber surface.
  const ornament: BuildingPart = { position: [.4, .2, .4], shape: "box", size: [.1, .1, .1], stage: 4,
    surface: "amber" };
  const building = createRomanBuilding(definition, materials, true,
    { ...recipe, parts: [...recipe.parts, ornament] }, "nubian");
  const lampMeshes: Mesh[] = [], ordinaryAmber: Mesh[] = [];
  try {
    building.root.traverse(object => {
      if (!(object instanceof Mesh) || object.userData.buildingSurface !== "amber") return;
      if (isNightLampMesh(object)) lampMeshes.push(object);
      else ordinaryAmber.push(object);
    });
    expect(lampMeshes.length).toBe(1);
    expect(ordinaryAmber.length).toBe(1);
    expect(ordinaryAmber[0]!.material).toBe(materials.amber);

    updateNightLampGlow(building.root, true);
    const glow = lampMeshes[0]!.material as MeshStandardMaterial;
    expect(glow.name).toBe("building-night-lamp-warm-glow");
    expect(glow.emissiveIntensity).toBe(2.4);
    expect(glow.emissiveMap).not.toBeNull();
    expect(ordinaryAmber[0]!.material).toBe(materials.amber);
    updateNightLampGlow(building.root, true);
    expect(lampMeshes[0]!.material).toBe(glow);

    updateNightLampGlow(building.root, false);
    expect(lampMeshes[0]!.material).toBe(materials.amber);
    expect(ordinaryAmber[0]!.material).toBe(materials.amber);
  } finally {
    building.dispose();
    Object.values(materials).forEach(material => material.dispose());
  }
});
