import { Box3, Mesh, Raycaster, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import { CART_STONE_LANE, HANDCART } from "../src/render-common/logistics/handcart-rules";
import { roadDecorationClearance, roadDecorationPartBounds } from "../src/render-common/road-decoration-clearance";
import { createRoadDecorationRecipe, roadDecorationModelReady } from "../src/render-common/road-decoration-models";
import { createRoadDecorationLeaf } from "../src/renderers/three/road-decoration-leaf";
import { createRoadDecorationModel } from "../src/renderers/three/road-decoration-model";
import { ROAD_DECORATIONS } from "../src/shared/settlement/road-decoration-catalog";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

describe("staged static road-decoration content", () => {
  it("keeps the closed folded leaf inside the rotated canonical clearance", () => {
    const part = { kind: "folded-leaf" as const, position: [1.5, 1.1, -.1] as [number, number, number],
      size: [.14, .025, .21] as [number, number, number], rotation: [.8, 1.7, .3] as [number, number, number],
      surface: "leaf" as const, tint: [1, 1, 1] as [number, number, number] };
    const geometry = createRoadDecorationLeaf(part), bounds = roadDecorationPartBounds(part);
    try {
      expect(geometry.getAttribute("position").count / 3).toBe(8);
      geometry.computeBoundingBox();
      for (const axis of [0, 1, 2]) {
        expect(geometry.boundingBox!.min.getComponent(axis)).toBeGreaterThanOrEqual(bounds.min[axis]! - .000001);
        expect(geometry.boundingBox!.max.getComponent(axis)).toBeLessThanOrEqual(bounds.max[axis]! + .000001);
      }
    } finally { geometry.dispose(); }
  });
  it("releases a template's private weathering maps once without releasing its borrowed pack", () => {
    const materials = createPlainBuildingMaterials(), definition = ROAD_DECORATIONS[0]!;
    const model = createRoadDecorationModel(createRoadDecorationRecipe(definition, true), materials, true);
    const privateMaterial = (model.root.getObjectByName("cut-stone") as Mesh).material;
    if (Array.isArray(privateMaterial) || !("map" in privateMaterial)) throw new Error("Missing owned stone material");
    const map = privateMaterial.map as import("three").DataTexture, released = vi.fn(), borrowed = vi.fn();
    map.addEventListener("dispose", released); materials["cut-stone"].addEventListener("dispose", borrowed);
    expect(map.image.data?.byteLength ?? 0).toBeGreaterThan(0);
    model.dispose(); model.dispose();
    expect(released).toHaveBeenCalledTimes(1); expect(map.image.data).toBeNull();
    expect(borrowed).not.toHaveBeenCalled();
    Object.values(materials).forEach(material => material.dispose());
  });

  it("defines two distinct variants per nation and never exposes an unauthored empty model", () => {
    expect(new Set(ROAD_DECORATIONS.map(entry => entry.id)).size).toBe(ROAD_DECORATIONS.length);
    const nations = new Set(ROAD_DECORATIONS.map(entry => entry.nation));
    expect(nations.size).toBe(8);
    for (const nation of nations) expect(ROAD_DECORATIONS.filter(entry => entry.nation === nation)).toHaveLength(2);
    for (const definition of ROAD_DECORATIONS) {
      expect(definition.wind).toBe(0);
      expect(definition.cost.stone + definition.cost.planks).toBeGreaterThan(0);
      if (!roadDecorationModelReady(definition))
        expect(() => createRoadDecorationRecipe(definition, true)).toThrow("not yet authored");
    }
  });

  for (const definition of ROAD_DECORATIONS.filter(roadDecorationModelReady))
    it.each([true, false])(`${definition.id} has real static geometry and budget (High=%s)`, detailed => {
      const materials = createPlainBuildingMaterials(), disposedMaterial = vi.fn();
      for (const material of Object.values(materials)) material.addEventListener("dispose", disposedMaterial);
      const recipe = createRoadDecorationRecipe(definition, detailed);
      const model = createRoadDecorationModel(recipe, materials, detailed);
      model.root.updateMatrixWorld(true);
      try {
        expect(model.triangles).toBeGreaterThan(30);
        expect(model.triangles).toBeLessThanOrEqual(definition.triangles[detailed ? 0 : 1]);
        model.root.traverse(object => {
          if (!(object instanceof Mesh)) return;
          expect(object.geometry.getAttribute("wind")).toBeUndefined();
          expect(Array.from(object.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
        });
        if (definition.opening) {
          expect(definition.opening.width).toBeGreaterThan((CART_STONE_LANE + HANDCART.width / 2 + .06) * 2);
          const raycaster = new Raycaster();
          // Sample a real open prism through the geometry, including bases, trims and arch shoulders.
          for (const fraction of [-.49, -.25, 0, .25, .49]) for (const height of [.05, .6, 1.1, 1.65, 2.08]) {
            raycaster.set(new Vector3(definition.opening.width * fraction, height, 2), new Vector3(0, 0, -1));
            expect(raycaster.intersectObject(model.root, true), `blocked x=${fraction},y=${height}`).toHaveLength(0);
          }
          const contract = roadDecorationClearance(definition);
          expect(contract.supports).toHaveLength(2);
          for (const box of contract.supports)
            expect(box.max[0] <= -definition.opening.width / 2 || box.min[0] >= definition.opening.width / 2).toBe(true);
        }
        expect(new Box3().setFromObject(model.root).min.y).toBeGreaterThanOrEqual(-.001);
        if (definition.family === "flower-pot") {
          const contacts: Array<[number, number]> = [];
          model.root.traverse(object => {
            if (!(object instanceof Mesh)) return;
            const points = object.geometry.getAttribute("position");
            for (let index = 0; index < points.count; index++) if (Math.abs(points.getY(index)) < .00001)
              contacts.push([points.getX(index), points.getZ(index)]);
          });
          const first = contacts[0]!, second = contacts.find(point => Math.hypot(point[0] - first[0], point[1] - first[1]) > .05)!;
          expect(second).toBeDefined();
          expect(contacts.some(point => Math.abs((second[0] - first[0]) * (point[1] - first[1]) -
            (second[1] - first[1]) * (point[0] - first[0])) > .002)).toBe(true);
        }
      } finally {
        model.dispose(); expect(disposedMaterial).not.toHaveBeenCalled();
        Object.values(materials).forEach(material => material.dispose());
      }
    });
});
