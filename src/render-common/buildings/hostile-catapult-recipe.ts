import type { HostileCatapultVariant } from "../../shared/world/scenario-catapult";
import type { BuildingPart, BuildingRecipe, BuildingSurface, Point3 } from "./building-recipe";
import { CATAPULT_SHAFT_HEIGHT } from "./catapult-dimensions";
import { CATAPULT_HATCH_WELL } from "./catapult-hatch";
import { CATAPULT_HATCH } from "./catapult-mechanism";
import { createCatapultTowerRecipe } from "./catapult-tower-recipe";
import { hostileCatapultDetails } from "./hostile-catapult-details";
import { createPirateCatapultShaft } from "./hostile-pirate-catapult-shaft";

/** Faction buildings retain the exact working deck, launcher, roof stock and access contacts. */
export const createHostileCatapultRecipe = (
  variant: HostileCatapultVariant, detailed: boolean
): BuildingRecipe => {
  const original = createCatapultTowerRecipe("maya", detailed);
  const platform = original.parts.findIndex(part => part.shape === "catapult-deck");
  const parts: BuildingPart[] = [];
  const add = (surface: BuildingSurface, position: Point3, size: Point3, rotation?: Point3) => {
    parts.push({ position, rotation, shape: "box", size, stage: 2, surface, worldUv: 1 });
  };
  const h = CATAPULT_SHAFT_HEIGHT;
  const pirate = variant === "pirate";
  const shell: BuildingSurface = "stone";
  const tint: Point3 = [1, 1, 1];
  const wall = (position: Point3, size: Point3) => {
    add(shell, position, size);
    parts.at(-1)!.tint = tint;
  };
  if (!pirate) {
    // A full hollow room: the NW top pocket exactly matches the conserved downward hatch swing.
    const recess = .70, [hx, , hz] = CATAPULT_HATCH.position;
    const halfWell = CATAPULT_HATCH_WELL.lower / 2;
    const left = hx - halfWell, back = hz - halfWell, front = hz + halfWell;
    const pocket = CATAPULT_HATCH.hinge[0] - .035;
    wall([0, .06, 0], [1.45, .12, 1.45]);
    wall([.61, h / 2, 0], [.18, h, 1.4]);
    wall([-.61, (h - recess) / 2, 0], [.18, h - recess, 1.4]);
    wall([(-.7 + left) / 2, h - recess / 2, (-.7 + back) / 2], [left + .7, recess, back + .7]);
    wall([(-.7 + left) / 2, h - recess / 2, (.7 + front) / 2], [left + .7, recess, .7 - front]);
    wall([(-.7 + pocket) / 2, h - recess / 2, hz], [pocket + .7, recess, halfWell * 2]);
    wall([0, (h - recess) / 2, -.61], [1.4, h - recess, .18]);
    wall([0, h - recess / 2, (-.7 + back) / 2], [1.4, recess, back + .7]);
    for (const side of [-1, 1]) wall([side * .445, h / 2, .61], [.33, h, .18]);
    wall([0, (.86 + h) / 2, .61], [.56, h - .86, .18]);

  }

  if (pirate) {
    parts.push(...createPirateCatapultShaft(detailed));
  } else {
    // Land raiders' battered masonry plinth carries a tall, visibly cross-braced defensive frame.
    for (const x of [-.72, .72]) for (const z of [-.72, .72]) {
      add("wood", [x, h / 2, z], [.12, h, .12]);
      add("stone", [x, .20, z], [.20, .40, .20]);
    }
    for (const side of [-1, 1]) {
      for (const sign of [-1, 1]) add("wood", [side * .716, h / 2, 0], [.085, 2.25, .085],
        [sign * .64, 0, 0]);
      add("wood", [0, h / 2, -.716], [.085, 2.25, .085], [0, 0, side * .64]);
    }
    for (const y of [.12, .925, h - .04]) for (const side of [-1, 1]) {
      add("wood", [side * .73, y, 0], [.11, .10, 1.54]);
      if (y >= .86) add("wood", [0, y, side * .73], [1.54, .10, .11]);
    }
  }
  parts.push(...hostileCatapultDetails(variant, detailed));
  // Both retain the original working hardware, rather than a nonfunctional decorative catapult.
  parts.push(...original.parts.slice(platform));
  return { ...original, parts };
};
