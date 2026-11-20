import type { Mesh, MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { mayaKeptPart } from "../src/render-common/buildings/maya-building-walls";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

const builtMeshes = (detailed: boolean) => {
  const definition = getBuildingDefinition(0), materials = createPlainBuildingMaterials();
  const recipe = leveledBuildingRecipe(definition, "maya", detailed, 1);
  const model = createRomanBuilding(definition, materials, detailed, recipe, "maya");
  const meshes: Mesh[] = [];
  model.root.traverse(object => {
    if ((object as Mesh).isMesh === true) meshes.push(object as Mesh);
  });
  return { materials, meshes, model, recipe };
};

it.each([true, false])("keeps the Maya HQ portico as gilded shafts with a metal detail map (%s)",
  detailed => {
    const { materials, meshes, model, recipe } = builtMeshes(detailed);
    const columns = recipe.parts.filter(part => part.mayaGildedColumn === true);
    expect(columns.length).toBe(6);
    for (const column of columns) expect(column.surface).toBe("gold");
    if (detailed) for (const column of columns) expect(column.shape).toBe("civic-column-shaft");
    const column = meshes.find(mesh => (mesh.material as MeshStandardMaterial).name === "maya_gilded_column");
    expect(column).toBeDefined();
    const material = column!.material as MeshStandardMaterial;
    expect(material.vertexColors).toBe(true);
    expect(material.map).not.toBeNull();
    expect(material.normalMap === null).toBe(!detailed);
    expect(column!.geometry.getAttribute("color")).toBeDefined();
    model.dispose();
    Object.values(materials).forEach(entry => entry.dispose());
  });

it.each([true, false])("keeps the Maya yard figurine's painted vertex colours on a dedicated clay map (%s)",
  detailed => {
    const { materials, meshes, model, recipe } = builtMeshes(detailed);
    const figurine = recipe.parts.find(part => part.shape === "national-yard-sculpture");
    expect(figurine).toBeDefined();
    expect(figurine!.decorVariant).toBe(1);
    expect(figurine!.surface).toBe("plaster");
    const mesh = meshes.find(entry =>
      (entry.material as MeshStandardMaterial).name === "maya_yard_figurine");
    expect(mesh).toBeDefined();
    const material = mesh!.material as MeshStandardMaterial;
    expect(material.vertexColors).toBe(true);
    expect(material.map).not.toBeNull();
    expect(material.normalMap === null).toBe(!detailed);
    expect(mesh!.geometry.getAttribute("color")).toBeDefined();
    model.dispose();
    Object.values(materials).forEach(entry => entry.dispose());
  });

it("keeps wood civic columns fluted on the other Maya civic buildings", () => {
  const shaft: BuildingPart = { position: [0, .62, 1.5], shape: "civic-column-shaft",
    size: [.13, 1.24, .13], stage: 2, surface: "stone" };
  const wood = mayaKeptPart(shaft);
  expect(wood.shape).toBe("civic-column-shaft");
  expect(wood.surface).toBe("wood");
});
