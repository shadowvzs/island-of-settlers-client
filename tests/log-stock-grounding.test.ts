import { Box3, MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isBuildingCourtyardPointConnected } from "../src/render-common/buildings/building-courtyard";
import type { BuildingPart,BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { addTimberLog } from "../src/render-common/wares/ware-timber-recipe";
import { WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";
import { createRomanBuilding, createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createWareModel } from "../src/renderers/three/settlement/ware-models";

const material = new MeshStandardMaterial();
const materials = Object.fromEntries(["mosaic", "rope", "paint", "plaster", "stone", "wood", "roof", "steel",
  "iron", "cloth", "leaf", "dark", "gold", "bark", "endgrain", "fish", "sacking", "straw", "amber"]
  .map(surface => [surface, material])) as Record<BuildingSurface, MeshStandardMaterial>;

describe("enlarged original trunks rest on real supports", () => {
  for (const detailed of [true, false]) it(`uniformly enlarges every original vertex at ${detailed ? "High" : "Minimal"}`, () => {
    const original: BuildingPart[] = [];
    addTimberLog((surface, position, size, stage, shape, rotation) => original.push({
      surface, position, size, stage: stage ?? 3, shape: shape ?? "box", rotation }), { detailed });
    const enlarged = createWareRecipe("logs", detailed).parts;
    expect(enlarged).toHaveLength(original.length);
    for (let index = 0; index < original.length; index++) {
      const before = createRomanPartGeometry(original[index]!, detailed);
      const after = createRomanPartGeometry(enlarged[index]!, detailed);
      const oldVertices = before.getAttribute("position"), newVertices = after.getAttribute("position");
      expect(newVertices.count).toBe(oldVertices.count);
      for (let vertex = 0; vertex < oldVertices.count; vertex++) for (const axis of [0, 1, 2])
        expect(newVertices.getComponent(vertex, axis)).toBeCloseTo(oldVertices.getComponent(vertex, axis) * 1.35, 7);
      before.dispose(); after.dispose();
    }
  });
  for (const detailed of [true, false]) it(`grounds both bottom logs and every subsequent row at ${detailed ? "High" : "Minimal"}`, () => {
    const model = createRomanBuilding(getBuildingDefinition(17), materials, detailed); model.fitToGrid();
    model.update(0, { construction: 1, working: false, door: 0, inputStock: {}, outputStock: { logs: 6 } });
    model.root.updateMatrixWorld(true);
    const boxes = Array.from({ length: 6 }, (_, slot) => {
      const stock = model.root.getObjectByName(`stock_output_${slot}_logs`)!;
      expect(stock).toBeDefined(); return new Box3().setFromObject(stock);
    });
    const cargo = createWareModel("logs", detailed, materials); cargo.root.scale.setScalar(WORKER_SCALE);
    cargo.root.rotation.y = Math.PI / 2; cargo.root.updateMatrixWorld(true);
    const target = new Box3().setFromObject(cargo.root).getSize(new Vector3());
    for (let slot = 0; slot < 6; slot++) {
      const box = boxes[slot]!, size = box.getSize(new Vector3());
      for (const axis of ["x", "y", "z"] as const) expect(size[axis]).toBeCloseTo(target[axis], 7);
      expect(box.min.y).toBeCloseTo(slot < 2 ? 0 : boxes[slot - 2]!.max.y, 7);
      for (let rotation = 0; rotation < 4; rotation++) {
        const contact = getBuildingStockContact(17, "output", "logs", slot, 20, 20, rotation, 0, { logs: 6 }, {})!;
        contact.wareScale.forEach(scale => expect(scale).toBeCloseTo(WORKER_SCALE, 8));
        expect(isBuildingCourtyardPointConnected(17, 20, 20, rotation,
          { x: contact.approach[0], z: contact.approach[2] }, { logs: 6 }, {})).toBe(true);
      }
    }
    expect(model.triangles()).toBeLessThan(detailed ? 10000 : 1800);
    cargo.dispose(); model.dispose();
  });
});
