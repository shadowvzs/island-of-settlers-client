import { Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";

it.each([true, false])("HQ cupola is a supported hemisphere with a visible underside (high=%s)", detailed => {
  const recipe = createRomanBuildingRecipe(getBuildingDefinition(0), detailed);
  const dome = recipe.parts.find(part => part.shape === "dome")!;
  const geometry = createRomanPartGeometry(dome, detailed);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  expect(bounds.min.y).toBeCloseTo(dome.position[1], 6);
  expect(bounds.max.y).toBeCloseTo(dome.position[1] + dome.size[1] / 2, 6);
  const sharedBounds = getRomanPartBounds(dome);
  expect(sharedBounds.min[1]).toBeCloseTo(bounds.min.y, 6);
  expect(sharedBounds.max[1]).toBeCloseTo(bounds.max.y, 6);
  const rim = recipe.parts.find(part => part.shape === "ring" && part.surface === "paint")!;
  expect(rim.position[1] + rim.size[1] / 2).toBeCloseTo(bounds.min.y, 6);
  const statueBase = recipe.parts.find(part => part.surface === "stone" && part.shape === "bevel-box" &&
    part.size[0] === .24)!;
  expect(statueBase.position[1] - statueBase.size[1] / 2).toBeCloseTo(bounds.max.y, 6);
  const material = new MeshStandardMaterial();
  const mesh = new Mesh(geometry, material);
  mesh.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(0, bounds.min.y - .1, 0), new Vector3(0, 1, 0));
  expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
  expect(Array.from(geometry.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
  geometry.dispose(); material.dispose();
});

it.each([true, false])("HQ has a continuous ground door lane and twelve open loggia columns (high=%s)", detailed => {
  const recipe = createRomanBuildingRecipe(getBuildingDefinition(0), detailed);
  expect(recipe.door[0] + .23).toBe(0);
  expect(recipe.door[2] - .016).toBeCloseTo(.84, 8);
  expect(recipe.balconyDoor).toBeUndefined();
  const shafts = recipe.parts.filter(part => part.surface === "stone" && part.shape === "cylinder" &&
    part.size[0] === .1 && part.position[1] > 1.6);
  expect(shafts).toHaveLength(12);
  const ceilingParts = recipe.parts.filter(part => part.stage === 2 && part.shape === "box" &&
    Math.abs(part.position[1] - 1.415) < .00001 && part.surface === "stone");
  expect(ceilingParts).toHaveLength(4);
  const floor = recipe.parts.find(part => part.shape === "ring" && part.innerRadius !== undefined)!;
  expect(floor.innerRadius! * floor.size[0] * 2).toBeGreaterThan(.60);
  expect(ceilingParts.every(part => {
    const bounds = getRomanPartBounds(part);
    return !(bounds.min[0] < .299 && bounds.max[0] > -.299 && bounds.min[2] < .299 && bounds.max[2] > -.299);
  })).toBe(true);
  expect(ceilingParts.every(part => {
    const bounds = getRomanPartBounds(part);
    return !(bounds.min[0] < 0 && bounds.max[0] > 0 && bounds.min[2] < 0 && bounds.max[2] > 0);
  })).toBe(true);
  expect(recipe.parts.some(part => part.surface === "wood" && part.position[1] > 1.5 &&
    part.position[1] < 2.3)).toBe(true);
  expect(recipe.parts.some(part => part.surface === "stone" && part.stage === 0 &&
    part.position[1] < 0)).toBe(false);
});


it.each([true, false])("Caesar faces the actual entrance and retains painted face and toga (high=%s)", detailed => {
  const recipe = createRomanBuildingRecipe(getBuildingDefinition(0), detailed);
  const statue = recipe.parts.find(part => part.shape === "civic-statue")!;
  const geometry = createRomanPartGeometry(statue, detailed);
  const positions = geometry.getAttribute("position"), colors = geometry.getAttribute("color");
  const shades = new Set<string>();
  let front = -Infinity, rear = Infinity;
  for (let index = 0; index < positions.count; index++) {
    shades.add([colors.getX(index),colors.getY(index),colors.getZ(index)].map(value => value.toFixed(2)).join(","));
    if (positions.getY(index) > statue.position[1] + statue.size[1] * .325) {
      front = Math.max(front, positions.getZ(index) - statue.position[2]);
      rear = Math.min(rear, positions.getZ(index) - statue.position[2]);
    }
  }
  // The projecting face/nose points +Z, the same side as the actual doorway.
  expect(front).toBeGreaterThan(Math.abs(rear));
  expect(recipe.door[2]).toBeGreaterThan(0);
  expect(shades.size).toBeGreaterThanOrEqual(5);
  const faceRay = new Raycaster(new Vector3(statue.position[0],statue.position[1]+.405*statue.size[1],.3),new Vector3(0,0,-1));
  const material = new MeshStandardMaterial(), mesh = new Mesh(geometry,material);
  mesh.updateMatrixWorld(true);
  expect(faceRay.intersectObject(mesh).length).toBeGreaterThan(0);
  geometry.dispose(); material.dispose();
});


it.each([true, false])("HQ middle roof slopes around the accessible circular drum (high=%s)", detailed => {
  const recipe = createRomanBuildingRecipe(getBuildingDefinition(0),detailed);
  const roof = recipe.parts.find(part => part.shape === "civic-hipped-roof")!;
  const geometry = createRomanPartGeometry(roof,detailed);
  geometry.computeBoundingBox();
  expect(getRomanPartBounds(roof).min[1]).toBeCloseTo(geometry.boundingBox!.min.y,6);
  const position = geometry.getAttribute("position");
  let outer = Infinity, inner = -Infinity;
  for (let index = 0; index < position.count; index++) {
    const radius = Math.hypot(position.getX(index),position.getZ(index));
    if (radius > 1.05) outer = Math.min(outer,position.getY(index));
    if (radius < .82) inner = Math.max(inner,position.getY(index));
  }
  expect(inner - outer).toBeGreaterThan(.2);
  const material = new MeshStandardMaterial(), mesh = new Mesh(geometry,material);
  mesh.updateMatrixWorld(true);
  const hatch = new Raycaster(new Vector3(0,roof.position[1]-.5,0),new Vector3(0,1,0));
  expect(hatch.intersectObject(mesh)).toHaveLength(0);
  const floor = recipe.parts.find(part => part.shape === "ring" && part.innerRadius !== undefined)!;
  const furniture = recipe.parts.find(part => part.surface === "wood" && part.shape === "bevel-box" && part.size[1] === .25)!;
  const contact = furniture.position[1] - furniture.size[1]/2 - (floor.position[1]+floor.size[1]/2);
  expect(contact).toBeLessThanOrEqual(0);
  expect(contact).toBeGreaterThan(-.015);
  geometry.dispose(); material.dispose();
});

it("keeps dense individual cupola clay and a cheap Minimal shell within the HQ envelope", () => {
  const recipe = createRomanBuildingRecipe(getBuildingDefinition(0), true);
  const dome = recipe.parts.find(part => part.shape === "dome")!;
  const high = createRomanPartGeometry(dome, true);
  const minimal = createRomanPartGeometry(dome, false);
  expect(high.userData.roofTiles).toBeGreaterThan(220);
  expect(minimal.userData.roofTiles).toBe(0);
  expect(high.getAttribute("position").count / 3).toBeLessThan(2000);
  expect((minimal.index?.count ?? minimal.getAttribute("position").count) / 3).toBeLessThan(120);
  high.dispose(); minimal.dispose();
});
