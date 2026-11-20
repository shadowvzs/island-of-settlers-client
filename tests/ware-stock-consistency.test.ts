import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isBuildingCourtyardPointConnected, isBuildingCourtyardPointWalkable } from "../src/render-common/buildings/building-courtyard";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createWareModel } from "../src/renderers/three/settlement/ware-models";

const material = new MeshStandardMaterial();
const surfaces = ["rope", "paint", "plaster", "stone", "wood", "steel", "iron", "cloth", "leaf", "dark",
  "gold", "bark", "endgrain", "fish", "sacking", "straw", "amber", "roof", "cut-stone", "bread"];
const materials = Object.fromEntries(surfaces.map(surface => [surface, material])) as Record<BuildingSurface, MeshStandardMaterial>;
const state = (outputStock: Record<string, number>) => ({ construction: 1, working: false, door: 0, inputStock: {}, outputStock });

describe("mixed production keeps real cargo sizes and live inventory", () => {
  for (const detailed of [true, false]) it(`forge swaps actual ware meshes at ${detailed ? "High" : "Minimal"}`, () => {
    const model = createRomanBuilding(getBuildingDefinition(25), materials, detailed); model.fitToGrid();
    const inventories: Record<string, number>[] = [{ axe: 2, shovel: 2, hammer: 1 }, { fishingRod: 3, scythe: 3 }, { crucible: 6 }, {}];
    for (const inventory of inventories) {
      model.update(0, state(inventory)); model.root.updateMatrixWorld(true);
      const slots = new Map<number, { ware: string; box: Box3 }>();
      model.root.traverse(object => {
        if (!(object instanceof Mesh) || !object.visible || object.userData.stock?.kind !== "output") return;
        const { slot, ware } = object.userData.stock;
        const record = slots.get(slot) ?? { ware, box: new Box3() };
        expect(record.ware).toBe(ware); record.box.union(new Box3().setFromObject(object)); slots.set(slot, record);
      });
      expect(slots.size).toBe(Object.values(inventory).reduce((sum, count) => sum + count, 0));
      for (const [ware, count] of Object.entries(inventory)) {
        expect([...slots.values()].filter(slot => slot.ware === ware)).toHaveLength(count);
        const carried = createWareModel(ware, detailed, materials); carried.root.scale.setScalar(WORKER_SCALE);
        carried.root.updateMatrixWorld(true); const size = new Box3().setFromObject(carried.root).getSize(new Vector3());
        for (const slot of slots.values()) if (slot.ware === ware) {
          const stockSize = slot.box.getSize(new Vector3());
          ["x", "y", "z"].forEach(axis => expect(stockSize[axis as "x" | "y" | "z"]).toBeCloseTo(size[axis as "x" | "y" | "z"], 7));
        }
        carried.dispose();
      }
      expect(model.triangles()).toBeLessThan(detailed ? 10000 : 1800);
    }
    model.dispose();
  });
  it("mixed alias pickup targets the ware that is actually displayed", () => {
    const inventory = { axe: 2, shovel: 2, hammer: 1 };
    const contact = getBuildingStockContact(25, "output", "shovel", 4, 0, 0, 0, 0, inventory, {})!;
    expect(contact.slot).toBe(3);
    contact.wareScale.forEach(scale => expect(scale).toBeCloseTo(WORKER_SCALE, 8));
  });
  it("empty input bays do not become phantom physical obstacles", () => {
    const contact = getBuildingStockContact(33, "input", "logs", 0, 20, 12, 0, 0, {}, {})!;
    const point = { x: contact.approach[0], z: contact.approach[2] };
    expect(isBuildingCourtyardPointWalkable(33, 20, 12, 0, point, {}, {})).toBe(true);
    expect(isBuildingCourtyardPointConnected(33, 20, 12, 0, point, {}, {})).toBe(true);
  });
});

it("keeps cached yard connectivity independent of later live inventory changes", () => {
  const stock = getBuildingStockContact(33, "input", "logs", 0, 0, 0, 0)!.stock;
  const candidates = Array.from({ length: 625 }, (_, index) => ({
    x: stock[0] + (index % 25 - 12) * .05, z: stock[2] + (Math.floor(index / 25) - 12) * .05
  }));
  const freedByEmptyBay = candidates.find(point =>
    isBuildingCourtyardPointWalkable(33, 0, 0, 0, point, {}, { coal: 1 }) &&
    !isBuildingCourtyardPointWalkable(33, 0, 0, 0, point, {}, { coal: 1, logs: 6 }) &&
    isBuildingCourtyardPointConnected(33, 0, 0, 0, point, {}, { grain: 1 }));
  expect(freedByEmptyBay).toBeDefined();
  // A live building inventory object seeds the cache, then changes after delivery.
  const liveInput: Record<string, number> = { coal: 1 };
  isBuildingCourtyardPointConnected(33, 0, 0, 0, freedByEmptyBay!, {}, liveInput);
  liveInput.logs = 6;
  expect(isBuildingCourtyardPointConnected(33, 0, 0, 0, freedByEmptyBay!, {}, { coal: 1 })).toBe(true);
});
