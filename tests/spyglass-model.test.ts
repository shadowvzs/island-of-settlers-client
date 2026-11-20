import { Box3, Mesh, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { spyglassParts } from "../src/render-common/wares/spyglass-parts";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { createSpyglassIconModel } from "../src/renderers/three/settlement/spyglass-icon-model";

describe("canonical spyglass model", () => {
  it.each([true, false])("keeps a complete nested telescope on detail %s", detailed => {
    const recipe = createWareRecipe("spyglass", detailed);
    expect(recipe.tool).toBe(true);
    const brass = recipe.parts.filter(part => part.surface === "gold");
    expect(new Set(brass.map(part => part.size[0])).size).toBeGreaterThanOrEqual(3);
    const lenses = recipe.parts.filter(part => part.surface === "steel");
    expect(lenses).toHaveLength(2);
    expect(lenses[0]!.size[0]).toBeLessThan(lenses[1]!.size[0]);
    // Every piece remains joined to the assembly rather than leaving a floating collar or lens.
    for (const part of recipe.parts) {
      const box = getRomanPartBounds(part);
      const attached = recipe.parts.some(other => {
        if (other === part) return false;
        const bounds = getRomanPartBounds(other);
        return [0, 1, 2].every(axis => box.min[axis]! <= bounds.max[axis]! + .001 &&
          box.max[axis]! + .001 >= bounds.min[axis]!);
      });
      expect(attached).toBe(true);
    }
  });

  it("uses fewer secondary collars for compact cargo while preserving the telescopic silhouette", () => {
    const full = createWareRecipe("spyglass", true), compact = createWareRecipe("spyglass", true, true);
    expect(compact.parts.length).toBeLessThan(full.parts.length);
    expect(compact.parts.filter(part => part.surface === "steel")).toHaveLength(2);
    expect(compact.parts.filter(part => part.surface === "paint")).toHaveLength(2);
  });

  it("renders complete circular bezels and disposes the original icon geometry", () => {
    const model = createSpyglassIconModel();
    expect(model.root.children).toHaveLength(spyglassParts(true).length + 2);
    expect(model.triangles()).toBeGreaterThan(500);
    expect(model.triangles()).toBeLessThan(12000);
    const bezel = model.root.children[6] as Mesh;
    bezel.geometry.computeBoundingBox();
    const extent = bezel.geometry.boundingBox!.getSize(new Vector3());
    expect(extent.x).toBeCloseTo(1);
    expect(extent.z).toBeCloseTo(1);
    const bounds = new Box3().setFromObject(model.root);
    expect(bounds.isEmpty()).toBe(false);
    model.dispose();
  });
});
