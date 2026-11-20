import { expect, it } from "vitest";

import { islandHandoffLoadingMessage } from "../src/app/island-handoff-loading";
import { LOADING_MESSAGES } from "../src/app/loading-messages";
import { IN_PAGE_HANDOFF_TRIGGERS } from "../src/app/settlement/island-handoff-policy";

it("uses voyage copy only for island visits, and home copy only for returning home", () => {
  for (const trigger of IN_PAGE_HANDOFF_TRIGGERS) {
    const message = islandHandoffLoadingMessage(trigger);
    expect(message === LOADING_MESSAGES.preparing)
      .toBe(trigger === "travel-first-visit" || trigger === "travel-saved-island");
    expect(message === LOADING_MESSAGES.step.returningHome).toBe(trigger === "travel-home");
  }
  expect(islandHandoffLoadingMessage("tab-resume")).toBe(LOADING_MESSAGES.catchUp.step);
});
