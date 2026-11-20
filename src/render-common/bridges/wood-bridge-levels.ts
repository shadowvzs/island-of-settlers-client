import { addBridgeLantern } from "./bridge-lantern";
import {
  type AddBridgePart,
  addSlopedBeam,
  addVerticalBeam,
  type BridgeRecipeInput,
  darkTimberTint,
  timberTint
} from "./bridge-recipe";

export const RAIL_POST_HEIGHT = 0.65;
export const RAIL_OFFSET = 1.38;
const SIDES = [-RAIL_OFFSET, RAIL_OFFSET] as const;
/** The deck planks' outer edge; the fascia covers their ends. */
const DECK_EDGE = 1.32;
/** Outer stringer the post brackets bear on. */
const OUTER_STRINGER = 1.05;
const CAP_HEIGHT = 0.05;
const NEWEL_SIZE = 0.2;
const NEWEL_HEIGHT = 0.95;

const sideIndex = (across: number) => across < 0 ? 0 : 6;

/** Level 2: a capped post head on every post, and (High) a diagonal brace in each railing bay. */
const addCapsAndBraces = (input: BridgeRecipeInput, add: AddBridgePart, posts: readonly number[]) => {
  for (const across of SIDES) {
    for (const [index, x] of posts.entries()) add({
      position: [x, input.deckTopAt(x) + RAIL_POST_HEIGHT + CAP_HEIGHT / 2, across],
      shape: input.detailed ? "bevel-box" : "box",
      size: [0.17, CAP_HEIGHT, 0.17],
      surface: "wood",
      tint: darkTimberTint(index + sideIndex(across))
    });
    if (!input.detailed) continue;
    // The brace runs from the lower rail at one post to the upper rail at the next, inside the bay.
    for (let index = 0; index + 1 < posts.length; index += 1) {
      const from = posts[index]! + 0.07, to = posts[index + 1]! - 0.07;
      addSlopedBeam({ across, add, depth: 0.05, from, surface: "wood", thickness: 0.055,
        tint: darkTimberTint(index + 2), to, yFrom: input.deckTopAt(from) + 0.3,
        yTo: input.deckTopAt(to) + 0.6 });
    }
  }
};

/** Level 3: fascia boards over the plank ends and a bracket under every post onto the outer stringer. */
const addFasciaAndBrackets = (input: BridgeRecipeInput, add: AddBridgePart, posts: readonly number[]) => {
  const segments = Math.max(1, Math.round(input.length / 0.5)), segment = input.length / segments;
  for (const side of [-1, 1]) {
    for (let index = 0; index < segments; index += 1) {
      const from = index * segment, to = from + segment;
      addSlopedBeam({ across: side * DECK_EDGE, add, depth: 0.05, from, surface: "planks", thickness: 0.17,
        tint: timberTint(index + 3), to, yFrom: input.deckTopAt(from) - 0.07, yTo: input.deckTopAt(to) - 0.07 });
    }
    for (const [index, x] of posts.entries()) addVerticalBeam(add, x,
      [input.deckTopAt(x) - 0.04, side * RAIL_OFFSET], [input.deckTopAt(x) - 0.17, side * OUTER_STRINGER],
      input.detailed ? 0.08 : 0.1, "wood", darkTimberTint(index + 4));
  }
};

/** Level 4: tall newel posts at the four bridge mouths, iron-banded (High), with turned finials. */
const addNewels = (input: BridgeRecipeInput, add: AddBridgePart, finials: boolean) => {
  for (const across of SIDES) for (const x of [0, input.length]) {
    const deck = input.deckTopAt(x);
    add({ position: [x, deck + NEWEL_HEIGHT / 2, across], shape: input.detailed ? "bevel-box" : "box",
      size: [NEWEL_SIZE, NEWEL_HEIGHT, NEWEL_SIZE], surface: "wood", tint: darkTimberTint(x > 0 ? 3 : 1) });
    if (input.detailed) for (const height of [0.22, 0.72]) add({ position: [x, deck + height, across],
      shape: "box", size: [NEWEL_SIZE + 0.016, 0.035, NEWEL_SIZE + 0.016], surface: "iron" });
    if (!finials) continue;
    add({ position: [x, deck + NEWEL_HEIGHT + 0.03, across], shape: "box", size: [0.15, 0.06, 0.15],
      surface: "wood", tint: darkTimberTint(2) });
    // A carved four-sided spire on the collar, in the tier wood (no turned ball).
    add({ position: [x, deck + NEWEL_HEIGHT + 0.13, across], radialSegments: 4, rotation: [0, Math.PI / 4, 0],
      shape: "cone", size: [0.17, 0.14, 0.17], surface: "wood", tint: darkTimberTint(4) });
  }
};

