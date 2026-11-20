import { AnimationMixer, MeshStandardMaterial, type PointLight } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import {
  type BuildingSurface,
  createRomanBuildingRecipe} from "../src/render-common/buildings/building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";

const material = new MeshStandardMaterial();
const surfaces = new Set([10, 11, 12, 13].flatMap((id) =>
  createRomanBuildingRecipe(getBuildingDefinition(id), true).parts.map((part) => part.surface)
));
for (const surface of ["steel", "wood", "dark"] as BuildingSurface[]) surfaces.add(surface);
const materials = Object.fromEntries([...surfaces].map((surface) => [surface, material])) as
  Record<BuildingSurface, MeshStandardMaterial>;

it.each([10, 11, 12, 13])("mine %i has a fitted curved door and working light on both LODs", (id) => {
  for (const detailed of [true, false]) {
    const model = createRomanBuilding(getBuildingDefinition(id), materials, detailed);
    expect(model.recipe.doorProfile).toBe("arched");
    expect(model.recipe.parts.filter((part) => part.shape === "stone-arc")).toHaveLength(12);
    const lightRoot = model.root.getObjectByName("mine_working_light")!;
    const flame = model.root.getObjectByName("mine_lamp_flame")!;
    const light = model.root.getObjectByName("mine_interior_light") as PointLight | undefined;
    expect(Boolean(light)).toBe(detailed);
    model.update(0, { construction: 0.5, door: 0, working: true });
    expect(lightRoot.visible).toBe(false);
    model.update(0.05, { construction: 1, door: 0, working: false });
    expect(lightRoot.visible).toBe(false);
    model.update(0.1, { construction: 1, door: 1, working: true });
    const firstScale = flame.scale.x;
    model.update(0.15, { construction: 1, door: 1, working: true });
    expect(lightRoot.visible).toBe(true);
    expect(flame.scale.x).not.toBeCloseTo(firstScale, 5);
    if (light) expect(light.intensity).toBeGreaterThan(0);
    model.update(0.2, { construction: 1, door: 0, working: false });
    expect(lightRoot.visible).toBe(false);
    if (light) expect(light.intensity).toBe(0);
    const frozenScale = flame.scale.x;
    model.update(0.25, { construction: 1, door: 0, working: false });
    expect(flame.scale.x).toBe(frozenScale);
    const clip = model.root.animations.find((animation) => animation.name === "working")!;
    expect(clip.tracks.some((track) => track.name === "mine_lamp_flame.scale")).toBe(true);
    const mixer = new AnimationMixer(model.root);
    mixer.clipAction(clip).play();
    mixer.setTime(0);
    const exportedScale = flame.scale.x;
    mixer.setTime(0.1);
    expect(flame.scale.x).not.toBeCloseTo(exportedScale, 5);
    mixer.stopAllAction();
    mixer.uncacheRoot(model.root);
    expect(model.triangles()).toBeLessThan(detailed ? 10000 : 1800);
    model.dispose();
  }
});
