import { addBridgeLantern } from "./bridge-lantern";
import { type AddBridgePart, type BridgeRecipeInput, copingTint } from "./bridge-recipe";
import { chordPlacement, STONE_BRIDGE_HALF_WIDTH } from "./stone-bridge-parts";
import { addParapetPier, PARAPET_OFFSET, parapetEndPiers, parapetPierTop } from "./stone-parapet";

/** The deck-edge moulding projects this far from the structure's outer face... */
const MOULDING_PROUD = 0.07;
/** ...and is set this far into the deck slab edge it is cut on. */
const MOULDING_BED = 0.03;
const MOULDING_HEIGHT = 0.085;
/** Upgrade piers are wider than the 0.34 coping, so the coping never pokes through their faces. */
const RIVER_PIER_SIZE = [0.44, 0.42] as const;
/**
 * Their inner face stays flush with the coping's inner edge (the clear deck keeps its width); the extra
 * width projects outward over the river pier like a pilaster.
 */
const RIVER_PIER_OFFSET = PARAPET_OFFSET - 0.17 + RIVER_PIER_SIZE[1] / 2 - 0.005;
const SIDES = [-PARAPET_OFFSET, PARAPET_OFFSET] as const;

/** Level 2: a dressed moulding under both parapets, on the deck slab edge, following the camber. */
const addDeckMoulding = (input: BridgeRecipeInput, add: AddBridgePart) => {
  const pieces = Math.max(1, Math.round(input.length / (input.detailed ? 0.62 : 1.2)));
  const length = input.length / pieces;
  for (const side of [-1, 1]) for (let piece = 0; piece < pieces; piece += 1) {
    const from = piece * length, to = from + length;
    const placement = chordPlacement(input, from, to, -0.1, MOULDING_HEIGHT);
    add({
      position: [placement.position[0], placement.position[1],
        side * (STONE_BRIDGE_HALF_WIDTH + (MOULDING_PROUD - MOULDING_BED) / 2)],
      rotation: placement.rotation,
      shape: input.detailed ? "bevel-box" : "box",
      size: [placement.length - 0.01, MOULDING_HEIGHT, MOULDING_PROUD + MOULDING_BED],
      surface: "cut-stone",
      tint: copingTint(piece + (side < 0 ? 2 : 5))
    });
  }
};

/** A pyramid finial on a parapet pier's cap. */
const addFinial = (input: BridgeRecipeInput, add: AddBridgePart, along: number, across: number, wide: boolean) => {
  const size = wide ? 0.34 : 0.26;
  add({
    position: [along, parapetPierTop(input, along) + size * 0.38, across],
    radialSegments: 4,
    rotation: [0, Math.PI / 4, 0],
    shape: "cone",
    size: [size * 1.35, size * 0.76, size * 1.35],
    surface: "cut-stone",
    tint: copingTint(along > input.length / 2 ? 3 : 1)
  });
};

/**
 * Upgrade detail of the stone bridges (owner 2026-11-07: no gameplay effect, a richer design per
 * level). `piers` are the along positions of the river piers (or the crown of a single arch); every
 * added part stands on the deck slabs, a pier or a parapet pier cap.
 */
export const addStoneBridgeLevelDetails = (
  input: BridgeRecipeInput, add: AddBridgePart, piers: readonly number[]
) => {
  const level = input.level ?? 0;
  if (level < 1) return;
  addDeckMoulding(input, add);
  if (level < 2) return;
  for (const side of [-1, 1]) for (const [index, along] of piers.entries())
    addParapetPier(input, add, along, side * RIVER_PIER_OFFSET, index + (side < 0 ? 4 : 8), RIVER_PIER_SIZE);
  if (level < 3) return;
  for (const across of SIDES) {
    for (const along of piers) addFinial(input, add, along, Math.sign(across) * RIVER_PIER_OFFSET, true);
    for (const along of parapetEndPiers(input)) {
      if (level >= 4) addBridgeLantern(add, input.detailed, along, parapetPierTop(input, along), across);
      else addFinial(input, add, along, across, false);
    }
  }
};
