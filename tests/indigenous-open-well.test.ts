import { Box3, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { indigenousOpenWellParts } from "../src/render-common/buildings/indigenous-well-parts";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createStructuralRockGeometry } from "../src/renderers/three/buildings/structural-rock-geometry";

const recipe = () => createRomanBuildingRecipe(getBuildingDefinition(35), true);

describe("Indigenous open boulder well", () => {
  it.each([false, true])("has one shared mineral material and a clear full-cycle bucket opening (detailed=%s)", detailed => {
    const definition = getBuildingDefinition(35), material = new MeshStandardMaterial();
    const base = leveledBuildingRecipe(definition, "indigenous", detailed, 1);
    const upgraded = leveledBuildingRecipe(definition, "indigenous", detailed, 2);
    expect(base.parts.some(part => part.shape === "occupation-roof")).toBe(false);
    expect(upgraded.parts.some(part => part.shape === "occupation-roof" && part.surface === "cloth-water")).toBe(true);
    for (const key of ["door", "mechanism", "workPoint", "workerExit"] as const) expect(upgraded[key]).toEqual(base[key]);
    for (const source of [base, upgraded]) {
      const materials = new Proxy(Object.fromEntries(source.parts.map(part => [part.surface, material])) as
        Record<BuildingSurface, MeshStandardMaterial>, { get: () => material });
      const model = createRomanBuilding(definition, materials, detailed, source, "indigenous");
      const rocks: Mesh[] = [];
      model.root.traverse(object => { if (object instanceof Mesh && object.userData.catapultRockMaterial) rocks.push(object); });
      expect(rocks).toHaveLength(1);
      const mineral = rocks[0]!.material as MeshStandardMaterial;
      expect(mineral.map).not.toBeNull(); expect(mineral.roughness).toBe(.98);
      const rockBounds = new Box3().setFromObject(rocks[0]!);
      const ray = new Raycaster(new Vector3(-.06, 2, -.15), new Vector3(0, -1, 0));
      expect(ray.intersectObject(rocks[0]!)).toHaveLength(0);
      for (const elapsed of [0, 1.5, 2, 8, 12, 12.5, 13, 14]) {
        model.update(elapsed, { construction: 1, door: 0, workTime: elapsed, working: true });
        model.root.updateMatrixWorld(true);
        const bucket = model.root.getObjectByName("well_bucket")!;
        const bounds = new Box3().setFromObject(bucket);
        expect(bounds.min.y, `${JSON.stringify(source.mechanism)} / ${elapsed}`).toBeGreaterThan(.034);
        expect(bounds.min.x).toBeGreaterThan(-.23); expect(bounds.max.x).toBeLessThan(.14);
        expect(bounds.min.z).toBeGreaterThan(-.35); expect(bounds.max.z).toBeLessThan(.05);
        if (elapsed === 2) expect(bounds.max.y).toBeLessThan(rockBounds.max.y);
      }
      let triangles = 0;
      model.root.traverse(object => { if (object instanceof Mesh)
        triangles += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3; });
      expect(triangles).toBeLessThanOrEqual(detailed ? 10000 : 2300);
      model.dispose();
    }
    material.dispose();
  });

  it("uses grounded fractured stone with bounded High/Minimal geometry and finite exact part bounds", () => {
    for (const detailed of [false, true]) for (let variant = 0; variant < 16; variant++) {
      const geometry = createStructuralRockGeometry(detailed, variant), vertices = geometry.getAttribute("position");
      expect(vertices.count / 3).toBe(detailed ? 80 : 20);
      const box = geometry.boundingBox!;
      for (const value of box.getSize(new Vector3()).toArray()) expect(value).toBeCloseTo(1, 6);
      for (const value of vertices.array) expect(Number.isFinite(value)).toBe(true);
      expect(box.min.x).toBeCloseTo(-.5); expect(box.min.y).toBeCloseTo(-.5); expect(box.min.z).toBeCloseTo(-.5);
      expect(geometry.getAttribute("color").count).toBe(vertices.count);
      expect(geometry.getAttribute("normal").count).toBe(vertices.count);
      geometry.dispose();
    }
  });

  it("removes the tipi and keeps the ordinary shaft, pole frame and exact real inventory tags", () => {
    const original = recipe();
    const parts = indigenousOpenWellParts(original, true);
    expect(parts.some(part => part.shape === "indigenous-roof" || part.shape === "occupation-roof")).toBe(false);
    const stones = parts.filter(part => part.shape === "structural-rock");
    expect(stones.length).toBeGreaterThan(30);
    expect(stones.some(part => part.size[0] < .16 && part.size[1] < .16)).toBe(true);
    expect(stones.every(part => part.size[0] < .30)).toBe(true);
    expect(parts.filter(part => part.stock)).toEqual(original.parts.filter(part => part.stock));
    expect(parts.some(part => part.shape === "bowl")).toBe(false);
    expect(parts.some(part => part.surface === "stone" && part.shape === "ring")).toBe(false);
    for (const rock of parts.filter(part => part.shape === "structural-rock")) {
      const dx = -.06 - rock.position[0], dz = -.15 - rock.position[2], angle = rock.rotation![1];
      const localX = dx * Math.cos(angle) - dz * Math.sin(angle);
      const localZ = dx * Math.sin(angle) + dz * Math.cos(angle);
      const distance = Math.hypot(Math.max(0, Math.abs(localX) - rock.size[0] / 2),
        Math.max(0, Math.abs(localZ) - rock.size[2] / 2));
      expect(distance, `bucket opening at rock ${rock.decorVariant}`).toBeGreaterThan(.14);
      expect(rock.position[1] - rock.size[1] / 2).toBeGreaterThanOrEqual(0);
    }
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const rock of parts.filter(part => part.shape === "structural-rock")) {
      min.min(new Vector3(...rock.position).addScaledVector(new Vector3(...rock.size), -.5));
      max.max(new Vector3(...rock.position).addScaledVector(new Vector3(...rock.size), .5));
    }
    expect(new Box3(min, max).max.y).toBeGreaterThan(.50);
  });
});
