import { expect, it } from "vitest";

import { garrisonSlots } from "../src/render-common/buildings/military-garrison-slots";
import baseline from "./fixtures/persian-garrison-before-openings.json";

it.each(baseline)("preserves original Persian garrison contacts for $id/High=$detailed", entry => {
  expect(garrisonSlots(entry.id, "persian", entry.detailed)).toEqual(entry.slots);
});
