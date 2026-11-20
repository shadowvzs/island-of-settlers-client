import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import {
  type BuildingPart,
  createRomanBuildingRecipe
} from "../src/render-common/buildings/building-recipe";
import { romanConstructionStage } from "../src/renderers/three/buildings/roman-construction";
import { WOODCUTTER_TYPE_ID } from "../src/shared/settlement/building-type-ids";

/** Full-footprint horizontal plate at wall-head height (the roof deck of the default structure). */
const isRoofDeck = (part: BuildingPart) => part.shape === "box" && part.size[0] > 1 &&
  part.size[2] > 1 && part.size[1] < .16 && part.position[1] > 1 && part.position[1] < 1.3;

const woodcutterParts = () =>
  createRomanBuildingRecipe(getBuildingDefinition(WOODCUTTER_TYPE_ID), true, true).parts;

describe("Roman construction timber", () => {
  it("shows the woodcutter roof deck as timber until the finished stone ceiling takes over", () => {
    const decks = woodcutterParts().filter(isRoofDeck);
    expect(decks).toHaveLength(1);
    const deck = decks[0]!;
    expect(deck).toMatchObject({ constructionDeck: true, surface: "stone", stage: 3 });
    // The frame and its deck appear together; a finished-only stage would leave the rafters floating.
    expect(romanConstructionStage(deck)).toBe(2);
  });

  it("keeps the exposed roof-support plates on the wood surface", () => {
    const supports = woodcutterParts().filter(part => part.roofSupport && part.size[0] > .8 &&
      part.size[1] < .1);
    expect(supports.length).toBeGreaterThan(0);
    for (const support of supports) expect(support.surface).toBe("wood");
  });
});
