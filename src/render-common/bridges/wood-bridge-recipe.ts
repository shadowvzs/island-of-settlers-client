import {
  type AddBridgePart,
  addSlopedBeam,
  addVerticalBeam,
  BRIDGE_CLEAR_WIDTH,
  bridgeBedAt,
  type BridgeRecipe,
  bridgeRecipeAdder,
  type BridgeRecipeInput,
  darkTimberTint,
  lowestBridgeBed,
  riprapPosition,
  stoneTint,
  timberTint
} from "./bridge-recipe";
import { addWoodBridgeLevelDetails, RAIL_OFFSET, RAIL_POST_HEIGHT } from "./wood-bridge-levels";

const DECK_PLANK_THICKNESS = 0.08;
const DECK_PLANK_WIDTH = 0.25;
const DECK_PLANK_STEP = 0.27;
/** Middle traffic track of the deck: width and darkening (worn by feet, hooves and carts). */
const DECK_TRACK_WIDTH = 0.9;
const DECK_TRACK_SHADE = 0.78;
/** Level 1 deck poles: diameter, spacing, and how far their crowns stand above the walk line. */
const DECK_LOG_DIAMETER = 0.12;
const DECK_LOG_STEP = 0.125;
const DECK_LOG_TOP = 0.005;
/** The wooden landing ramps over the shore road at each mouth: length, poles (level 1) and lip. */
export const BRIDGE_LANDING_LENGTH = 0.6;
const LANDING_LENGTH = BRIDGE_LANDING_LENGTH;
const LANDING_POLES = 5;
const LANDING_LIP = 0.025;
/** A landing's foot reaches this far into the ground (never a lit slit under the timber). */
const LANDING_GROUND_BITE = 0.005;
/** Sleepers under the level-1 landing poles: across positions, width and least depth. */
const LANDING_SLEEPERS = [-0.85, 0, 0.85];
const SLEEPER_WIDTH = 0.12;
const SLEEPER_DEPTH = 0.06;
/** The road ribbon's lift over its ground, and how far it sinks under a wooden deck and its landings. */
const ROAD_RIBBON_LIFT = 0.018;
export const BRIDGE_TIMBER_ROAD_DROP = 0.08;
const WHEEL_GUARD_OFFSET = 1.23;
/** Outer face of the crib cheeks: the abutment's full width across the deck. */
const CRIB_HALF_WIDTH = 1.5;

const addCribAbutment = (
  input: BridgeRecipeInput, add: AddBridgePart, along: number, index: number
) => {
  const deckBottom = input.deckTopAt(along) - 0.24;
  const bottom = lowestBridgeBed(input, along, CRIB_HALF_WIDTH) - 0.35;
  const height = Math.max(0.3, deckBottom - bottom);
  const layers = Math.max(2, Math.ceil(height / 0.18));
  const layerHeight = height / layers;
  for (let layer = 0; layer < layers; layer += 1) {
    const y = bottom + (layer + 0.5) * layerHeight;
    const tint = timberTint(layer + index);
    if (input.detailed) {
      for (const across of [-0.78, 0.78]) add({
        position: [along + (layer % 2 === 0 ? -0.08 : 0.08), y, across],
        shape: "box",
        size: [0.82, layerHeight * 0.88, 1.45],
        surface: "bark",
        tint
      });
    } else add({
      position: [along, y, 0],
      shape: "box",
      size: [0.9, layerHeight * 0.88, 3.1],
      surface: "wood",
      tint
    });
  }
  // Crib cheeks turn the abutment into the bank instead of ending in a floating face.
  for (const across of [-1.32, 1.32]) add({
    position: [along, bottom + height / 2, across],
    rotation: [0, 0, Math.atan2(height * 0.45, 0.5)],
    shape: "bevel-box",
    size: [0.7, height * 0.75, 0.34],
    surface: "wood",
    tint: darkTimberTint(layerIndex(index, across))
  });
};

const layerIndex = (index: number, across: number) => index + (across < 0 ? 1 : 2);

const addRiprap = (input: BridgeRecipeInput, add: AddBridgePart) => {
  const count = input.detailed ? 6 : 3;
  for (const shore of [0, input.length]) for (let index = 0; index < count; index += 1) {
    // Just past the crib face (0.5 from the anchor) at the abutment toe.
    add({
      position: riprapPosition(input, shore, 0.6 + (index % 2) * 0.26, -1.1 + (index % 3) * 1.1, 0.08),
      rotation: [0, index * 0.7, 0],
      shape: "rock",
      size: [0.34, 0.25, 0.32],
      surface: "stone",
      tint: stoneTint(index + (shore === 0 ? 0 : 4))
    });
  }
};

