import { msg } from "@lingui/core/macro";

/** Campaign paths (BR3): exits, "Leads to" edges, start maps and the linear helper (en source; hu/de: BR-I18N). */
export const CAMPAIGN_PATH_MESSAGES = {
  addExit: msg({ id: "campaignEditor.paths.addExit", message: "Add an exit" }),
  campaignEnds: msg({ id: "campaignEditor.paths.campaignEnds", message: "Campaign ends" }),
  confirmLinear: msg({
    id: "campaignEditor.paths.confirmLinear",
    message: "Replace every path and start map with the linear play order?"
  }),
  defaultExit: msg({ id: "campaignEditor.paths.defaultExit", message: "Victory (default exit)" }),
  deleteExit: msg({ id: "campaignEditor.paths.deleteExit", message: "Delete exit \"{name}\"" }),
  deleteRefusedReady: msg({
    id: "campaignEditor.paths.deleteRefusedReady",
    message: "A Ready map keeps its exits (players may have won through them); rename it instead."
  }),
  deleteRefusedUsed: msg({
    id: "campaignEditor.paths.deleteRefusedUsed", message: "Exit \"{name}\" still leads to: {targets}."
  }),
  epilogue: msg({ id: "campaignEditor.paths.epilogue", message: "Epilogue" }),
  exitName: msg({ id: "campaignEditor.paths.exitName", message: "Exit name" }),
  exits: msg({ id: "campaignEditor.paths.exits", message: "Exits and paths" }),
  leadsTo: msg({ id: "campaignEditor.paths.leadsTo", message: "Leads to" }),
  linearBadge: msg({ id: "campaignEditor.paths.linearBadge", message: "Linear (play order)" }),
  linearNote: msg({
    id: "campaignEditor.paths.linearNote",
    message: "Linear: each map leads to the next. Editing exits, paths or start maps stores the graph."
  }),
  makeLinear: msg({
    id: "campaignEditor.paths.makeLinear", message: "Make linear: rebuild the paths from the play order"
  }),
  mapEpilogue: msg({ id: "campaignEditor.paths.mapEpilogue", message: "Map epilogue" }),
  missingSequence: msg({ id: "campaignEditor.paths.missingSequence", message: "{id} (deleted)" }),
  previousLock: msg({
    id: "campaignEditor.paths.previousLock",
    message: "This map still requires the previous map; a branching campaign ignores that lock."
  }),
  removePreviousLock: msg({
    id: "campaignEditor.paths.removePreviousLock", message: "Remove the unused previous-map lock"
  }),
  startMaps: msg({ id: "campaignEditor.paths.startMaps", message: "Start maps" }),
  startMapsNote: msg({
    id: "campaignEditor.paths.startMapsNote", message: "Start maps are available when the campaign begins."
  })
};
