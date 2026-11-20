import { LOADING_MESSAGES } from "./loading-messages";
import type { IslandHandoffTrigger } from "./settlement/island-handoff-policy";

/** Travel copy belongs to explicit travel; resuming or rebuilding the current island is separate. */
export const islandHandoffLoadingMessage = (trigger: IslandHandoffTrigger) => {
  if (trigger === "travel-home") return LOADING_MESSAGES.step.returningHome;
  if (trigger === "travel-first-visit" || trigger === "travel-saved-island")
    return LOADING_MESSAGES.preparing;
  if (trigger === "tab-resume") return LOADING_MESSAGES.catchUp.step;
  return LOADING_MESSAGES.step.preparingView;
};
