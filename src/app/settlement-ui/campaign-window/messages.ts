import { msg } from "@lingui/core/macro";

/** Campaign window copy (C8): the map list with lock state, what leaves home storage and the departure. */
export const CAMPAIGN_WINDOW_MESSAGES = {
  campaign: msg({ id: "campaign.window.campaign", message: "Campaign" }),
  cargo: msg({ id: "campaign.window.cargo", message: "Leaves home storage" }),
  chip: msg({ id: "campaign.window.chip", message: "{name}: {available} of {required}" }),
  completed: msg({ id: "campaign.window.completed", message: "You reached an ending of this campaign." }),
  completedUnrewarded: msg({ id: "campaign.window.completedUnrewarded", message: "Completed" }),
  depart: msg({ id: "campaign.window.depart", message: "Set sail" }),
  departing: msg({ id: "campaign.window.departing", message: "The fleet is leaving…" }),
  empty: msg({ id: "campaign.window.empty", message: "No campaign is available yet." }),
  launcher: msg({ id: "campaign.window.launcher", message: "Campaign" }),
  loading: msg({ id: "campaign.window.loading", message: "Reading the campaigns…" }),
  mapName: msg({ id: "campaign.window.mapName", message: "{order}. {name}" }),
  maps: msg({ id: "campaign.window.maps", message: "Maps" }),
  noCargo: msg({ id: "campaign.window.noCargo", message: "This map needs no cargo." }),
  pathNode: msg({ id: "campaign.window.pathNode", message: "{order}. {name}: {status}" }),
  paths: msg({ id: "campaign.window.paths", message: "Campaign paths" }),
  ready: msg({ id: "campaign.window.ready", message: "Everything is ready to sail." }),
  settlers: msg({ id: "campaign.window.settlers", message: "Idle settlers" }),
  ships: msg({ id: "campaign.window.ships", message: "Ships: {needed} needed, {idle} idle" }),
  status: {
    available: msg({ id: "campaign.window.status.available", message: "Available" }),
    closed: msg({ id: "campaign.window.status.closed", message: "Another path was chosen" }),
    completed: msg({
      id: "campaign.window.status.completed",
      message: "Completed: a replay pays a third of the home rewards"
    }),
    notAvailable: msg({
      id: "campaign.window.status.notAvailable",
      message: "Locked: complete the previous map first"
    })
  },
  title: msg({ id: "campaign.window.title", message: "Campaign" }),
  won: msg({ id: "campaign.window.won", message: "Won: {exit}" })
};
