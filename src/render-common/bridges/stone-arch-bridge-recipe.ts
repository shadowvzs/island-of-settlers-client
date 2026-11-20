import {
  type AddBridgePart,
  type BridgeRecipe,
  bridgeRecipeAdder,
  type BridgeRecipeInput,
  lowestBridgeBed,
  stoneTint
} from "./bridge-recipe";
import { addStoneBridgeLevelDetails } from "./stone-bridge-levels";
import {
  addStoneAbutment,
  addStoneCutwater,
  addStoneDeckSlabs,
  addStoneRiprap,
  STONE_BRIDGE_HALF_WIDTH
} from "./stone-bridge-parts";
import { addStoneParapet } from "./stone-parapet";

const COURSE_HEIGHT = 0.3;
const DECK_THICKNESS = 0.26;
const RING_THICKNESS = 0.22;
const MIN_ARCH_RISE = 0.2;
/** Ring, spandrels and piers share the deck's outer face, so the parapets stand on solid masonry. */
const PIER_HALF_WIDTH = STONE_BRIDGE_HALF_WIDTH;
/** Spandrel face walls: under each parapet, from the arch ring up to the deck slabs. */
const SPANDREL_CENTRE = 1.42;
const SPANDREL_THICKNESS = 0.28;

/** Segmental arch profile for one span: span:rise 4:1, fitted under the deck. */
const archGeometry = (input: BridgeRecipeInput, center: number, span: number) => {
  const deck = input.deckTopAt(center);
  const bed = Math.max(
    input.terrainAt(center - span / 3, 0),
    input.terrainAt(center + span / 3, 0),
    input.waterAt(center, 0)
  );
  const available = deck - DECK_THICKNESS - RING_THICKNESS - bed - 0.12;
  const rise = Math.max(MIN_ARCH_RISE, Math.min(span / 4, available));
  const spring = deck - DECK_THICKNESS - RING_THICKNESS - rise;
  return { bed, deck, rise, spring, span };
};

/** Deck slab underside: shared deck height less the sunk slab (see `addStoneDeckSlabs`). */
const SLAB_UNDERSIDE = DECK_THICKNESS + 0.012;
/** Outer edge of the ring at `along`, or the springing beyond the ring's ends. */
const extradosAt = (geometry: ReturnType<typeof archGeometry>, center: number, along: number) => {
  const reach = geometry.span / 2 + RING_THICKNESS, offset = (along - center) / reach;
  return geometry.spring + (geometry.rise + RING_THICKNESS) * Math.sqrt(Math.max(0, 1 - offset * offset));
};

/**
 * Spandrel face walls fill each haunch between the arch ring and the deck slabs under both parapets,
 * so the deck edge and parapet stand on solid coursed masonry, not on air.
 */
const addSpandrels = (input: BridgeRecipeInput, add: AddBridgePart, archCount: number, span: number) => {
  const step = input.detailed ? 0.34 : 0.62, maxCourse = input.detailed ? 0.2 : 1;
  for (let arch = 0; arch < archCount; arch += 1) {
    const center = (arch + 0.5) * span, geometry = archGeometry(input, center, span);
    const stones = Math.max(1, Math.round(span / step)), stoneLength = span / stones;
    for (let stone = 0; stone < stones; stone += 1) {
      const from = arch * span + stone * stoneLength, to = from + stoneLength;
      const bottom = Math.min(extradosAt(geometry, center, from), extradosAt(geometry, center, to)) - 0.03;
      const top = Math.min(input.deckTopAt(from), input.deckTopAt(to)) - SLAB_UNDERSIDE + 0.01;
      if (top - bottom < 0.05) continue;
      const courses = Math.ceil((top - bottom) / maxCourse), height = (top - bottom) / courses;
      for (let course = 0; course < courses; course += 1)
        for (const side of [-1, 1]) add({
          position: [(from + to) / 2, bottom + (course + 0.5) * height, side * SPANDREL_CENTRE],
          shape: "stone-block",
          size: [stoneLength - 0.02, height - 0.015, SPANDREL_THICKNESS],
          surface: "stone",
          tint: stoneTint(stone * 2 + course + arch * 5 + (side < 0 ? 0 : 3))
        });
    }
  }
};