/** Level 5: a broad hand rail along the post heads and a lantern on every newel. */
const addHandRailAndLanterns = (input: BridgeRecipeInput, add: AddBridgePart, posts: readonly number[]) => {
  for (const across of SIDES) {
    for (let index = 0; index + 1 < posts.length; index += 1) {
      const from = posts[index]!, to = posts[index + 1]!;
      addSlopedBeam({ across, add, depth: 0.12, from, surface: "wood", thickness: 0.045,
        tint: timberTint(index + 8), to, yFrom: input.deckTopAt(from) + RAIL_POST_HEIGHT + CAP_HEIGHT + 0.022,
        yTo: input.deckTopAt(to) + RAIL_POST_HEIGHT + CAP_HEIGHT + 0.022 });
    }
    for (const x of [0, input.length])
      addBridgeLantern(add, input.detailed, x, input.deckTopAt(x) + NEWEL_HEIGHT, across);
  }
};

/** Height of the upper railing bar, where the cedar level lashes each post with rope. */
const UPPER_RAIL = 0.6;
/** Outer face of a railing post (posts are 0.12 square on the rail line). */
const POST_OUTER = RAIL_OFFSET + 0.06;
/** Herb and flower foliage: natural greens; small heads in wild-flower white and pale madder. */
const FOLIAGE_TINTS: readonly (readonly [number, number, number])[] = [[0.42, 0.6, 0.26], [0.34, 0.52, 0.22],
  [0.5, 0.64, 0.3]];
const BLOSSOM_TINTS: readonly (readonly [number, number, number])[] = [[0.92, 0.9, 0.82], [0.82, 0.62, 0.6]];
/** Pennant cloth in undyed linen, pinned with a wrought-iron rod (owner 2026-11-07: muted natural dyes). */
const PENNANT_TINT: [number, number, number] = [0.8, 0.74, 0.6];

const interiorPosts = (posts: readonly number[]) => posts.slice(1, -1);

/** Level 2 bonus: a carved pyramid on every interior post cap (the mouth posts become newels later). */
const addCarvedCaps = (input: BridgeRecipeInput, add: AddBridgePart, posts: readonly number[]) => {
  for (const across of SIDES) for (const [index, x] of interiorPosts(posts).entries()) add({
    position: [x, input.deckTopAt(x) + RAIL_POST_HEIGHT + CAP_HEIGHT + 0.025, across], radialSegments: 4,
    rotation: [0, Math.PI / 4, 0], shape: "cone", size: [0.15, 0.05, 0.15], surface: "wood",
    tint: darkTimberTint(index + 1)
  });
};

/** Level 3 bonus: rope lashing where the upper rail meets each post (High: every post; Minimal: the ends). */
const addRopeLashing = (input: BridgeRecipeInput, add: AddBridgePart, posts: readonly number[]) => {
  const lashed = input.detailed ? posts : [posts[0]!, posts.at(-1)!];
  for (const across of SIDES) for (const x of lashed) add({
    position: [x, input.deckTopAt(x) + UPPER_RAIL, across], radialSegments: input.detailed ? 8 : 5,
    shape: "cylinder", size: [0.16, 0.06, 0.16], surface: "rope"
  });
};

