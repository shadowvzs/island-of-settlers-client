import { AnimationMixer, Box3, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getPlacedBuildingLogistics } from "../src/render-common/buildings/building-grid-metrics";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";

const surfaces: BuildingSurface[] = ["mosaic", "rope", "paint", "plaster", "stone", "wood", "roof", "steel", "iron",
  "cloth", "leaf", "dark", "gold", "bark", "endgrain", "fish", "sacking", "straw", "amber", "copper", "cut-stone", "bread"];
const materials = Object.fromEntries(surfaces.map(surface => [surface, new MeshStandardMaterial()])) as
  Record<BuildingSurface, MeshStandardMaterial>;

describe("Roman harbor lighthouse", () => {
  it("preserves its authored doorway and scale proportions within the large-building plot policy", () => {
    const definition = getBuildingDefinition(39), sizing = getRomanBuildingWorldSizing(definition);
    expect(sizing.cells).toEqual([6, 6]);
    expect(sizing.scale).toBeGreaterThanOrEqual(1.4545454545);
    expect(sizing.recipe.door).toEqual([-.63, 0, .491]);
    expect(getPlacedBuildingLogistics(39, 0, 0, 0).road).toEqual({ x: -.5, z: 3.5 });
  });

  it.each([true, false])("shows an attached pulsing navigation lamp only after completion, high=%s", detailed => {
    const model = createRomanBuilding(getBuildingDefinition(39), materials, detailed);
    const beacon = model.root.getObjectByName("harbor_shore_beacon")!;
    const lamp = model.root.getObjectByName("harbor_beacon_lamp")!;
    model.update(0, { construction: .99, door: 0, working: false });
    expect(beacon.visible).toBe(false);
    model.update(.1, { construction: 1, door: 0, working: false });
    expect(beacon.visible).toBe(true);
    const initial = lamp.scale.x;
    model.update(.4, { construction: 1, door: 0, working: false });
    expect(lamp.scale.x).not.toBe(initial);
    model.root.updateMatrixWorld(true);
    const pedestal = beacon.children[0] as Mesh;
    expect(new Box3().setFromObject(pedestal).min.y).toBeLessThan(2.1775);
    const clip = model.root.animations.find(animation => animation.name === "working")!;
    expect(clip.tracks.some(track => track.name === "harbor_beacon_lamp.scale")).toBe(true);
    const mixer = new AnimationMixer(model.root);
    mixer.clipAction(clip).play();
    mixer.setTime(.3);
    expect(lamp.scale.x).toBeGreaterThan(.85);
    mixer.stopAllAction(); mixer.uncacheRoot(model.root);
    model.dispose();
  });
});