/** Level 5: a keystone 0.07 proud of both faces at each arch crown, bedded 0.03 into the ring. */
const addKeystones = (
  input: BridgeRecipeInput, add: AddBridgePart, along: number, crown: number, blockLength: number
) => {
  for (const side of [-1, 1]) add({
    position: [along, crown + 0.03, side * (PIER_HALF_WIDTH + 0.02)],
    shape: input.detailed ? "bevel-box" : "box",
    size: [blockLength * 0.8, RING_THICKNESS * 1.2, 0.1],
    surface: "cut-stone",
    tint: stoneTint(side < 0 ? 7 : 9)
  });
};

export const stoneArchBridgeRecipe = (input: BridgeRecipeInput): BridgeRecipe => {
  const parts: BridgeRecipe["parts"] = [];
  const add = bridgeRecipeAdder(parts);
  const foundations = add(0), deck = add(1), railings = add(2);
  const archCount = Math.max(1, Math.ceil(input.length / 2.5));
  const span = input.length / archCount;
  addStoneAbutment(input, foundations, 0, 0);
  addStoneAbutment(input, foundations, input.length, 3);
  addStoneRiprap(input, foundations, 0, 1);
  addStoneRiprap(input, foundations, input.length, 5);

  for (let arch = 0; arch < archCount; arch += 1) {
    const center = (arch + 0.5) * span;
    const { bed, rise, spring } = archGeometry(input, center, span);
    const ringX = span / 2 + RING_THICKNESS / 2;
    const ringY = rise + RING_THICKNESS / 2;
    const blocks = input.detailed ? 13 : 7;
    const arc = Math.PI * Math.sqrt((ringX * ringX + ringY * ringY) / 2);
    const blockLength = arc / (blocks - 1) * 1.16;
    for (let block = 0; block < blocks; block += 1) {
      const angle = Math.PI * block / (blocks - 1);
      const along = center + ringX * Math.cos(angle);
      const y = spring + ringY * Math.sin(angle);
      const tangent = Math.atan2(ringY * Math.cos(angle), -ringX * Math.sin(angle));
      foundations({
        position: [along, y, 0],
        rotation: [0, 0, tangent],
        shape: input.detailed ? "bevel-box" : "box",
        size: [blockLength, RING_THICKNESS, PIER_HALF_WIDTH * 2],
        surface: "cut-stone",
        tint: stoneTint(block + arch * 3)
      });
    }
    if ((input.level ?? 0) >= 4) addKeystones(input, railings, center, spring + ringY, blockLength);
    // Solid pier below the springing: the ring bears on it, and it stands on the river bed.
    if (arch < archCount - 1) {
      const pierAlong = (arch + 1) * span;
      const top = Math.max(spring - 0.12, bed + 0.25);
      const footing = Math.min(bed, lowestBridgeBed(input, pierAlong, PIER_HALF_WIDTH) - 0.3);
      const courses = Math.max(input.detailed ? 4 : 2, Math.ceil((top - footing) / COURSE_HEIGHT));
      const courseHeight = (top - footing) / courses;
      for (let course = 0; course < courses; course += 1) {
        const y = footing + (course + 0.5) * courseHeight;
        for (const across of [-PIER_HALF_WIDTH / 2, PIER_HALF_WIDTH / 2]) foundations({
          position: [pierAlong + (course % 2 === 0 ? -0.03 : 0.03), y, across],
          shape: "stone-block",
          size: [0.78, courseHeight * 0.92, PIER_HALF_WIDTH - 0.02],
          surface: "stone",
          tint: stoneTint(course + arch + (across < 0 ? 0 : 3))
        });
      }
      addStoneCutwater(input, foundations, pierAlong, top, arch + 8, -1, PIER_HALF_WIDTH);
      addStoneCutwater(input, foundations, pierAlong, top, arch + 12, 1, PIER_HALF_WIDTH);
    }
  }

  addSpandrels(input, foundations, archCount, span);
  addStoneDeckSlabs(input, deck);
  addStoneParapet(input, railings);
  const piers = Array.from({ length: archCount - 1 }, (_, arch) => (arch + 1) * span);
  addStoneBridgeLevelDetails(input, railings, piers.length ? piers : [input.length / 2]);
  return { parts };
};
