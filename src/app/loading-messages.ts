import { msg } from "@lingui/core/macro";

/** Stable loading-screen, client catch-up and island startup copy. */
export const LOADING_MESSAGES = {
  catchUp: {
    progress: msg({
      id: "loading.catchUp.progress",
      message: "Updating your islands for time away… {percent}%"
    }),
    step: msg({ id: "loading.catchUp.step", message: "Updating your islands for time away…" })
  },
  colony: {
    charting: msg({ id: "loading.colony.charting", message: "Charting the colony island..." })
  },
  discard: msg({ id: "loading.discard", message: "Discarding offline progress…" }),
  preparing: msg({ id: "loading.preparing", message: "Preparing the voyage..." }),
  skip: {
    action: msg({ id: "loading.skip.action", message: "Skip waiting and discard offline progress" })
  },
  failure: {
    colonyUnreachable: msg({
      id: "loading.failure.colonyUnreachable",
      message: "Unable to reach the colony"
    }),
    loadGame: msg({ id: "loading.failure.loadGame", message: "Unable to load game" }),
    message: msg({
      id: "loading.failure.message",
      message: "The island could not be loaded. Please try again."
    }),
    reload: msg({ id: "loading.failure.reload", message: "Reload island" }),
    storageUnavailable: msg({
      id: "loading.failure.storageUnavailable",
      message: "Saved game storage is unavailable in this browser."
    })
  },
  step: {
    building: msg({ id: "loading.step.building", message: "Building terrain, rocks and plants..." }),
    checkingGraphics: msg({ id: "loading.step.checkingGraphics", message: "Checking graphics..." }),
    generating: msg({ id: "loading.step.generating", message: "Generating the island..." }),
    placingAnimals: msg({ id: "loading.step.placingAnimals", message: "Placing the animals..." }),
    preparingView: msg({ id: "loading.step.preparingView", message: "Preparing the first view…" }),
    returningHome: msg({ id: "loading.step.returningHome", message: "Returning to the home island..." })
  }
} as const;
