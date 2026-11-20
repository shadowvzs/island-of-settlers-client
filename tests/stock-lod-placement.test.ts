import { MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { createNationBuilding } from "../src/renderers/three/buildings/nation-building";

it.each(["roman", "japanese", "chinese", "persian", "maya", "nubian", "indigenous", "viking"] as const)(
  "keeps actual %s stock model transforms identical across rendering LODs", nation => {
    const material = new MeshStandardMaterial();
    const materials = new Proxy({} as Record<BuildingSurface, MeshStandardMaterial>, { get: () => material });
    for (const typeId of [6, 28, 37]) for (const level of [1, 5] as const) {
      const high = createNationBuilding(getBuildingDefinition(typeId), materials, nation, true, level);
      const minimal = createNationBuilding(getBuildingDefinition(typeId), materials, nation, false, level);
      const state = { construction: 1, working: false, door: 0, inputStock: { grain: 3, water: 3 },
        outputStock: { wine: 6, pig: 6, grain: 6 } };
      high.update(0, state); minimal.update(0, state);
      let compared = 0;
      minimal.root.traverse(object => {
        if (!object.name.startsWith("stock_")) return;
        const other = high.root.getObjectByName(object.name);
        expect(other, `${nation}/${typeId}/${level}/${object.name}`).toBeDefined();
        expect(other!.position.toArray()).toEqual(object.position.toArray());
        expect(other!.rotation.toArray()).toEqual(object.rotation.toArray());
        expect(other!.scale.toArray()).toEqual(object.scale.toArray());
        compared++;
      });
      expect(compared).toBeGreaterThan(0);
      high.dispose(); minimal.dispose();
    }
    material.dispose();
  });
