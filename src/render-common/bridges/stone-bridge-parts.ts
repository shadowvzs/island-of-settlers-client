import type { AddBridgePart, BridgeRecipeInput } from "./bridge-recipe";
import { bridgeBedAt, copingTint, lowestBridgeBed, riprapPosition, stoneTint } from "./bridge-recipe";

const COURSE_HEIGHT = 0.3;
/** Outer face of the abutment courses across the deck. */
const ABUTMENT_HALF_WIDTH = 1.55;

export const addStoneAbutment = (
  input: BridgeRecipeInput, add: AddBridgePart, along: number, index: number
) => {
  const top = input.deckTopAt(along) - 0.26;
  const bottom = lowestBridgeBed(input, along, ABUTMENT_HALF_WIDTH) - 0.35;
  const courses = Math.max(2, Math.ceil((top - bottom) / COURSE_HEIGHT));
  const courseHeight = Math.max(COURSE_HEIGHT * 0.8, (top - bottom) / courses);
  const acrossBlocks = input.detailed ? 3 : 1;
  for (let course = 0; course < courses; course += 1) {
    const y = bottom + (course + 0.5) * courseHeight;
    for (let block = 0; block < acrossBlocks; block += 1) {
      const across = acrossBlocks === 1 ? 0 : -1.05 + block * 1.05;
      const width = acrossBlocks === 1 ? 3.1 : 1.05;
      add({
        // Flush faces: alternating offsets read as loose steps beside the bridge mouth.
        position: [along, y, across],
        rotation: [0, 0, 0],
        shape: "stone-block",
        size: [0.72, courseHeight * 0.9, width],
        surface: "stone",
        tint: stoneTint(course + block + index)
      });
    }
  }
};

/** Rock half length along the deck; a stone never reaches past `reach` from its anchor. */
const RIPRAP_HALF_LENGTH = 0.18;

export const addStoneRiprap = (
  input: BridgeRecipeInput, add: AddBridgePart, shore: number, index: number, reach = Infinity
) => {
  const count = input.detailed ? 5 : 3;
  for (let stone = 0; stone < count; stone += 1) {
    // Just past the abutment face (0.4 from the anchor) at its toe, clear of any middle pier.
    const offset = 0.55 + 0.16 * (stone % 3);
    if (offset + RIPRAP_HALF_LENGTH > reach) continue;
    add({
      position: riprapPosition(input, shore, offset, -1.2 + (stone % 3) * 1.2, 0.07),
      rotation: [0, stone * 0.8, 0],
      shape: "rock",
      size: [0.36, 0.26, 0.33],
      surface: "stone",
      tint: stoneTint(stone + index)
    });
  }
};

/** Half diagonal of the 0.55 square cutwater turned 45 degrees. */
const CUTWATER_REACH = 0.39;

/**
 * Pointed cutwater on a pier's upstream or downstream face (`side` across the deck, where the river
 * meets the pier), standing on the bed beside that face.
 */
export const addStoneCutwater = (
  input: BridgeRecipeInput, add: AddBridgePart, along: number, top: number, index: number,
  side: -1 | 1, pierHalfWidth: number
) => {
  // The nose reaches 0.39 beyond the pier face: it stands on the deepest bed under its whole footprint.
  const bed = Math.min(...[0, CUTWATER_REACH].flatMap(out =>
    [-CUTWATER_REACH, 0, CUTWATER_REACH].map(offset => bridgeBedAt(input, along + offset, side * (pierHalfWidth + out)))));
  const bottom = bed - 0.25;
  const height = Math.max(0.3, top - bottom);
  add({
    position: [along, bottom + height / 2, side * pierHalfWidth],
    rotation: [0, Math.PI / 4, 0],
    shape: "stone-block",
    size: [0.55, height, 0.55],
    surface: "stone",
    tint: stoneTint(index + 9)
  });
};

/** Deck slab top sits this far under the shared deck height, so the road surface always covers it. */
const SLAB_SINK = 0.012;
const SLAB_THICKNESS = 0.26;
/** Deck slabs carry the parapets: they reach the outer face of the whole structure. */
export const STONE_BRIDGE_HALF_WIDTH = 1.56;

/**
 * Placement of a block whose `base` line follows the chord of the deck profile from `from` to `to`
 * (offset `lift` above the deck): consecutive blocks meet edge to edge at the same height, so the
 * deck, courses and coping follow the camber as one smooth line instead of flat steps.
 */
export const chordPlacement = (
  input: BridgeRecipeInput, from: number, to: number, lift: number, height: number
) => {
  const startY = input.deckTopAt(from) + lift, endY = input.deckTopAt(to) + lift;
  const angle = Math.atan2(endY - startY, to - from);
  const centreX = (from + to) / 2, centreY = (startY + endY) / 2;
  return {
    length: Math.hypot(to - from, endY - startY),
    position: [centreX - Math.sin(angle) * height / 2, centreY + Math.cos(angle) * height / 2] as const,
    rotation: [0, 0, angle] as [number, number, number]
  };
};

/** One continuous slab surface: chord-tilted slabs joined edge to edge just below the road deck. */
export const addStoneDeckSlabs = (input: BridgeRecipeInput, add: AddBridgePart) => {
  // Short slabs on both detail levels: a long chord would sag under the cambered road surface.
  const slabs = Math.max(1, Math.ceil(input.length / 0.75));
  const slabLength = input.length / slabs;
  const halfAcross = STONE_BRIDGE_HALF_WIDTH / 2;
  for (let slab = 0; slab < slabs; slab += 1) {
    const from = slab * slabLength, to = from + slabLength;
    const { length, position, rotation } = chordPlacement(input, from, to, -SLAB_SINK - SLAB_THICKNESS, SLAB_THICKNESS);
    for (const across of [-halfAcross, halfAcross]) add({
      position: [position[0], position[1], across],
      rotation,
      shape: "stone-block",
      size: [length - 0.015, SLAB_THICKNESS, STONE_BRIDGE_HALF_WIDTH - 0.015],
      surface: "cut-stone",
      tint: copingTint(slab + (across < 0 ? 0 : 3))
    });
  }
};
