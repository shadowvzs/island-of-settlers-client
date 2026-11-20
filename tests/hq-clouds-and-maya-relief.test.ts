import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { addChineseHeadquartersClouds } from "../src/render-common/buildings/chinese-headquarters-clouds";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createMayaCivicMask } from "../src/render-common/props/maya-civic-mask";
import { createMayaCivicMaskGeometry } from "../src/renderers/three/buildings/maya-civic-mask-geometry";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";
import { unsupportedParts } from "./helpers/recipe-supports";

it.each([true, false])("keeps the cloud paintings on the two unobstructed front panels (%s)", detailed => {
  const parts: BuildingPart[] = [];
  addChineseHeadquartersClouds(part => parts.push(part as BuildingPart), detailed);
  expect(new Set(parts.map(part => Math.sign(part.position[0])))).toEqual(new Set([-1, 1]));
  expect(parts.length * 2).toBeLessThanOrEqual(260);
  for (const part of parts) {
    expect(["paint-stroke", "cloud-paint"]).toContain(part.shape);
    expect(Math.abs(part.position[0])).toBeGreaterThan(.055);
    expect(Math.abs(part.position[0])).toBeLessThan(.66);
    expect(part.position[1]).toBeGreaterThan(1.4);
    expect(part.position[1]).toBeLessThan(1.89);
    expect(Math.abs(part.position[2] - .6165)).toBeLessThan(.001);
    expect(part.size.every(value => value > 0)).toBe(true);
  }
});

it.each([true, false])("keeps the authored HQ features, support chains and actual mesh caps (%s)", detailed => {
  const definition = getBuildingDefinition(0);
  for (const nation of ["maya", "chinese"] as const) {
    const recipe = leveledBuildingRecipe(definition, nation, detailed, 1);
    const feature = nation === "maya" ? "maya-civic-mask" : "paint-stroke";
    expect(recipe.parts.filter(part => part.shape === feature).length).toBeGreaterThanOrEqual(2);
    expect(unsupportedParts(recipe)).toEqual([]);
    const materials = createPlainBuildingMaterials();
    const model = createRomanBuilding(definition, materials, detailed, recipe, nation);
    const triangles = model.triangles(false);
    console.info(`${nation} HQ/${detailed ? "High" : "Minimal"}: ${triangles} triangles`);
    expect(triangles).toBeLessThanOrEqual(nationTriangleBudget(nation, 0)[detailed ? 0 : 1]);
    if (nation === "chinese") {
      model.root.updateMatrixWorld(true);
      const clouds = recipe.parts.filter(part => ["paint-stroke", "cloud-paint"].includes(part.shape) && Math.abs(part.position[2] - .6165) < .001);
      const visible = clouds.filter(part => {
        let [x, y] = part.position;
        if (part.shape === "cloud-paint") {
          const dx = (part.topOffset?.[0] ?? 0) / 3, dy = -part.size[1] / 6;
          const yaw = part.rotation?.[2] ?? 0;
          x += dx * Math.cos(yaw) - dy * Math.sin(yaw);
          y += dx * Math.sin(yaw) + dy * Math.cos(yaw);
        }
        const hits = new Raycaster(new Vector3(x, y, 5), new Vector3(0, 0, -1)).intersectObject(model.root, true);
        return hits.length && Math.abs(hits[0]!.point.z - .6165) < .001;
      });
      expect(visible.length).toBeGreaterThan(clouds.length * .7);
    }
    model.dispose(); Object.values(materials).forEach(material => material.dispose());
  }
});

it.each([true, false])("models a closed static mask with real facial relief inside its LOD budget (%s)", detailed => {
  const mesh = createMayaCivicMask(detailed), geometry = createMayaCivicMaskGeometry(detailed);
  expect(mesh.indices.length / 3).toBeLessThanOrEqual(detailed ? 1700 : 1200);
  expect(Array.from(mesh.wind).every(value => value === 0)).toBe(true);
  const material = new MeshBasicMaterial(), object = new Mesh(geometry, material); object.updateMatrixWorld(true);
  const face = (x: number, y: number) => new Raycaster(new Vector3(x, y, 2), new Vector3(0, 0, -1))
    .intersectObject(object)[0]!.point.z;
  expect(face(0, .015) - face(.23, -.075)).toBeGreaterThan(.2);
  expect(face(.16, .135)).toBeGreaterThan(face(.16, .068));
  expect(geometry.boundingBox!.min.toArray()).toEqual([-.5, -.5, -.5]);
  expect(geometry.boundingBox!.max.z).toBeLessThanOrEqual(.5);
  const backing = new Raycaster(new Vector3(0, 0, -2), new Vector3(0, 0, 1)).intersectObject(object);
  expect(backing[0]!.point.z).toBeCloseTo(-.5);
  geometry.dispose(); material.dispose();
});
