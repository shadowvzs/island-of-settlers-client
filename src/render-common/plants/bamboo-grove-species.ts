import { decorationEntries } from "@shared/catalog";

export type BambooGroveVariant = 0 | 1 | 2 | 3 | 4 | 5;
/** A tight upright clump of culms, or one tall thick showpiece culm. */
export type BambooForm = "clump" | "single";
/**
 * Culm skin atlas column: `plain` is tinted by `culmColour`; the striped skins are painted in their
 * real colours (golden with green stripes, green with golden grooves) and only lightly tinted.
 */
export type BambooSkin = "plain" | "golden-striped" | "green-grooved";
export type BambooColour = readonly [number, number, number];

/** Original parametric grove archetypes; every tier and the clearance read the same numbers. */
export interface BambooGroveSpecies {
  /** Fraction of a culm's height that keeps its papery culm sheaths (lower nodes). */
  sheathedFraction: number;
  /** Arching of the upper culm, as a fraction of its length at the tip. */
  arch: number;
  /** Branches leaving each leafy node (2 in running bamboo, a fan in clumping bamboo). */
  branchesPerNode: number;
  branchLength: number;
  /** Ground radius of the clump the culm bases spread over. */
  clumpRadius: number;
  culmColour: BambooColour;
  culms: number;
  form: BambooForm;
  height: readonly [min: number, max: number];
  /** Outward lean of the lower culm (radians-like fraction of its length). */
  lean: number;
  leafColour: BambooColour;
  leafLength: number;
  leafWidth: number;
  /** Mean internode length along a mid culm. */
  internode: number;
  radius: readonly [min: number, max: number];
  sheathColour: BambooColour;
  /** Young shoots breaking through the soil beside the clump. */
  shoots: number;
  /** Leaves in one terminal spray (High); lower tiers keep the largest central ones. */
  sprayLeaves: number;
  skin: BambooSkin;
  /** Fraction of the height where the first leafy branch whorl appears. */
  whorlStart: number;
}

const PAINTED: BambooColour = [1, 1, 1];
/** Owner-approved bamboo leaf colour (2026-11-10, tall golden culm close-up), used by every bamboo model. */
export const BAMBOO_LEAF_COLOUR: BambooColour = [.18, .62, .08];
/** Same hue a few percent darker, for variety between models (never dull). */
export const bambooLeafShade = (factor: number): BambooColour =>
  [BAMBOO_LEAF_COLOUR[0] * factor, BAMBOO_LEAF_COLOUR[1] * factor, BAMBOO_LEAF_COLOUR[2] * factor];

/** Approved clump structure (owner reference 2026-11-10): culms close together, nearly upright. */
const clump = (culmColour: BambooColour, skin: BambooSkin, leafColour: BambooColour,
  sheathColour: BambooColour): BambooGroveSpecies => ({
  sheathedFraction: .3, arch: .12, branchesPerNode: 2, branchLength: .62, clumpRadius: .42, culmColour,
  culms: 10, form: "clump", height: [5.6, 6.5], lean: .05, leafColour, leafLength: .36, leafWidth: .055,
  internode: .38, radius: [.055, .075], sheathColour, shoots: 2, skin, sprayLeaves: 4, whorlStart: .38 });

/** One thick culm, taller than the clumps, with larger leaves in fuller sprays. */
const single = (height: number, radius: number, culmColour: BambooColour, skin: BambooSkin,
  leafColour: BambooColour, sheathColour: BambooColour): BambooGroveSpecies => ({
  sheathedFraction: .3, arch: .035, branchesPerNode: 3, branchLength: 1.15, clumpRadius: 0, culmColour,
  culms: 1, form: "single", height: [height, height], lean: .012, leafColour, leafLength: .52, leafWidth: .085,
  internode: height / 15, radius: [radius, radius], sheathColour, shoots: 1, skin, sprayLeaves: 6,
  whorlStart: .3 });

/** Vivid readable colours (owner 2026-11-05/10) on naturalistic running-bamboo forms. */
export const BAMBOO_GROVE_SPECIES: readonly BambooGroveSpecies[] = [
  clump([.40, .66, .22], "plain", bambooLeafShade(.95), [.86, .76, .55]),
  clump(PAINTED, "golden-striped", bambooLeafShade(.97), [.9, .8, .56]),
  single(7.35, .096, [.26, .64, .12], "plain", bambooLeafShade(.98), [.86, .76, .55]),
  single(8.5, .12, [.34, .62, .30], "plain", bambooLeafShade(.94), [.82, .72, .54]),
  single(7.04, .096, PAINTED, "golden-striped", BAMBOO_LEAF_COLOUR, [.9, .8, .56]),
  single(7.56, .1, PAINTED, "green-grooved", bambooLeafShade(.96), [.86, .77, .56])
];

/** Per-instance triangle ceilings per form; tests hold the actual geometry beneath them. */
export const BAMBOO_BUDGET = Object.freeze({
  clump: Object.freeze({ high: 24000, minimal: 7000, far: 2800 }),
  single: Object.freeze({ high: 12000, minimal: 4000, far: 1600 })
});

export const bambooSpecies = (variant: BambooGroveVariant) => {
  const species = BAMBOO_GROVE_SPECIES[variant];
  if (!species) throw new Error(`Unknown bamboo variant: ${variant}`);
  return species;
};
/** Soil mound the culm bases are buried in; litter rests on it. Singles keep a small footprint. */
export const bambooMoundRadius = (species: BambooGroveSpecies) =>
  species.clumpRadius + .2 + (species.form === "single" ? species.radius[1] * 1.6 : 0);
export const bambooBudget = (variant: BambooGroveVariant) => BAMBOO_BUDGET[bambooSpecies(variant).form];

/** Stable content IDs in variant order (the catalog's `bamboo` decorations; saved custody uses these). */
export const BAMBOO_CONTENT_IDS: readonly string[] = decorationEntries().filter(entry => entry.tags.includes("bamboo"))
  .map(entry => entry.key);