const addPileBents = (input: BridgeRecipeInput, add: AddBridgePart) => {
  if (input.length <= 3) return;
  const bentCount = Math.ceil(input.length / 3) - 1;
  for (let bent = 1; bent <= bentCount; bent += 1) {
    const x = input.length * bent / (bentCount + 1);
    const capY = input.deckTopAt(x) - 0.25;
    for (const across of [-1.05, -0.35, 0.35, 1.05]) {
      const bottom = bridgeBedAt(input, x, across) - 0.35;
      const top = capY - 0.08;
      add({
        position: [x, (top + bottom) / 2, across],
        shape: "cylinder",
        size: [0.16, Math.max(0.25, top - bottom), 0.16],
        surface: "bark",
        radialSegments: input.detailed ? 10 : 6,
        tint: timberTint(bent + (across < 0 ? 1 : 2))
      });
    }
    add({
      position: [x, capY, 0],
      shape: "bevel-box",
      size: [0.3, 0.16, 2.7],
      surface: "wood",
      tint: darkTimberTint(bent)
    });
    if (!input.detailed) {
      addVerticalBeam(add, x, [capY - 0.12, -1.05],
        [bridgeBedAt(input, x, 0.35) + 0.25, 0.35], 0.12, "wood", darkTimberTint(bent + 3));
      continue;
    }
    for (const across of [-1, 1]) addVerticalBeam(add, x,
      [capY - 0.12, across * 1.05], [bridgeBedAt(input, x, across * 0.35) + 0.25, across * 0.35],
      0.11, "wood", darkTimberTint(bent + 3));
  }
};

const addStringers = (input: BridgeRecipeInput, add: AddBridgePart) => {
  const segments = Math.max(1, Math.round(input.length / 0.5));
  const segmentLength = input.length / segments;
  for (const across of [-1.05, -0.525, 0, 0.525, 1.05]) {
    for (let segment = 0; segment < segments; segment += 1) {
      const from = segment * segmentLength, to = from + segmentLength;
      addSlopedBeam({
        across,
        add,
        depth: 0.14,
        from,
        surface: "wood",
        thickness: 0.16,
        tint: timberTint(segment + Math.round(across * 4)),
        to,
        yFrom: input.deckTopAt(from) - 0.16,
        yTo: input.deckTopAt(to) - 0.16
      });
    }
  }
};

/**
 * The deck in three strips across: two outer strips and the worn, darker traffic track down the
 * middle (owner 2026-11-07), so the shade costs no extra texture or draw call.
 */
const DECK_STRIPS = (() => {
  const outer = (BRIDGE_CLEAR_WIDTH - DECK_TRACK_WIDTH) / 2, centre = (DECK_TRACK_WIDTH + outer) / 2;
  return [{ across: -centre, depth: outer, shade: 1 }, { across: 0, depth: DECK_TRACK_WIDTH, shade: DECK_TRACK_SHADE },
    { across: centre, depth: outer, shade: 1 }];
})();

const shadeTint = (tint: [number, number, number], shade: number): [number, number, number] =>
  [tint[0] * shade, tint[1] * shade, tint[2] * shade];

/** One deck board (or Minimal slab) from `from` to `to`, in its three strips. */
const addDeckBoard = (input: BridgeRecipeInput, add: AddBridgePart, from: number, to: number, index: number) => {
  const topAt = input.deckTopAt;
  for (const strip of DECK_STRIPS) addSlopedBeam({
    across: strip.across, add, depth: strip.depth, from, surface: "planks", thickness: DECK_PLANK_THICKNESS,
    tint: shadeTint(timberTint(index), strip.shade), to,
    yFrom: topAt(from) - DECK_PLANK_THICKNESS / 2, yTo: topAt(to) - DECK_PLANK_THICKNESS / 2
  });
};

/** Level 1 on High: round poles laid across the stringers (a rustic corduroy deck). */
const addDeckLogs = (input: BridgeRecipeInput, add: AddBridgePart) => {
  const count = Math.max(1, Math.round(input.length / DECK_LOG_STEP)), step = input.length / count;
  for (let index = 0; index < count; index += 1) {
    const along = (index + 0.5) * step, centre = input.deckTopAt(along) + DECK_LOG_TOP - DECK_LOG_DIAMETER / 2;
    for (const strip of DECK_STRIPS) add({
      position: [along, centre, strip.across], radialSegments: 5, rotation: [Math.PI / 2, 0, 0],
      shape: "cylinder", size: [DECK_LOG_DIAMETER, strip.depth, DECK_LOG_DIAMETER], surface: "wood",
      tint: shadeTint(timberTint(index + 11), strip.shade)
    });
  }
};

