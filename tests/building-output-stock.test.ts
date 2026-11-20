import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { PRODUCTION_RULES } from "../src/shared/settlement/production-rules";

const material = new MeshStandardMaterial();
const surfaces: BuildingSurface[] = [
  "mosaic", "rope",
  "paint",
  "plaster",
  "stone",
  "wood",
  "bark",
  "endgrain",
  "fish",
  "sacking",
  "straw",
  "amber", "copper", "cut-stone", "bread",
  "roof",
  "steel",
  "iron",
  "cloth",
  "leaf",
  "dark",
  "gold"
];
const materials = Object.fromEntries(surfaces.map((surface) => [surface, material])) as Record<
  BuildingSurface,
  MeshStandardMaterial
>;

const examples = Object.entries(PRODUCTION_RULES)
  .filter(([, rule]) => !rule.service && rule.outputs.length > 0 && rule.outputs[0] !== "horse")
  .map(([id, rule]) => [Number(id), rule.outputs[0]!] as const);
describe("inventory-linked exterior outputs", () => {
  it.each(examples)("building %i displays %s without hiding permanent props", (id, ware) => {
    for (const detailed of [true, false]) {
      const model = createRomanBuilding(getBuildingDefinition(id), materials, detailed);
      const currentOutputs = () => {
        const objects: typeof model.root.children = [];
        model.root.traverse(object => { if (object.userData.stock?.kind === "output") objects.push(object); });
        return objects;
      };
      let outputs = currentOutputs();
      const capacity = id === 18 ? 9 : 6;
      expect(new Set(outputs.map((object) => object.userData.stock.slot)).size).toBe(capacity);
      const update = (outputStock?: Record<string, number>) =>
        model.update(1, {
          construction: 1,
          working: false,
          door: 0,
          outputStock
        });
      update();
      const permanent: typeof model.root.children = [];
      model.root.traverse((object) => {
        if (!object.userData.stock && object.visible) permanent.push(object);
      });
      expect(outputs.every((object) => object.visible)).toBe(true);
      for (const count of [0, 1, 6, capacity]) {
        update({ [ware]: count });
        outputs = currentOutputs();
        const slots = new Set(
          outputs.filter((object) => object.visible).map((object) => object.userData.stock.slot)
        );
        expect(slots.size).toBe(count);
        for (const object of permanent) expect(object.visible).toBe(true);
        for (const object of outputs)
          expect(object.visible).toBe(object.userData.stock.slot < count);
      }
      update({});
      outputs = currentOutputs();
      expect(outputs.every((object) => !object.visible)).toBe(true);
      update();
      outputs = currentOutputs();
      expect(outputs.every((object) => object.visible)).toBe(true);
      model.dispose();
    }
  });
});
