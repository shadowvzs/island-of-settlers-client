import { MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { garrisonSlots } from "../src/render-common/buildings/military-garrison-slots";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { createNationBuilding } from "../src/renderers/three/buildings/nation-building";

const NATIONS: readonly WorkerNation[] = ["roman", "viking", "nubian", "japanese"];
const TOWERS = [[2, 2, 0], [4, 3, 4], [9, 6, 8]] as const;
const SURFACES: BuildingSurface[] = ["copper", "feed-grain", "feed-water", "mosaic", "rope", "paint", "plaster", "stone",
  "cut-stone", "bread", "wood", "roof", "roof-shingles", "roof-thatch", "roof-slate", "steel",
  "iron", "cloth", "leaf", "dark", "gold", "bark", "endgrain", "fish", "sacking", "straw", "amber"];
const materials = Object.fromEntries(SURFACES.map(surface => [surface, new MeshStandardMaterial()])) as
  Record<BuildingSurface, MeshStandardMaterial>;

/** Upright shafts at least this wide in both plan axes: a round tower body. */
const isRoundShaft = (part: { shape: string; size: number[]; rotation?: number[] }) =>
  part.shape === "cylinder" && !part.rotation && Math.max(part.size[0]!, part.size[2]!) >= .5 && part.size[1]! > 1;

describe("per-nation military tower forms", () => {
  it.each(NATIONS.flatMap(nation => TOWERS.map(([id, posts]) => [nation, id, posts] as const)))(
    "%s building %i keeps %i archer posts on a deck", (nation, id, posts) => {
      for (const detailed of [true, false]) {
        const model = createNationBuilding(getBuildingDefinition(id), materials, nation, detailed);
        model.update(0, { construction: 1, door: 0, working: false });
        model.root.updateMatrixWorld(true);
        expect(model.recipe.archerPositions).toHaveLength(posts);
        for (const anchor of model.recipe.archerPositions!) {
          const ray = new Raycaster(new Vector3(...anchor).add(new Vector3(0, .1, 0)), new Vector3(0, -1, 0));
          expect(ray.intersectObject(model.root, true)[0]?.distance, `${nation}/${id}/${detailed}`).toBeCloseTo(.1, 2);
        }
        model.dispose();
      }
    });

  it.each(NATIONS.flatMap(nation => TOWERS.map(([id, , windows]) => [nation, id, windows] as const)))(
    "%s building %i keeps its look-out windows on High and Minimal", (nation, id, windows) => {
      for (const detailed of [true, false]) {
        const recipe = createNationBuildingRecipe(getBuildingDefinition(id), nation, detailed);
        // Watchtower (4) look-outs are enlarged downward for the window soldiers: 0.40 round, 0.42 x 0.27 yagura.
        const sizes = id === 4 ? [[.3, .23], [.4, .23], [.42, .27]] : [[.3, .23]];
        const towerWindows = recipe.parts.filter(part => part.surface === "dark" && Math.min(...part.size) < .06 &&
          sizes.some(([height, width]) => Math.abs(part.size[1] - height!) < .001 &&
            Math.abs(Math.max(part.size[0], part.size[2]) - width!) < .001));
        if (id !== 2) expect(towerWindows, `${nation}/${id}/${detailed}`).toHaveLength(windows);
        expect(garrisonSlots(id, nation, detailed).filter(slot => slot.kind === "window").length)
          .toBe(garrisonSlots(id, "roman", detailed).filter(slot => slot.kind === "window").length);
      }
    });

  it("builds round towers for Roman fortress corners, Viking and Nubian; square yagura for Japan", () => {
    const shafts = (id: number, nation: WorkerNation) =>
      createNationBuildingRecipe(getBuildingDefinition(id), nation, true).parts.filter(isRoundShaft).length;
    expect(shafts(9, "roman")).toBe(4);
    expect(shafts(4, "roman")).toBe(0);
    for (const nation of ["viking", "nubian"] as const) {
      expect(shafts(9, nation)).toBe(5);
      expect(shafts(4, nation)).toBe(1);
      expect(shafts(2, nation)).toBe(1);
    }
    for (const id of [2, 4, 9]) {
      expect(shafts(id, "japanese")).toBe(0);
      const battered = createNationBuildingRecipe(getBuildingDefinition(id), "japanese", true).parts
        .filter(part => part.surface === "stone" && part.topScale && part.topScale[0] < 1);
      expect(battered.length).toBe(id === 9 ? 5 : 1);
    }
  });

  it("tapers Nubian towers and crowns them with pinnacles", () => {
    const parts = createNationBuildingRecipe(getBuildingDefinition(4), "nubian", true).parts;
    const shaft = parts.find(isRoundShaft)!;
    expect(shaft.topScale![0]).toBeLessThan(1);
    const deck = getRomanPartBounds(shaft).max[1];
    expect(parts.filter(part => part.shape === "cone" && part.position[1] > deck).length).toBeGreaterThanOrEqual(8);
  });
});
