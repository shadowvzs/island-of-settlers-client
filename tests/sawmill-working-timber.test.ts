import { Box3, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isBuildingCourtyardPointConnected } from "../src/render-common/buildings/building-courtyard";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { getRomanWareStockSlots } from "../src/render-common/buildings/roman-ware-stock";
import { WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";
import { createRomanBuilding, createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createWareModel } from "../src/renderers/three/settlement/ware-models";

const material = new MeshStandardMaterial();
const materials = Object.fromEntries(["mosaic", "rope", "paint", "plaster", "stone", "wood", "roof", "steel",
  "iron", "cloth", "leaf", "dark", "gold", "bark", "endgrain", "fish", "sacking", "straw", "amber"]
  .map(surface => [surface, material])) as Record<BuildingSurface, MeshStandardMaterial>;
const definition = getBuildingDefinition(33);

describe("sawmill cuts transported timber and exposes its output", () => {
  for (const detailed of [true, false]) it(`keeps exact cargo size and blade/table clearance at ${detailed ? "High" : "Minimal"}`, () => {
    const model = createRomanBuilding(definition, materials, detailed); model.fitToGrid();
    const recipe = model.recipe, scale = getRomanBuildingWorldSizing(definition).scale;
    const body = recipe.parts.find(part => !part.stock && part.surface === "bark")!;
    const parts = recipe.parts.filter(part => !part.stock &&
      (part.surface === "bark" || part.surface === "endgrain") &&
      Math.abs(part.position[0] - body.position[0]) <= body.size[0] * .55 &&
      Math.abs(part.position[1] - body.position[1]) <= body.size[0] * .55 &&
      Math.abs(part.position[2] - body.position[2]) <= body.size[1] * .55);
    const timber = new Group(); timber.scale.setScalar(scale);
    for (const part of parts) timber.add(new Mesh(createRomanPartGeometry(part, detailed), material));
    timber.updateMatrixWorld(true);
    const actual = new Box3().setFromObject(timber), cargo = createWareModel("logs", detailed, materials);
    cargo.root.scale.setScalar(WORKER_SCALE); cargo.root.updateMatrixWorld(true);
    const size = actual.getSize(new Vector3()), target = new Box3().setFromObject(cargo.root).getSize(new Vector3());
    for (const axis of ["x", "y", "z"] as const) expect(size[axis]).toBeCloseTo(target[axis], 6);
    const table = recipe.parts.find(part => part.surface === "wood" && part.stage === 2 &&
      Math.abs(part.position[0] - body.position[0]) < .001 && Math.abs(part.position[2] - body.position[2]) < .001 &&
      Math.abs(part.size[1] - .065) < .001)!;
    const tableTop = (table.position[1] + table.size[1] / 2) * scale;
    expect(actual.min.y - tableTop).toBeGreaterThanOrEqual(-.001);
    expect(actual.min.y - tableTop).toBeLessThan(.002);
    const blade = model.root.getObjectByName("mechanism")!.children[0]!;
    let intersects = false;
    for (let sample = 0; sample <= 120; sample++) {
      model.update(sample / 20, { construction: 1, working: true, door: 0,
        inputStock: { logs: 6 }, outputStock: { planks: 6 } }); model.root.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(blade);
      expect(bounds.min.y).toBeGreaterThan(tableTop);
      intersects ||= bounds.min.y < actual.max.y;
    }
    expect(intersects).toBe(true);
    expect(model.triangles()).toBeLessThan(detailed ? 10000 : 1800);
    expect(definition.gridFootprint).toEqual([6, 5]);
    timber.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
    cargo.dispose(); model.dispose();
  });
  it("has six single front-left plank slots and reachable full-inventory contacts at every rotation", () => {
    const model = createRomanBuilding(definition, materials, true), recipe = model.recipe;
    const slots = getRomanWareStockSlots(recipe).filter(slot => slot.stock.ware === "planks");
    expect(slots).toHaveLength(6);
    for (const slot of slots) {
      expect(slot.parts).toHaveLength(3);
      expect(slot.center[0]).toBeLessThan(recipe.mechanism[0] - .4);
      expect(slot.center[2]).toBeGreaterThan(recipe.mechanism[2] + .8);
      for (let rotation = 0; rotation < 4; rotation++) {
        const contact = getBuildingStockContact(33, "output", "planks", slot.stock.slot, 20, 20,
          rotation, 0, { planks: 6 }, { logs: 6 })!;
        expect(isBuildingCourtyardPointConnected(33, 20, 20, rotation,
          { x: contact.approach[0], z: contact.approach[2] }, { planks: 6 }, { logs: 6 })).toBe(true);
      }
    }
    model.dispose();
  });
});
