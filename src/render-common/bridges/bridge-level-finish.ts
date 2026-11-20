import type { BuildingSurface } from "../buildings/building-recipe";
import type { BridgeRecipe } from "./bridge-recipe";

/**
 * Stone finish of each bridge level (saved 0–4): the level-1 grey granite dressing (owner 2026-11-07),
 * then the tier stone its upgrade consumed — marble, limestone, basalt and warm granite.
 */
const STONE_FINISHES = ["granite", "marble", "limestone", "basalt", "warm-granite"] as const;
export type BridgeStoneFinish = (typeof STONE_FINISHES)[number];

/**
 * Timber of each wooden level (owner 2026-11-07): the level-1 softwood, then the tier planks its
 * upgrade consumed. Levels 2–5 draw their own painted timber maps (renderer), so the recipe's brown
 * timber tint becomes a neutral shade that only keeps each part's relative darkness.
 */
const TIMBER_FINISHES = ["softwood", "hardwood", "cedar", "walnut", "mahogany"] as const;
export type BridgeTimberFinish = (typeof TIMBER_FINISHES)[number];
/** Channel sum of the recipe's base timber tint (`timberTint`): a part at it shades to 1. */
const TIMBER_TINT_SUM = 0.55 + 0.38 + 0.22;
/** Brightness of the stone tint per stone level, so each tier texture reads at gameplay distance. */
const STONE_BRIGHTNESS = [1, 1.22, 1.12, 1.3, 1.08];
/** Surfaces drawn with the tier timber maps (bark and end grain keep the shared pack). */
export const TIERED_TIMBER_SURFACES = new Set<BuildingSurface>(["wood", "planks"]);
const STONE_SURFACES = new Set<BuildingSurface>(["stone", "cut-stone"]);

const levelIndex = (level: number) => Math.max(0, Math.min(STONE_FINISHES.length - 1, Math.trunc(level)));

/** The stone texture family of a bridge: a wooden bridge's toe stones keep the base granite. */
export const bridgeStoneFinish = (kind: "stone" | "wood", level: number): BridgeStoneFinish =>
  kind === "stone" ? STONE_FINISHES[levelIndex(level)]! : "granite";

/** The timber of a wooden bridge's level; a stone bridge's timber (centring, none) stays softwood. */
export const bridgeTimberFinish = (kind: "stone" | "wood", level: number): BridgeTimberFinish =>
  kind === "wood" ? TIMBER_FINISHES[levelIndex(level)]! : "softwood";

/** Neutral shade of a timber tint: the tier map carries the colour, the part keeps its darkness. */
const neutralTimber = (tint: readonly number[] | undefined): [number, number, number] => {
  const shade = tint ? (tint[0]! + tint[1]! + tint[2]!) / TIMBER_TINT_SUM : 1;
  return [shade, shade, shade];
};

const scaled = (tint: readonly number[] | undefined, factor: readonly number[]): [number, number, number] => {
  const base = tint ?? [1, 1, 1];
  return [base[0]! * factor[0]!, base[1]! * factor[1]!, base[2]! * factor[2]!];
};

/**
 * Tints a recipe with its level's tier material: timber of a wooden bridge, masonry of a stone one.
 * Level 1 returns the recipe untouched (the Road-tab icons and saved art stay identical).
 */
export const applyBridgeLevelFinish = (recipe: BridgeRecipe, kind: "stone" | "wood", level: number): BridgeRecipe => {
  const index = levelIndex(level);
  if (!index) return recipe;
  const surfaces = kind === "wood" ? TIERED_TIMBER_SURFACES : STONE_SURFACES;
  const brightness = STONE_BRIGHTNESS[index]!;
  const factor = [brightness, brightness, brightness];
  return { parts: recipe.parts.map(entry => {
    const { part } = entry;
    if (!("surface" in part) || !surfaces.has(part.surface as BuildingSurface)) return entry;
    const tint = kind === "wood" ? neutralTimber(part.tint) : scaled(part.tint, factor);
    return { ...entry, part: { ...part, tint } };
  }) };
};
