import { Box3, type DataTexture, InstancedMesh, Mesh, type MeshStandardMaterial } from "three";
import { expect, it, vi } from "vitest";

import { roadDecorationPartBounds } from "../src/render-common/road-decoration-clearance";
import { createWisteriaRoadRecipe, WISTERIA_PALETTES, WISTERIA_TRIANGLE_BUDGET } from "../src/render-common/road-decoration-wisteria";
import { createRoadDecorationRaceme } from "../src/renderers/three/road-decoration-raceme";
import { createWisteriaRoadTemplates } from "../src/renderers/three/road-decoration-wisteria-templates";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it("three Wisteria structures keep flowers above the clear passage and affordable High/Minimal geometry", () => {
  const materials = createPlainBuildingMaterials();
  const costs: Array<{ frame: string; detailed: boolean; triangles: number }> = [];
  try {
    for (const detailed of [true, false]) {
      const owner = createWisteriaRoadTemplates(materials, detailed);
      try {
        for (const frame of ["curved", "lattice", "pergola"] as const) {
          const recipe = createWisteriaRoadRecipe(frame, detailed), model = owner.instantiate(frame, "purple");
          expect(recipe.wind).toBe(0); costs.push({ frame, detailed, triangles: model.triangles });
          const bounds = new Box3().setFromObject(model.root);
          expect(bounds.min.y).toBeGreaterThanOrEqual(-.00001);
          for (const part of recipe.parts) {
            const box = roadDecorationPartBounds(part);
            expect(box.min.every(Number.isFinite)).toBe(true); expect(box.max.every(Number.isFinite)).toBe(true);
            if ("kind" in part && part.kind === "wisteria-raceme") expect(box.min[1]).toBeGreaterThan(2.1);
            if (box.min[1] < 2.1) expect(box.min[0] > .81 || box.max[0] < -.81).toBe(true);
          }
          model.dispose();
        }
      } finally { owner.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
  expect(costs.every(cost => cost.triangles <= (cost.detailed ? WISTERIA_TRIANGLE_BUDGET.high : WISTERIA_TRIANGLE_BUDGET.minimal)), JSON.stringify(costs)).toBe(true);
});

it("dense hanging flowers have overlapping shaped bloom tiers instead of separated dots", () => {
  const geometry = createRoadDecorationRaceme({ kind: "wisteria-raceme", position: [0, 0, 0],
    size: [1, 1, 1], surface: "paint", tint: [1, 1, 1] }, true);
  try {
    const positions = geometry.getAttribute("position"), bloomVertices = 36;
    const tiers = Array.from({ length: 10 }, (_, tier) => {
      const values = Array.from({ length: bloomVertices }, (_, vertex) =>
        positions.getY(tier * 2 * bloomVertices + vertex));
      return { min: Math.min(...values), max: Math.max(...values) };
    });
    for (let tier = 1; tier < tiers.length; tier++) expect(tiers[tier]!.max)
      .toBeGreaterThan(tiers[tier - 1]!.min);
  } finally { geometry.dispose(); }
});

it("every frame and five palettes share one raceme geometry/material; instance removal never disposes templates", () => {
  const materials = createPlainBuildingMaterials(), owner = createWisteriaRoadTemplates(materials, true);
  try {
    const models = (Object.keys(WISTERIA_PALETTES) as Array<keyof typeof WISTERIA_PALETTES>)
      .map((palette, index) => owner.instantiate(index % 2 ? "curved" : "lattice", palette));
    const flowers = models.map(model => model.root.getObjectByName("paint") as InstancedMesh);
    expect(new Set(flowers.map(mesh => mesh.geometry)).size).toBe(1);
    expect(new Set(flowers.map(mesh => mesh.material)).size).toBe(1);
    expect(new Set(flowers.map(mesh => Array.from(mesh.instanceColor!.array).slice(0, 3).join(":"))).size).toBe(5);
    const freed = vi.fn(); flowers[0]!.geometry.addEventListener("dispose", freed);
    const leaf = models[0]!.root.getObjectByName("leaf") as Mesh;
    const map = (leaf.material as MeshStandardMaterial).map as DataTexture, freedLeaf = vi.fn();
    map.addEventListener("dispose", freedLeaf);
    const bark = models[0]!.root.getObjectByName("bark") as Mesh;
    expect(bark).toBeDefined();
    models.forEach(model => model.dispose()); expect(freed).not.toHaveBeenCalled(); expect(freedLeaf).not.toHaveBeenCalled();
    owner.dispose(); owner.dispose(); expect(freed).toHaveBeenCalledOnce(); expect(freedLeaf).toHaveBeenCalledOnce();
    expect(map.image.data).toBeNull();
  } finally { owner.dispose(); Object.values(materials).forEach(material => material.dispose()); }
});