/** Surface the landing rests on: the terrain, or the road ribbon where it lies under the timber. */
export const landingGroundAt = (input: BridgeRecipeInput, along: number, across: number) => {
  const terrain = input.terrainAt(along, across);
  const road = input.roadAt?.(along, across);
  return road === undefined ? terrain : Math.max(terrain, road + ROAD_RIBBON_LIFT - BRIDGE_TIMBER_ROAD_DROP);
};

/**
 * Top of the wooden landing over the shore road (owner 2026-11-07): flush with the deck at the
 * mouth, a thin lip over the road at its outer end, following the road's own shape in between, so
 * walkers and carts meet no step.
 */
const landingTop = (input: BridgeRecipeInput, mouth: number, along: number, across: number, depth: number) => {
  // The highest road under the piece's width: a cross-sloped road never shows through its edge.
  const road = (at: number) => Math.max(...[-depth / 2, 0, depth / 2].map(offset =>
    input.roadAt?.(at, across + offset) ?? input.terrainAt(at, across + offset)));
  const share = Math.min(1, Math.abs(along - mouth) / LANDING_LENGTH);
  return road(along) + LANDING_LIP * share + (input.deckTopAt(mouth) - road(mouth)) * (1 - share);
};

/**
 * Thickness that keeps a landing piece's underside on (or into) the ground under all four corners:
 * a raised deck mouth gets a deeper sleeper instead of a lit gap under the timber.
 */
const groundingThickness = (
  input: BridgeRecipeInput, ends: readonly [number, number], tops: readonly [number, number],
  across: number, depth: number, minimum: number
) => {
  let thickness = minimum;
  for (const [index, along] of ends.entries()) for (const side of [-1, 1]) {
    const ground = landingGroundAt(input, along, across + side * depth / 2);
    thickness = Math.max(thickness, tops[index]! - ground + LANDING_GROUND_BITE);
  }
  return thickness;
};

/** One landing board per strip from `near` to `far`, its top on the landing line and its foot grounded. */
const addLandingBoard = (
  input: BridgeRecipeInput, add: AddBridgePart, mouth: number, ends: [number, number], index: number
) => {
  for (const strip of DECK_STRIPS) {
    const tops = ends.map(along => landingTop(input, mouth, along, strip.across, strip.depth)) as [number, number];
    const thickness = groundingThickness(input, ends, tops, strip.across, strip.depth, DECK_PLANK_THICKNESS);
    addSlopedBeam({ across: strip.across, add, depth: strip.depth, from: ends[0], surface: "planks", thickness,
      tint: shadeTint(timberTint(index), strip.shade), to: ends[1], yFrom: tops[0] - thickness / 2,
      yTo: tops[1] - thickness / 2 });
  }
};

/** Level 1 on High: poles across the landing, on two grounded sleepers. */
const addLandingPoles = (input: BridgeRecipeInput, add: AddBridgePart, mouth: number, direction: number) => {
  for (let pole = 0; pole < LANDING_POLES; pole += 1) {
    const along = mouth + direction * (pole + 0.5) * LANDING_LENGTH / LANDING_POLES;
    for (const strip of DECK_STRIPS) add({
      position: [along, landingTop(input, mouth, along, strip.across, strip.depth) - DECK_LOG_DIAMETER / 2,
        strip.across],
      radialSegments: 5, rotation: [Math.PI / 2, 0, 0], shape: "cylinder",
      size: [DECK_LOG_DIAMETER, strip.depth, DECK_LOG_DIAMETER], surface: "wood",
      tint: shadeTint(timberTint(pole + 3), strip.shade)
    });
  }
  const ends = [mouth, mouth + direction * LANDING_LENGTH].sort((a, b) => a - b) as [number, number];
  for (const across of LANDING_SLEEPERS) {
    // The sleeper's top carries the poles' feet; its own foot reaches the ground.
    const tops = ends.map(along => landingTop(input, mouth, along, across, SLEEPER_WIDTH) - DECK_LOG_DIAMETER + 0.01) as
      [number, number];
    const thickness = groundingThickness(input, ends, tops, across, SLEEPER_WIDTH, SLEEPER_DEPTH);
    addSlopedBeam({ across, add, depth: SLEEPER_WIDTH, from: ends[0], surface: "wood", thickness,
      tint: darkTimberTint(across > 0 ? 2 : 4), to: ends[1], yFrom: tops[0] - thickness / 2,
      yTo: tops[1] - thickness / 2 });
  }
};

/**
 * Owner 2026-11-07: the timber runs onto the road at both mouths (the road stops under it): a short
 * landing ramp of the level's deck material, poles at level 1 on High, boards otherwise.
 */
