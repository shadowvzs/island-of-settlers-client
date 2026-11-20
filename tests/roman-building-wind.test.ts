import { Mesh, MeshStandardMaterial, Vector3 } from "three";
import { expect, it } from "vitest";

import { type BuildingFrame,getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { type BuildingSurface,createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createRomanBuildingWindState, romanBuildingFlagPhase, updateRomanBuildingWindState } from "../src/renderers/three/buildings/roman-building-wind";
import { CATAPULT_HOME_YAW } from "../src/shared/settlement/catapult-cycle";

it.each([0, 1, 2, 3])("all Roman flags face world weather at quarter-turn %i", (turn) => {
  const material = new MeshStandardMaterial();
  for (const detailed of [true, false]) for (const type of [0, 1, 2, 4, 9]) {
    const frame: BuildingFrame = Object.freeze({ id: `${type}`, type, x: 10, y: 0, z: 12,
      rotation: turn * Math.PI / 2, construction: 1, working: false, door: 0,
      windStrength: 0.7, windDirection: 0.35 });
    const state = createRomanBuildingWindState();
    const definition = getBuildingDefinition(type);
    const recipe = createRomanBuildingRecipe(definition, detailed);
    const materials = Object.fromEntries(recipe.parts.map((part) => [part.surface, material])) as Record<BuildingSurface, MeshStandardMaterial>;
    materials.cloth = material;
    const model = createRomanBuilding(definition, materials, detailed);
    model.root.rotation.y = frame.rotation;
    const cloth = model.root.getObjectByName("player_flag_cloth") as Mesh;
    const weather = { windX: -0.4, windZ: 0.8 };
    expect(updateRomanBuildingWindState(state, frame, weather)).toBe(state);
    model.update(2, state, romanBuildingFlagPhase(frame));
    model.root.updateMatrixWorld(true);
    const heading = new Vector3(1, 0, 0).transformDirection(cloth.matrixWorld);
    const expected = new Vector3(weather.windX, 0, weather.windZ).normalize();
    expect(heading.distanceTo(expected)).toBeLessThan(0.000001);
    const windy = [...cloth.morphTargetInfluences!];
    updateRomanBuildingWindState(state, frame, { windX: 0, windZ: 0 });
    model.update(3, state, romanBuildingFlagPhase(frame));
    expect(cloth.morphTargetInfluences).toEqual(new Array(8).fill(0));
    updateRomanBuildingWindState(state, frame, weather);
    model.update(5, state, romanBuildingFlagPhase(frame));
    expect(cloth.morphTargetInfluences).not.toEqual(windy);
    expect(frame.windStrength).toBe(0.7);
    expect(frame.windDirection).toBe(0.35);
    model.dispose();
  }
  material.dispose();
});

it("clears omitted state and gives neighboring buildings independent cloth phases", () => {
  const state = createRomanBuildingWindState();
  const frame: BuildingFrame = { id: "test", type: 1, x: 0, y: 0, z: 0, rotation: 0,
    construction: 1, working: false, door: 0, doorLeaves: [0, 1], balconyDoor: 1, outputStock: { sword: 2 } };
  const weather = { windX: 0.3, windZ: 0.4 };
  updateRomanBuildingWindState(state, frame, weather);
  expect(state.windStrength).toBe(0.5);
  expect(state.outputStock).toBe(frame.outputStock);
  expect(state.doorLeaves).toEqual([0, 1]);
  delete frame.doorLeaves;
  delete frame.balconyDoor;
  delete frame.outputStock;
  updateRomanBuildingWindState(state, frame, weather);
  expect(state.balconyDoor).toBeUndefined();
  expect(state.outputStock).toBeUndefined();
  expect(state.doorLeaves).toBeUndefined();
  expect(romanBuildingFlagPhase(frame)).not.toBe(romanBuildingFlagPhase({ x: 1, z: 0 }));
});

it("forwards the Catapult action and aim through cached render state into the actual mechanism", () => {
  const definition = getBuildingDefinition(16), material = new MeshStandardMaterial();
  const recipe = createRomanBuildingRecipe(definition, false);
  const materials = Object.fromEntries(recipe.parts.map(part => [part.surface, material])) as
    Record<BuildingSurface, MeshStandardMaterial>;
  materials.cloth = material;
  const model = createRomanBuilding(definition, materials, false);
  const state = createRomanBuildingWindState();
  const frame: BuildingFrame = { id: "tower", type: 16, x: 0, y: 0, z: 0, rotation: 0,
    construction: 1, working: false, door: 0, catapultAim: .8,
    catapultCycle: { operator: 1, target: 2, phase: "clear", elapsed: 1.4 } };
  const weather = { windX: 0, windZ: 0 };
  model.update(0, updateRomanBuildingWindState(state, frame, weather));
  const arm = model.root.getObjectByName("catapult_arm")!;
  const stone = model.root.getObjectByName("catapult_loaded")!;
  expect(arm.rotation.y).toBeCloseTo(.8);
  expect(stone.visible).toBe(true);
  frame.catapultCycle = { operator: 1, target: 2, phase: "fire", elapsed: .2 };
  model.update(0, updateRomanBuildingWindState(state, frame, weather));
  expect(arm.rotation.x).toBeCloseTo(0);
  frame.catapultSupply = { ground: 1, porter: { actor: 3, phase: "stairs-up", elapsed: 1, carrying: true } };
  frame.catapultGroundPoints = [{ x: 2, y: .08, z: 2 }];
  frame.catapultCycle = { operator: 1, target: 2, phase: "loose", elapsed: 0, ammo: "loose",
    ammoPoint: [.3, 2.4, -.2], ammoFloor: 1.825, ammoElapsed: .1 };
  model.update(0, updateRomanBuildingWindState(state, frame, weather));
  expect(model.root.getObjectByName("catapult_hatch")!.rotation.z).toBeCloseTo(-Math.PI / 2);
  // Delivered ground stone stays the carriers' block; only the roof rack/cup hold round shot.
  expect(model.root.getObjectByName("catapult_ground_block_0")!.visible).toBe(true);
  expect(model.root.getObjectByName("catapult_ground_round_0")!.visible).toBe(false);
  expect(stone.visible).toBe(true);
  expect(stone.rotation.x).toBe(0);
  const fallingY = stone.position.y;
  frame.catapultCycle.ammoElapsed = .3;
  model.update(0, updateRomanBuildingWindState(state, frame, weather));
  expect(stone.position.y).toBeLessThan(fallingY);
  delete frame.catapultSupply; delete frame.catapultGroundPoints;
  delete frame.catapultCycle; delete frame.catapultAim;
  model.update(0, updateRomanBuildingWindState(state, frame, weather));
  expect(stone.visible).toBe(false);
  expect(arm.rotation.y).toBe(CATAPULT_HOME_YAW);
  model.dispose(); material.dispose();
});
