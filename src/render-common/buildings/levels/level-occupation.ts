import { advancedMaterialBaseDefinition } from "../advanced-material-buildings";
import type { BuildingDefinition } from "../building-catalog";
import type { Point3 } from "../building-recipe";

/** Occupation families: each dresses its yard and signboard in its own trade goods. */
export type OccupationFamily = "timber" | "stone" | "fire" | "food" | "leather" | "guard" | "store" | "home";

const FAMILIES: Readonly<Record<string, OccupationFamily>> = {
  bake: "food", brew: "food", "build-ship": "timber", burn: "fire", butcher: "food", carry: "store",
  draw: "food", dwell: "home", feed: "food", fell: "timber", fish: "food", forge: "fire", guard: "guard",
  harvest: "food", hunt: "food", look: "guard", mill: "food", mine: "stone", mint: "fire", plant: "timber",
  press: "food", quarry: "stone", saw: "timber", serve: "food", sew: "leather", skin: "leather", smelt: "fire",
  tan: "leather"
};

export const occupationFamily = (definition: BuildingDefinition): OccupationFamily =>
  FAMILIES[advancedMaterialBaseDefinition(definition).task] ?? "store";

/** Signboard pigment of each trade (painted on the board's face). */
export const OCCUPATION_PIGMENT: Readonly<Record<OccupationFamily, Point3>> = {
  fire: [.72, .26, .12], food: [.78, .6, .2], guard: [.62, .12, .12], home: [.4, .5, .3], leather: [.52, .32, .18],
  stone: [.55, .56, .6], store: [.3, .42, .6], timber: [.34, .5, .24]
};

/** Buildings with fenced yards, pens or fields: their open ground is a work area, never a prop store. */
export const OPEN_YARD_IDS: ReadonlySet<number> = new Set([5, 28, 37]);

/** Furnace trades already have a working chimney (its smoke anchor must stay theirs). */
export const hasOwnChimney = (definition: BuildingDefinition) =>
  ["forge", "smelt", "bake", "brew", "burn", "mint", "dwell"].includes(advancedMaterialBaseDefinition(definition).task);
