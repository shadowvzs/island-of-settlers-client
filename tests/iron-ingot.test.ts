import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { CART_CARGO_LAYOUTS } from "../src/render-common/logistics/cart-cargo-layouts";
import { IRON_INGOT_SIZE } from "../src/render-common/wares/iron-ingot";
import { resolveWareId } from "../src/render-common/wares/ware-catalog";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { ROMAN_SURFACE_COLOURS } from "../src/renderers/three/buildings/building-surface-paint";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createIronBarIconModel } from "../src/renderers/three/settlement/iron-bar-icon-model";
import { createIronIngotGeometry } from "../src/renderers/three/settlement/iron-ingot-geometry";
import { createWareModel } from "../src/renderers/three/settlement/ware-models";

const base = new MeshStandardMaterial();
const materials = Object.fromEntries(Object.keys(ROMAN_SURFACE_COLOURS).map(surface => [surface, base])) as
  Record<BuildingSurface, MeshStandardMaterial>;

describe("the canonical single cast iron ingot", () => {
  it("is a closed indexed mesh with outward faces, chamfered ends and a recessed top", () => {
    const geometry = createIronIngotGeometry(), positions = geometry.getAttribute("position");
    expect(geometry.index!.count / 3).toBe(94);
    const edges = new Map<string, number>();
    const point = (index: number) => new Vector3().fromBufferAttribute(positions, index);
    for (let index = 0; index < geometry.index!.count; index += 3) {
      const vertices = [0, 1, 2].map(offset => point(geometry.index!.getX(index + offset)));
      const normal = vertices[1]!.clone().sub(vertices[0]!).cross(vertices[2]!.clone().sub(vertices[0]!));
      expect(normal.lengthSq()).toBeGreaterThan(1e-12);
      for (let side = 0; side < 3; side++) {
        const key = [vertices[side]!.toArray().join(","), vertices[(side + 1) % 3]!.toArray().join(",")]
          .sort().join("/");
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every(count => count === 2)).toBe(true);
    const normals = geometry.getAttribute("normal");
    const center = Array.from({ length: positions.count }, (_, index) => index)
      .find(index => positions.getX(index) === 0 && positions.getZ(index) === 0)!;
    expect(positions.getY(center)).toBeLessThan(.5);
    expect(normals.getY(center)).toBeGreaterThan(.99);
    geometry.dispose();
  });

  it.each([true, false])("shares one ingot between stock, carry and aliases at detailed=%s", detailed => {
    expect(resolveWareId("ironbar")).toBe("iron");
    for (const compact of [true, false]) {
      const recipe = createWareRecipe("ironbar", detailed, compact);
      expect(recipe.parts).toHaveLength(1);
      expect(recipe.parts[0]!.shape).toBe("iron-ingot");
      expect(recipe.parts[0]!.size).toEqual(IRON_INGOT_SIZE);
      const model = createWareModel("ironbar", detailed, materials, "carry", recipe);
      const meshes: Mesh[] = [];
      model.root.traverse(object => { if (object instanceof Mesh) meshes.push(object); });
      expect(meshes).toHaveLength(1);
      expect(model.triangles()).toBe(94);
      const bounds = new Box3().setFromObject(model.root);
      expect(bounds.min.y).toBeCloseTo(-.05, 7);
      expect(bounds.max.y).toBeCloseTo(.055, 7);
      bounds.getSize(new Vector3()).toArray().forEach((size, axis) =>
        expect(size).toBeCloseTo(IRON_INGOT_SIZE[axis]!, 7));
      const layout = CART_CARGO_LAYOUTS.iron;
      expect(layout.count).toBe(6);
      expect(IRON_INGOT_SIZE[0] * layout.scale).toBeLessThan(layout.width);
      expect(IRON_INGOT_SIZE[1] * layout.scale).toBeLessThan(layout.height);
      expect(IRON_INGOT_SIZE[2] * layout.scale).toBeLessThan(layout.depth);
      expect((meshes[0]!.material as MeshStandardMaterial).metalness).toBe(.78);
      model.dispose();
    }
    const icon = createIronBarIconModel(materials);
    expect(icon.triangles()).toBe(94);
    icon.dispose();
  });

  it.each([true, false])("displays one ingot per inventory unit in the smelter at detailed=%s", detailed => {
    const model = createRomanBuilding(getBuildingDefinition(26), materials, detailed);
    model.fitToGrid();
    for (const quantity of [0, 1, 4, 6]) {
      model.update(0, { construction: 1, door: 0, inputStock: {}, outputStock: { iron: quantity }, working: false });
      const slots = new Set<number>();
      model.root.traverse(object => {
        if (!(object instanceof Mesh) || !object.visible || object.userData.stock?.ware !== "iron") return;
        slots.add(object.userData.stock.slot);
        expect(object.geometry.index!.count / 3).toBe(94);
      });
      expect(slots.size).toBe(quantity);
    }
    model.dispose();
  });
});
