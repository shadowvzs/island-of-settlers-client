import type { BuildingPart } from "../buildings/building-recipe";
import type { RoadDecorationPart } from "../road-decoration-recipe";

/** Recipe parts are authored in build order: foundations, deck, then railings/parapets. */
export type BridgeBuildStage = 0 | 1 | 2;

export interface BridgeRecipePart {
  part: RoadDecorationPart;
  stage: BridgeBuildStage;
}

export interface BridgeRecipe {
  parts: BridgeRecipePart[];
}

/** Shared measurement of the clear two-lane deck; railings live outside it. */
export const BRIDGE_CLEAR_WIDTH = 2.6;

export interface BridgeRecipeInput {
  /** Flat local x is the span direction; local z is across the deck. */
  deckTopAt: (along: number) => number;
  detailed: boolean;
  length: number;
  /** Ground and water sampled at local span coordinates. */
  terrainAt: (along: number, across: number) => number;
  tiles: number;
  waterAt: (along: number, across: number) => number;
  /** Saved upgrade level (0–4): more detailed, still structurally supported art per level. */
  level?: number;
  /** Shore road surface beyond the anchors (its ramps included); the terrain when absent. */
  roadAt?: (along: number, across: number) => number;
}

export type AddBridgePart = (part: Omit<BuildingPart, "stage">) => void;

/** River bed or bank under one local point: whichever of ground and water surface is lower. */
export const bridgeBedAt = (input: BridgeRecipeInput, along: number, across: number) =>
  Math.min(input.terrainAt(along, across), input.waterAt(along, across));

/** Riprap stays this far below the deck top, so a high bank buries it instead of piercing the deck. */
const RIPRAP_DECK_CLEARANCE = 0.45;

/**
 * Toe riprap: on the bank or river bed in front of an abutment (towards the water), never on the
 * water surface and never on the approach road behind the abutment.
 */
export const riprapPosition = (
  input: BridgeRecipeInput, shore: number, offset: number, across: number, lift: number
): [number, number, number] => {
  const along = shore + (shore === 0 ? offset : -offset);
  const ground = input.terrainAt(along, across) + lift;
  return [along, Math.min(ground, input.deckTopAt(along) - RIPRAP_DECK_CLEARANCE), across];
};

/**
 * Lowest bed across a support's width. An angled crossing meets a skewed bank, so one side of an
 * abutment or pier can stand in deeper water than its centre; the support must reach that side too.
 */
export const lowestBridgeBed = (input: BridgeRecipeInput, along: number, halfWidth: number) => {
  let lowest = Number.POSITIVE_INFINITY;
  for (const side of [-1, -0.5, 0, 0.5, 1]) lowest = Math.min(lowest, bridgeBedAt(input, along, side * halfWidth));
  return lowest;
};
export interface BeamInput {
  across: number;
  add: AddBridgePart;
  depth: number;
  from: number;
  surface: "bark" | "planks" | "wood";
  thickness: number;
  tint: [number, number, number];
  to: number;
  yFrom: number;
  yTo: number;
}

/** A beam along the span between two heights (rails, stringers, fascia boards). */
export const addSlopedBeam = ({ across, add, depth, from, surface, thickness, tint, to, yFrom, yTo }: BeamInput) => {
  const dx = to - from, dy = yTo - yFrom;
  add({
    position: [(from + to) / 2, (yFrom + yTo) / 2, across],
    rotation: [0, 0, Math.atan2(dy, dx)],
    shape: "bevel-box",
    size: [Math.hypot(dx, dy), thickness, depth],
    surface,
    tint
  });
};

/** A beam in the cross-section plane at `x` (bracing, brackets), from (y, across) to (y, across). */
export const addVerticalBeam = (
  add: AddBridgePart, x: number, from: [number, number], to: [number, number],
  thickness: number, surface: "bark" | "wood", tint: [number, number, number]
) => {
  const dy = to[0] - from[0], dz = to[1] - from[1];
  add({
    position: [x, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2],
    rotation: [Math.atan2(dz, dy), 0, 0],
    shape: "box",
    size: [thickness, Math.hypot(dy, dz), thickness],
    surface,
    tint
  });
};

export type BridgeStageAdder = (stage: BridgeBuildStage) => AddBridgePart;

/** Keeps the BuildingPart format while recording the construction stage outside the part. */
export const bridgeRecipeAdder = (parts: BridgeRecipePart[]): BridgeStageAdder => stage => part =>
  parts.push({ part: { compactGeometry: true, stage: 4, ...part }, stage });

const beamTint = (base: [number, number, number], index: number): [number, number, number] => {
  const jitter = 0.94 + (index % 5) * 0.018;
  return [base[0] * jitter, base[1] * jitter, base[2] * jitter];
};

export const timberTint = (index: number) => beamTint([0.55, 0.38, 0.22], index);
export const darkTimberTint = (index: number) => beamTint([0.36, 0.25, 0.15], index);
/** Neutral grey dressed stone (granite finish), so bridge masonry matches the paved deck. */
export const stoneTint = (index: number) => beamTint([0.74, 0.74, 0.72], index);
export const copingTint = (index: number) => beamTint([0.84, 0.84, 0.82], index);
