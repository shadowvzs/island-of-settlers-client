import {
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
const PIER_WIDTH = 0.55;
/** The middle pier carries the full slab width, parapets included. */
const PIER_HALF_WIDTH = STONE_BRIDGE_HALF_WIDTH;

/** Low stone slab (clapper) bridge for the three-tile crossing, with drystone piers. */
export const stoneSlabBridgeRecipe = (input: BridgeRecipeInput): BridgeRecipe => {
  const parts: BridgeRecipe["parts"] = [];
  const add = bridgeRecipeAdder(parts);
  const foundations = add(0), deck = add(1), railings = add(2);
  addStoneAbutment(input, foundations, 0, 0);
  addStoneAbutment(input, foundations, input.length, 3);
  const pierAlong = input.length / 2;
  // Toe stones stop short of the middle pier and its side cutwaters (0.39 half diagonal).
  const riprapReach = pierAlong - 0.75;
  addStoneRiprap(input, foundations, 0, 1, riprapReach);
  addStoneRiprap(input, foundations, input.length, 5, riprapReach);
  const slabBottom = input.deckTopAt(pierAlong) - 0.26;
  const bed = lowestBridgeBed(input, pierAlong, PIER_HALF_WIDTH) - 0.3;
  const courses = Math.min(6,
    Math.max(input.detailed ? 4 : 2, Math.ceil((slabBottom - bed) / COURSE_HEIGHT)));
  const courseHeight = (slabBottom - bed) / courses;
  for (let course = 0; course < courses; course += 1) {
    const y = bed + (course + 0.5) * courseHeight;
    for (const across of [-PIER_HALF_WIDTH / 2, PIER_HALF_WIDTH / 2]) foundations({
      position: [pierAlong + (course % 2 === 0 ? -0.03 : 0.03), y, across],
      shape: "stone-block",
      size: [PIER_WIDTH, courseHeight * 0.92, PIER_HALF_WIDTH - 0.02],
      surface: "stone",
      tint: stoneTint(course + (across < 0 ? 0 : 3))
    });
  }
  addStoneCutwater(input, foundations, pierAlong, slabBottom, 2, -1, PIER_HALF_WIDTH);
  addStoneCutwater(input, foundations, pierAlong, slabBottom, 4, 1, PIER_HALF_WIDTH);
  addStoneDeckSlabs(input, deck);
  addStoneParapet(input, railings);
  addStoneBridgeLevelDetails(input, railings, [pierAlong]);
  return { parts };
};