export const addWoodBridgeLandings = (input: BridgeRecipeInput, add: AddBridgePart) => {
  for (const mouth of [0, input.length]) {
    const direction = mouth ? 1 : -1;
    if (input.detailed && !(input.level ?? 0)) {
      addLandingPoles(input, add, mouth, direction);
      continue;
    }
    const boards = input.detailed ? 2 : 1, step = LANDING_LENGTH / boards;
    for (let board = 0; board < boards; board += 1) {
      const near = mouth + direction * board * step, far = near + direction * (step - (input.detailed ? 0.02 : 0));
      addLandingBoard(input, add, mouth, [Math.min(near, far), Math.max(near, far)], board + 5);
    }
  }
};

/**
 * The timber deck (owner 2026-11-07: never the road's dirt): round poles at level 1 (High; Minimal
 * slabs carry a painted pole texture), planks from level 2 in the tier timber. Its top stays at
 * `deckTopAt`, so the walk surface is unchanged.
 */
const addDeck = (input: BridgeRecipeInput, add: AddBridgePart) => {
  addWoodBridgeLandings(input, add);
  if (!input.detailed) {
    const slabs = 4, slabLength = input.length / slabs;
    for (let slab = 0; slab < slabs; slab += 1)
      addDeckBoard(input, add, slab * slabLength, (slab + 1) * slabLength, slab + 7);
    return;
  }
  if (!(input.level ?? 0)) {
    addDeckLogs(input, add);
    return;
  }
  let index = 0;
  for (let from = 0; from < input.length - 0.01; from += DECK_PLANK_STEP) {
    addDeckBoard(input, add, from, Math.min(input.length, from + DECK_PLANK_WIDTH), index + 11);
    index += 1;
  }
};

const addWheelGuards = (input: BridgeRecipeInput, add: AddBridgePart) => {
  const segments = Math.max(1, Math.round(input.length / 0.5));
  const segmentLength = input.length / segments;
  for (const across of [-WHEEL_GUARD_OFFSET, WHEEL_GUARD_OFFSET]) {
    for (let segment = 0; segment < segments; segment += 1) {
      const from = segment * segmentLength, to = from + segmentLength;
      addSlopedBeam({
        across,
        add,
        depth: 0.12,
        from: from + 0.01,
        surface: "wood",
        thickness: 0.09,
        tint: darkTimberTint(segment + 5),
        to: to - 0.01,
        yFrom: input.deckTopAt(from) + 0.045,
        yTo: input.deckTopAt(to) + 0.045
      });
    }
  }
};

const postPositions = (length: number) => {
  const positions: number[] = [];
  for (let x = 0; x < length - 1e-6; x += 1) positions.push(x);
  positions.push(length);
  return positions;
};

const addRailings = (input: BridgeRecipeInput, add: AddBridgePart) => {
  const posts = postPositions(input.length);
  for (const across of [-RAIL_OFFSET, RAIL_OFFSET]) {
    for (const [index, x] of posts.entries()) {
      const deck = input.deckTopAt(x);
      add({
        position: [x, deck + RAIL_POST_HEIGHT / 2, across],
        shape: input.detailed ? "bevel-box" : "box",
        size: [0.12, RAIL_POST_HEIGHT, 0.12],
        surface: "wood",
        tint: timberTint(index + (across < 0 ? 0 : 6))
      });
      if (input.detailed) add({
        position: [x, deck + 0.045, across],
        shape: "cylinder",
        size: [0.05, 0.05, 0.05],
        surface: "iron",
        radialSegments: 6
      });
    }
    for (let index = 0; index < posts.length - 1; index += 1) {
      const from = posts[index]!, to = posts[index + 1]!;
      for (const height of [0.3, 0.6]) addSlopedBeam({
        across,
        add,
        depth: 0.07,
        from,
        surface: "wood",
        thickness: 0.07,
        tint: timberTint(index + height * 10),
        to,
        yFrom: input.deckTopAt(from) + height,
        yTo: input.deckTopAt(to) + height
      });
    }
  }
};

/** Low timber beam bridge: crib abutments, optional pile bents, stringers, planks and railings. */
export const woodBridgeRecipe = (input: BridgeRecipeInput): BridgeRecipe => {
  const parts: BridgeRecipe["parts"] = [];
  const add = bridgeRecipeAdder(parts);
  const foundations = add(0), deck = add(1), railings = add(2);
  addCribAbutment(input, foundations, 0, 0);
  addCribAbutment(input, foundations, input.length, 3);
  addRiprap(input, foundations);
  addPileBents(input, foundations);
  addStringers(input, deck);
  addDeck(input, deck);
  addWheelGuards(input, deck);
  addRailings(input, railings);
  addWoodBridgeLevelDetails(input, railings, postPositions(input.length));
  return { parts };
};
