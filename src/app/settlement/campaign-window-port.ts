import {
  campaignGraphOf, type CampaignProgress
} from "../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import type { Campaign, CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { isCampaignOffered } from "../../../../island-of-settlers-shared/src/campaign/campaign-published";
import type { ActiveOperation } from "../../shared/campaign/active-operation";
import { campaignLaunchOf } from "../../shared/campaign/campaign-departure-game";
import { HARBOUR_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { ServerEconomy } from "../cloud/server-economy";
import type { StartMap } from "../map-editor/map-startup";
import type {
  CampaignChoice, CampaignMapChoice, CampaignWindowPort
} from "../settlement-ui/campaign-window/types";
import { localPathView, nodeMapStatus, serverPathView } from "./campaign-path-view";
import type { CampaignRecordSource } from "./campaign-player-source";
import type { CampaignDeparture } from "./campaign-run-start";
import { CAMPAIGN_MAP_FILE_MISSING } from "./constants";

export interface CampaignWindowPortOptions {
  economy?: Pick<ServerEconomy, "campaignProgress">;
  /** A slot without a home (GS3b): its browser progress of one campaign; absent = no completed map. */
  localProgress?(campaignId: string): CampaignProgress;
  /** Real UTC time (ms): a campaign outside its availability window is not offered. */
  now(): number;
  /** The campaign records (the server's published ones, else this browser's); null without any storage. */
  openRepositories(): Promise<CampaignRecordSource | null>;
  operation(): ActiveOperation | null;
  /** Reads the map file a campaign map names (its slot id): the server's published file, else the local slot. */
  readMap(slotId: string): Promise<StartMap>;
  simulation: Pick<SettlementSimulation, "buildings" | "campaignRequirements"> &
    Partial<Pick<SettlementSimulation, "effectiveGameRules">>;
  start(departure: CampaignDeparture): Promise<true | string>;
}

/**
 * The campaign window's port over the home session (C8, BR4): ready campaign records, the account's node and edge
 * states (the server's progress, else the shared graph helpers without completed maps), the shared launch check
 * and the departure. Maps come in graph order.
 */
export const createCampaignWindowPort = (options: CampaignWindowPortOptions): CampaignWindowPort => {
  /** The server's progress; null for guests, offline, or while the server does not know the campaign. */
  const serverProgress = async (campaignId: string) => {
    try {
      return await options.economy?.campaignProgress?.(campaignId) ?? null;
    } catch {
      return null;
    }
  };
  const choiceOf = async (
    campaign: Campaign, repositories: Pick<CampaignRecordSource, "maps">
  ): Promise<CampaignChoice> => {
    const [records, progress] = await Promise.all([
      repositories.maps.list({ campaignId: campaign.id }), serverProgress(campaign.id)
    ]);
    const mapsById = new Map(records.map(record => [record.id, record]));
    const graph = campaignGraphOf(campaign, mapsById);
    const view = progress
      ? serverPathView(graph, progress) : localPathView(graph, mapsById, options.localProgress?.(campaign.id));
    const maps = view.nodes.flatMap(({ exit, mapId, state }): CampaignMapChoice[] => {
      const map = mapsById.get(mapId);
      if (map?.state !== "ready") return [];
      return [{ exit, map, node: state, status: nodeMapStatus(state) }];
    });
    const rewardsShown = options.simulation.effectiveGameRules?.().rewards ?? true;
    return { campaign, completed: view.completed, edges: view.edges, maps, rewardsShown };
  };
  const harbours = () => options.simulation.buildings()
    .filter(building => building.typeId === HARBOUR_TYPE_ID && building.construction === 1);
  /** The first harbour that can launch; else the first harbour's refusal (or "no harbour"). */
  const bestRequirements = (map: CampaignMap) => {
    const launch = campaignLaunchOf(map), slot = options.operation();
    const checks = harbours().map(harbour => ({
      sourceUid: harbour.uid, status: options.simulation.campaignRequirements(harbour.uid, launch, slot)
    }));
    return checks.find(check => check.status.reason === null) ?? checks[0] ??
      { sourceUid: -1, status: options.simulation.campaignRequirements(-1, launch, slot) };
  };
  return {
    load: async () => {
      const repositories = await options.openRepositories();
      if (!repositories) return [];
      const now = options.now();
      const campaigns = (await repositories.campaigns.list({ state: "ready" }))
        .filter(campaign => isCampaignOffered(campaign, now));
      const choices = await Promise.all(campaigns.map(campaign => choiceOf(campaign, repositories)));
      return choices.filter(choice => choice.maps.length > 0);
    },
    requirements: map => bestRequirements(map).status,
    start: async map => {
      const { sourceUid, status } = bestRequirements(map);
      if (status.reason) return status.reason;
      const file = await options.readMap(map.mapFile.id);
      if (!file.loaded) return file.error || CAMPAIGN_MAP_FILE_MISSING;
      return options.start({ loaded: file.loaded, map, sourceUid });
    }
  };
};

/** What the page supplies for campaign departures; the island adds its simulation and session. */
export type CampaignDepartureSources =
  Pick<CampaignWindowPortOptions, "economy" | "now" | "openRepositories" | "readMap">;