/** Clumps of herbs (leafy spikes) along a box, with a few small flat flower heads on High. */
const addPlanting = (
  input: BridgeRecipeInput, add: AddBridgePart, x: number, top: number, centre: number, index: number
) => {
  const clumps = input.detailed ? [-0.15, -0.05, 0.05, 0.15] : [-0.1, 0.1];
  for (const [clump, offset] of clumps.entries()) {
    const height = 0.11 + (clump + index) % 3 * 0.025;
    add({ position: [x + offset, top + height / 2 - 0.01, centre + (clump % 2 ? 0.025 : -0.025)],
      radialSegments: input.detailed ? 6 : 4, shape: "cone", size: [0.1, height, 0.09], surface: "leaf",
      tint: [...FOLIAGE_TINTS[(clump + index) % FOLIAGE_TINTS.length]!] as [number, number, number] });
    if (!input.detailed || clump % 2) continue;
    add({ position: [x + offset, top + height * 0.75, centre - 0.025], radialSegments: 6, shape: "cylinder",
      size: [0.045, 0.012, 0.045], surface: "paint",
      tint: [...BLOSSOM_TINTS[(clump / 2 + index) % BLOSSOM_TINTS.length]!] as [number, number, number] });
  }
};

/**
 * Level 4 bonus: plain wooden planters hung outside the railing on wrought-iron brackets nailed to the
 * posts (High: at every interior post; Minimal: the middle one), planted with herbs.
 */
const addFlowerBoxes = (input: BridgeRecipeInput, add: AddBridgePart, posts: readonly number[]) => {
  const inner = interiorPosts(posts);
  const hung = input.detailed ? inner : inner.slice(Math.floor(inner.length / 2), Math.floor(inner.length / 2) + 1);
  for (const side of [-1, 1]) for (const [index, x] of hung.entries()) {
    const deck = input.deckTopAt(x), centre = side * (POST_OUTER + 0.1);
    add({ position: [x, deck + 0.28, side * (RAIL_OFFSET + 0.13)], shape: "box", size: [0.05, 0.03, 0.32],
      surface: "iron" });
    add({ position: [x, deck + 0.375, centre], shape: input.detailed ? "bevel-box" : "box",
      size: [0.46, 0.16, 0.18], surface: "planks", tint: darkTimberTint(index + 2) });
    add({ position: [x, deck + 0.45, centre], shape: "box", size: [0.42, 0.012, 0.14], surface: "dark" });
    addPlanting(input, add, x, deck + 0.455, centre, index);
  }
};

/** Level 5 bonus: an undyed linen pennant on the outer face of every mouth newel, on a wrought-iron rod. */
const addNewelBanners = (input: BridgeRecipeInput, add: AddBridgePart) => {
  for (const side of [-1, 1]) for (const x of [0, input.length]) {
    const deck = input.deckTopAt(x), face = side * (RAIL_OFFSET + NEWEL_SIZE / 2 + 0.008);
    add({ position: [x, deck + 0.82, face], shape: "box", size: [0.2, 0.025, 0.03], surface: "iron" });
    add({ position: [x, deck + 0.6, face], shape: "box", size: [0.15, 0.4, 0.022], surface: "cloth",
      tint: PENNANT_TINT });
  }
};

/**
 * Upgrade detail of the timber bridge (owner 2026-11-07: no gameplay effect, a richer design per
 * level). Each level adds to the previous one; every part bears on a post, rail, stringer or deck.
 */
export const addWoodBridgeLevelDetails = (input: BridgeRecipeInput, add: AddBridgePart, posts: readonly number[]) => {
  const level = input.level ?? 0;
  if (level >= 1) addCapsAndBraces(input, add, posts);
  // The level 5 hand rail lies on the post caps, so the carved caps give way to it.
  if (level >= 1 && level < 4) addCarvedCaps(input, add, posts);
  if (level >= 2) addFasciaAndBrackets(input, add, posts);
  if (level >= 2) addRopeLashing(input, add, posts);
  if (level >= 3) addNewels(input, add, level < 4);
  if (level >= 3) addFlowerBoxes(input, add, posts);
  if (level >= 4) addHandRailAndLanterns(input, add, posts);
  if (level >= 4) addNewelBanners(input, add);
};
