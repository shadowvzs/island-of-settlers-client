import { msg } from "@lingui/core/macro";

/** Stable session, load/save and island-travel status copy. Server error bodies stay untranslated. */
export const SESSION_MESSAGES = {
  background: {
    changedElsewhere: msg({
      id: "session.background.changedElsewhere",
      message: "The island changed while you were away. Reloading it…"
    }),
    resumeFailed: msg({ id: "session.background.resumeFailed", message: "Unable to resume the island." }),
    saveFailed: msg({
      id: "session.background.saveFailed",
      message: "Could not save the island before the tab was hidden; autosave will retry."
    })
  },
  campaign: {
    settlersLost: msg({
      id: "session.campaign.settlersLost",
      message: "{lost} settlers came home from the campaign, but the home island was full: they were lost."
    }),
    rewardShip: msg({
      id: "session.campaign.rewardShip",
      message: "A reward ship sails home with {wares}."
    }),
    rewardShipSoldiers: msg({
      id: "session.campaign.rewardShipSoldiers",
      message: "{soldiers, plural, one {# soldier sails} other {# soldiers sail}} home on a reward ship."
    }),
    victoryOffline: msg({
      id: "session.campaign.victoryOffline",
      message: "The victory could not reach the server; try again in a moment."
    }),
    /** BR4: what a stored attempt end means for the account's campaign path (shown at home after the run). */
    campaignCompleted: msg({ id: "session.campaign.completed", message: "Campaign completed: {campaign}" }),
    defaultExit: msg({ id: "session.campaign.defaultExit", message: "Victory" }),
    pathChosen: msg({ id: "session.campaign.pathChosen", message: "Your campaign path: {exit}" }),
    pathStays: msg({ id: "session.campaign.pathStays", message: "Your campaign path stays: {exit}" })
  },
  common: {
    busy: msg({ id: "session.common.busy", message: "Another island change is already under way." }),
    cancel: msg({ id: "session.common.cancel", message: "Cancel" }),
    changedBeforeResume: msg({
      id: "session.common.changedBeforeResume",
      message: "The island changed before it could resume."
    }),
    changedBeforeTravel: msg({
      id: "session.common.changedBeforeTravel",
      message: "The island changed before the travel finished."
    }),
    failed: msg({ id: "session.common.failed", message: "The island could not be changed." }),
    replaceCurrent: msg({ id: "session.common.replaceCurrent", message: "Replace the current game" })
  },
  resume: {
    failed: msg({ id: "session.resume.failed", message: "The island could not be resumed." }),
    importChanged: msg({
      id: "session.resume.importChanged",
      message: "The island changed before the import finished."
    }),
    missingSaved: msg({
      id: "session.resume.missingSaved",
      message: "No saved island is available to resume."
    }),
    updating: msg({ id: "session.resume.updating", message: "Updating your island for time away…" })
  },
  save: {
    accessFailed: msg({ id: "session.save.accessFailed", message: "Unable to access saved game" }),
    exported: msg({ id: "session.save.exported", message: "Game exported." }),
    importAccount: msg({
      id: "session.save.importAccount",
      message: "The imported game replaces the current game and becomes this save slot's save online. The current progress in this slot is lost unless you exported it."
    }),
    importBrowser: msg({
      id: "session.save.importBrowser",
      message: "The imported game replaces the current game saved in this browser. Its progress is lost unless you exported it."
    }),
    importTitle: msg({ id: "session.save.importTitle", message: "Replace the current game?" }),
    loaded: msg({ id: "session.save.loaded", message: "Game loaded." }),
    offlineImportRefused: msg({
      id: "session.save.offlineImportRefused",
      message: "An offline game cannot be imported into an account: it stays an offline game."
    }),
    notGameFile: msg({
      id: "session.save.notGameFile",
      message: "This file is not a game file. Choose a .json file made by Export game."
    }),
    savedAccount: msg({ id: "session.save.savedAccount", message: "Game saved to your account." }),
    savedBrowser: msg({ id: "session.save.savedBrowser", message: "Game saved in this browser." })
  },
  travel: {
    defenderRequired: msg({
      id: "session.travel.defenderRequired",
      message: "At least one defender must remain in each occupied military building."
    }),
    noHarbour: msg({
      id: "session.travel.noHarbour",
      message: "No ship can reach this colony harbour yet."
    }),
    offlineReward: msg({
      id: "session.travel.offlineReward",
      message: "The adventure reward could not reach the server; try again in a moment."
    })
  }
} as const;
