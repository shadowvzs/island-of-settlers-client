import { Mesh, Vector3 } from "three";
import { expect, it } from "vitest";

import { createPhoenixSculptureRecipe } from "../src/render-common/props/national-sculptures/phoenix-sculpture";
import { createQilinSculptureRecipe } from "../src/render-common/props/national-sculptures/qilin-sculpture";
import { createCulturalSculpture } from "../src/renderers/three/props/cultural-sculptures";
import { visibleMeshBounds } from "./helpers/visible-mesh-bounds";

it.each([true, false])("standalone cultural sculptures are serializable, volumetric and batch-compatible (High=%s)", detailed => {
  for (const kind of ["phoenix", "qilin"] as const) {
    const asset = createCulturalSculpture(kind, detailed, false), size = visibleMeshBounds(asset.root).getSize(new Vector3());
    const recipe = kind === "phoenix" ? createPhoenixSculptureRecipe(detailed) : createQilinSculptureRecipe(detailed);
    expect(JSON.parse(JSON.stringify(recipe))).toEqual(recipe);
    expect(recipe.mountOrigin).toEqual([0, 0, 0]);
    const bounds = visibleMeshBounds(asset.root);
    for (let axis = 0; axis < 3; axis++) {
      expect(bounds.min.getComponent(axis)).toBeGreaterThanOrEqual(recipe.bounds.min[axis]! - .00001);
      expect(bounds.max.getComponent(axis)).toBeLessThanOrEqual(recipe.bounds.max[axis]! + .00001);
    }
    expect(Math.min(size.x, size.y, size.z)).toBeGreaterThan(.15);
    asset.root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      for (const key of ["position", "normal", "uv"]) {
        const attribute = object.geometry.getAttribute(key);
        expect(attribute, `${object.name}/${key}`).toBeDefined();
        expect(Array.from(attribute.array).every(Number.isFinite), `${object.name}/${key}`).toBe(true);
      }
    });
    asset.dispose();
  }
});

it.each([true, false])("the standalone phoenix retains raised wings and a flowing split tail (High=%s)", detailed => {
  const asset = createCulturalSculpture("phoenix", detailed), bounds = visibleMeshBounds(asset.root);
  expect(bounds.max.x - bounds.min.x).toBeGreaterThan(2);
  expect(bounds.max.y).toBeGreaterThan(.95);
  expect(bounds.min.y).toBeLessThan(-.55);
  asset.dispose();
});

it.each([true, false])("the independent qilin has eight grounded cloven half-hooves (High=%s)", detailed => {
  const asset = createCulturalSculpture("qilin", detailed, false);
  const hooves = asset.root.children.filter(object => object.name === "qilin_cloven_hoof");
  expect(hooves).toHaveLength(8);
  for (const hoof of hooves) expect(visibleMeshBounds(hoof).min.y).toBeCloseTo(0, 6);
  asset.dispose();
});

it.each([true, false])("small standalone display LODs keep the canonical anatomy within their separate budgets (High=%s)", detailed => {
  for (const kind of ["phoenix", "qilin"] as const) {
    const asset = createCulturalSculpture(kind, detailed, false, "ornament");
    let triangles = 0;
    asset.root.traverse(object => {
      if (object instanceof Mesh) triangles += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3;
    });
    expect(triangles).toBeLessThan(detailed ? 10000 : 1500);
    expect(asset.recipe.mountOrigin).toEqual([0, 0, 0]);
    if (kind === "qilin") expect(asset.root.children.filter(part => part.name === "qilin_cloven_hoof")).toHaveLength(8);
    asset.dispose();
  }
});

it.each(["hero", "ornament"] as const)("fused anatomy has no clipped boundary openings in the %s tier", tier => {
  for (const detailed of [true, false]) for (const kind of ["phoenix", "qilin"] as const) {
    const asset = createCulturalSculpture(kind, detailed, false, tier);
    for (const object of asset.root.children) {
      if (!(object instanceof Mesh) || !object.name.includes("connected_")) continue;
      const positions = object.geometry.getAttribute("position"), edges = new Map<string, number>();
      const vertex = (index: number) => [positions.getX(index), positions.getY(index), positions.getZ(index)]
        .map(value => value.toFixed(5)).join(",");
      for (let index = 0; index < positions.count; index += 3) {
        const corners = [vertex(index), vertex(index + 1), vertex(index + 2)];
        if (new Set(corners).size < 3) continue;
        for (let edge = 0; edge < 3; edge++) {
          const key = [corners[edge]!, corners[(edge + 1) % 3]!].sort().join("/");
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      expect([...edges.values()].filter(count => count === 1), `${kind}/${detailed}/${object.name}`).toHaveLength(0);
    }
    asset.dispose();
  }
});
