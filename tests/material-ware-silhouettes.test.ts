import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { expect, it } from "vitest";

import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { CART_CARGO_LAYOUTS } from "../src/render-common/logistics/cart-cargo-layouts";
import { ADVANCED_MATERIAL_SOURCE_DATA } from "../src/render-common/wares/advanced-material-source-data";
import { timberVariantChunks } from "../src/render-common/wares/timber-variant-source";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { createWareModel } from "../src/renderers/three/settlement/ware-models";

const timber = ["hardwoodLogs", "cedarLogs", "walnutLogs", "mahoganyLogs",
  "hardwoodPlanks", "cedarPlanks", "walnutPlanks", "mahoganyPlanks"] as const;
const material = new MeshStandardMaterial();
const materials = Object.fromEntries(["cloth", "paint", "rope", "straw"].map(surface => [surface, material])) as
  Record<BuildingSurface, MeshStandardMaterial>;

it.each([true, false])("hardwood trunks have separate bark and complete cut faces without interpenetration (%s)",
  detailed => {
    const chunks = timberVariantChunks("hardwoodLogs", ADVANCED_MATERIAL_SOURCE_DATA.logs.chunks);
    expect(chunks.filter(chunk => chunk.material === 0)).toHaveLength(2);
    expect(chunks.filter(chunk => chunk.material === 1)).toHaveLength(4);
    const bounds = [chunks.slice(0, 3), chunks.slice(3, 6)].map(trunk => {
      const x = trunk.flatMap(chunk => {
        const positions = detailed ? chunk.position : chunk.minimalPosition ?? chunk.position;
        return positions.filter((_value, index) => index % 3 === 0);
      });
      return { min: Math.min(...x), max: Math.max(...x) };
    });
    expect(bounds[0]!.max).toBeLessThan(bounds[1]!.min);
  });

it.each([true, false])("timber species differ geometrically within their cargo envelopes (%s)", detailed => {
  const silhouettes: string[] = [];
  for (const id of timber) {
    const model = createWareModel(id, detailed, materials);
    const size = new Box3().setFromObject(model.root).getSize(new Vector3());
    const layout = CART_CARGO_LAYOUTS[id];
    expect(size.x).toBeCloseTo(layout.width / layout.scale, 6);
    expect(size.y).toBeCloseTo(layout.height / layout.scale, 6);
    expect(size.z).toBeCloseTo(layout.depth / layout.scale, 6);
    const geometry: number[] = [];
    model.root.traverse(object => {
      if (object instanceof Mesh) geometry.push(...object.geometry.getAttribute("position").array);
    });
    silhouettes.push(JSON.stringify(geometry));
    model.dispose();
  }
  expect(new Set(silhouettes).size).toBe(timber.length);
});

it.each([true, false])("flax keeps its detail and draw budget after batching (%s)", detailed => {
  const recipe = createWareRecipe("flax", detailed);
  const model = createWareModel("flax", detailed, materials);
  let meshes = 0;
  model.root.traverse(object => { if (object instanceof Mesh) meshes++; });
  expect(meshes).toBeLessThanOrEqual(2);
  expect(model.triangles()).toBeLessThan(detailed ? 3500 : 550);
  expect(model.recipe.parts).toEqual(recipe.parts);
  model.dispose();
});
