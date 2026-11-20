import { AnimationMixer, Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { expect, it } from "vitest";

import {
  BUILDING_CATALOG,
  getBuildingDefinition
} from "../src/render-common/buildings/building-catalog";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";

const material = new MeshStandardMaterial();
const surfaces = [
  "rope",
  "paint",
  "plaster",
  "stone",
  "wood",
  "bark",
  "endgrain",
  "fish",
  "sacking",
  "straw",
  "amber", "copper", "cut-stone", "bread",
  "roof",
  "steel",
  "iron",
  "cloth",
  "leaf",
  "dark",
  "gold"
] as BuildingSurface[];
const materials = Object.fromEntries(surfaces.map((name) => [name, material])) as Record<
  BuildingSurface,
  MeshStandardMaterial
>;
it.each(BUILDING_CATALOG)(
  "$name respects its ground plot and declared overhead clearance throughout exported working animation",
  (definition) => {
    for (const detailed of [true, false]) {
      const model = createRomanBuilding(definition, materials, detailed);
      model.fitToGrid();
      const mixer = new AnimationMixer(model.root);
      mixer.clipAction(model.root.animations.find((clip) => clip.name === "working")!).play();
      const [width, depth] = definition.gridFootprint;
      for (let i = 0; i < 17; i++) {
        mixer.setTime(i / 8);
        model.root.updateMatrixWorld(true);
        const bounds = new Box3();
        for (const object of model.root.children) {
          if (object.name === "furnace_effects") continue;
          bounds.union(new Box3().setFromObject(object));
        }
        if (definition.id === 31) {
          const sizing = getRomanBuildingWorldSizing(definition), rotor = sizing.overhead[0]!;
          const mechanism = model.root.getObjectByName("mechanism")!;
          const staticBounds = new Box3();
          for (const object of model.root.children) {
            if (object === mechanism) continue;
            staticBounds.union(new Box3().setFromObject(object));
          }
          expect(Math.max(Math.abs(staticBounds.min.x), staticBounds.max.x)).toBeLessThanOrEqual(width / 2);
          expect(Math.max(Math.abs(staticBounds.min.z), staticBounds.max.z)).toBeLessThanOrEqual(depth / 2);
          mechanism.traverse(object => {
            if (!(object instanceof Mesh)) return;
            const positions = object.geometry.getAttribute("position");
            for (let vertex = 0; vertex < positions.count; vertex++) {
              const point = new Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(object.matrixWorld);
              const x = point.x - rotor.center[0] * sizing.scale;
              const y = point.y - rotor.center[1] * sizing.scale;
              expect(Math.hypot(x, y)).toBeLessThanOrEqual(rotor.radius * sizing.scale);
              expect(Math.abs(point.z - rotor.center[2] * sizing.scale)).toBeLessThanOrEqual(rotor.halfDepth * sizing.scale);
            }
          });
          continue;
        }
        expect(Math.max(Math.abs(bounds.min.x), bounds.max.x)).toBeLessThanOrEqual(width / 2);
        expect(Math.max(Math.abs(bounds.min.z), bounds.max.z)).toBeLessThanOrEqual(depth / 2);
      }
      mixer.stopAllAction();
      mixer.uncacheRoot(model.root);
      model.dispose();
    }
  }
);
it("keeps garrison capacities and reachable future archer attachment positions", () => {
  for (const [id, capacity, archers] of [
    [1, 2, 0],
    [2, 3, 2],
    [4, 6, 3],
    [9, 10, 6]
  ]) {
    const model = createRomanBuilding(getBuildingDefinition(id!), materials, false);
    expect(model.root.userData.garrisonCapacity).toBe(capacity);
    expect(model.root.userData.archerPositions).toHaveLength(archers!);
    for (let i = 0; i < archers!; i++)
      expect(model.root.getObjectByName(`archer_position_${i}`)).toBeDefined();
    model.dispose();
  }
});
it("donkeys remain live-unit outputs", () => {
  expect(getBuildingDefinition(38).outputStorage).toBeUndefined();
});
