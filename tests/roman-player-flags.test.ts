import { AnimationMixer, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { createRomanPlayerFlag } from "../src/renderers/three/buildings/roman-player-flag";

describe("Roman cloth flags", () => {
  it.each([true, false])("LOD detailed=%s pins the hoist and drapes in calm air", (detailed) => {
    const material = new MeshStandardMaterial();
    const model = createRomanPlayerFlag(material, material, detailed);
    const cloth = model.root.getObjectByName("player_flag_cloth") as Mesh;
    const positions = cloth.geometry.getAttribute("position");
    const windy = cloth.geometry.morphAttributes.position!;
    let pinned = 0, folded = 0;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      if (Math.abs(positions.getX(vertex)) < 0.00001) {
        pinned++;
        for (const pose of windy) {
          expect(pose.getX(vertex)).toBeCloseTo(positions.getX(vertex), 7);
          expect(pose.getY(vertex)).toBeCloseTo(positions.getY(vertex), 7);
          expect(pose.getZ(vertex)).toBeCloseTo(positions.getZ(vertex), 7);
        }
      } else if (positions.getX(vertex) > 0.06) {
        folded++;
        expect(windy[0]!.getX(vertex)).toBeGreaterThan(positions.getX(vertex) * 4);
        expect(windy[0]!.getY(vertex) - positions.getY(vertex)).toBeGreaterThan(0.12);
      }
    }
    expect(pinned).toBe(detailed ? 7 : 3);
    expect(folded).toBeGreaterThan(0);
    expect(cloth.geometry.morphAttributes.normal).toHaveLength(8);
    model.update(10, 0);
    expect(cloth.morphTargetInfluences).toEqual(new Array(8).fill(0));
    expect((cloth.material as MeshStandardMaterial).map?.image).toMatchObject({ width: 32, height: 32 });
    model.dispose();
    cloth.geometry.dispose();
    material.dispose();
  });

  it("exports gusting folds and keeps runtime wind weights bounded and tintable", () => {
    const material = new MeshStandardMaterial();
    const model = createRomanPlayerFlag(material, material, true);
    const cloth = model.root.getObjectByName("player_flag_cloth") as Mesh;
    const weights = new Set<string>();
    for (let time = 0; time < 40; time += 0.25) {
      model.update(time, 1, 0.8, [0.2, 0.5, 0.9]);
      const values = cloth.morphTargetInfluences!;
      expect(values.every((weight) => Number.isFinite(weight) && weight >= 0)).toBe(true);
      expect(values.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(1.000001);
      weights.add(values.map((weight) => weight.toFixed(3)).join(","));
    }
    expect(weights.size).toBeGreaterThan(100);
    expect(model.clip.tracks).toHaveLength(8);
    expect(cloth.rotation.y).toBe(0.8);
    expect((cloth.material as MeshStandardMaterial).color.toArray()).toEqual([0.2, 0.5, 0.9]);
    const mixer = new AnimationMixer(model.root);
    mixer.clipAction(model.clip).play();
    mixer.update(0.5);
    expect(cloth.morphTargetInfluences!.some(weight=>weight>0)).toBe(true);
    mixer.stopAllAction();
    mixer.uncacheRoot(model.root);
    model.dispose();
    cloth.geometry.dispose();
    material.dispose();
  });

  it.each([true, false])("HQ detailed=%s keeps granite walls, burgundy cornices and a tiled civic cupola", (detailed) => {
    const recipe = createRomanBuildingRecipe(getBuildingDefinition(0), detailed);
    expect(recipe.parts.some((part) => part.surface === "paint" && part.tint?.[0] === 0.36)).toBe(true);
    expect(recipe.parts.some((part) => part.surface === "stone" && part.size[1] > 0.5)).toBe(true);
    expect(recipe.parts.some((part) => part.surface === "roof" && part.shape === "dome")).toBe(true);
    expect(recipe.parts.some((part) => part.shape === "civic-statue")).toBe(true);
  });
});
