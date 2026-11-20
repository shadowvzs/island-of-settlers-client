import { Mesh, type MeshStandardMaterial } from "three";
import { expect, it, vi } from "vitest";

import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { createWareModel } from "../src/renderers/three/settlement/ware-models";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it("one coin ware is one disc with two fitted stamped faces, with the same envelope for carry and compact stock", () => {
  for (const detailed of [true, false]) for (const compact of [true, false]) {
    const recipe = createWareRecipe("coins", detailed, compact);
    expect(recipe.parts.filter(part => part.surface === "gold" && part.shape === "cylinder")).toHaveLength(1);
    expect(recipe.parts.filter(part => part.surface === "paint")).toHaveLength(2);
    const bounds = recipe.parts.map(part => getRomanPartBounds(part));
    for (const axis of [0, 1, 2]) {
      const half = axis === 1 ? .01 : .07;
      expect(Math.min(...bounds.map(box => box.min[axis]!))).toBeCloseTo(-half, 8);
      expect(Math.max(...bounds.map(box => box.max[axis]!))).toBeCloseTo(half, 8);
    }
    expect(recipe.parts.every(part => part.radialSegments === (detailed ? 32 : 16))).toBe(true);
  }
});

it("all live coin models share stamped face material, release it once, and preserve borrowed gold", () => {
  const materials = createPlainBuildingMaterials(), borrowed = vi.fn();
  materials.gold.addEventListener("dispose", borrowed);
  const first = createWareModel("coins", true, materials), second = createWareModel("coins", true, materials);
  try {
    const faces = (model: typeof first) => {
      const selected: MeshStandardMaterial[] = [];
      model.root.traverse(object => {
        if (object instanceof Mesh && !Array.isArray(object.material) && object.material.map)
          selected.push(object.material as MeshStandardMaterial);
      });
      return selected;
    };
    expect(faces(first)).toHaveLength(2);
    expect(faces(first)[0]).toBe(faces(second)[0]);
    const face = faces(first)[0]!, freed = vi.fn(); face.addEventListener("dispose", freed);
    first.dispose(); expect(freed).not.toHaveBeenCalled();
    second.dispose(); second.dispose(); expect(freed).toHaveBeenCalledOnce();
    expect(borrowed).not.toHaveBeenCalled();
  } finally {
    first.dispose(); second.dispose(); Object.values(materials).forEach(material => material.dispose());
  }
});
