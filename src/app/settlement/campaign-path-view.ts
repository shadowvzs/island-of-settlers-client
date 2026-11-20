import {
  type CampaignGraph, campaignGraphOrder, type CampaignGraphView, type CampaignNodeState, campaignNodeView,
  type CampaignProgress
} from "../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import type { CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { CampaignMapStatus } from "../../../../island-of-settlers-shared/src/script/engine/home-rewards";
import type { CampaignProgressAnswer } from "../cloud/economy-client";
import { NO_CAMPAIGN_PROGRESS } from "./constants";

/**
 * The server's display states laid over the campaign's own graph (plan §8, rev F12), nodes in graph order. An edge
 * the server does not name (this browser's records differ from the published ones) reads as open.
 */
export const serverPathView = (graph: CampaignGraph, answer: CampaignProgressAnswer): CampaignGraphView => {
  const maps = new Map(answer.maps.map(map => [map.mapId, map]));
  const edges = new Map(answer.edges.map(edge => [edge.id, edge.state]));
  return {
    completed: answer.completed,
    edges: graph.edges.map(edge => ({ edge, state: edges.get(edge.id) ?? "open" })),
    nodes: campaignGraphOrder(graph).map(mapId => {
      const map = maps.get(mapId);
      return { exit: map?.exit ?? null, mapId, state: map?.node ?? "notAvailable" };
    })
  };
};

/**
 * Without a server the shared graph helpers decide every state: a home session knows no completed map, a slot
 * without a home passes its browser progress (GS3b).
 */
export const localPathView = (
  graph: CampaignGraph, mapsById: ReadonlyMap<string, CampaignMap>, progress: CampaignProgress = NO_CAMPAIGN_PROGRESS
) => campaignNodeView(graph, mapsById, progress);

/** The script-facing status of a display state: a closed map cannot start. */
export const nodeMapStatus = (state: CampaignNodeState): CampaignMapStatus =>
  state === "closed" ? "notAvailable" : state;
