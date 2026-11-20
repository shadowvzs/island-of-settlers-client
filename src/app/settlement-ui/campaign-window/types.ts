import type {
  CampaignEdgeView, CampaignNodeState
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import type { Campaign, CampaignMap } from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { CampaignMapStatus } from "../../../../../island-of-settlers-shared/src/script/engine/home-rewards";
import type { CampaignRequirementStatus } from "../../../shared/campaign/campaign-requirements";

/** One playable map of a campaign with the account's lock and display state. */
export interface CampaignMapChoice {
  /** The exit of the map's first victory (the account's path); null while it is not completed. */
  exit: string | null;
  map: CampaignMap;
  /** Display state (BR4): `closed` marks a branch the player did not take. */
  node: CampaignNodeState;
  status: CampaignMapStatus;
}

/** A ready campaign, its ready maps in graph order and its paths with their state (BR4). */
export interface CampaignChoice {
  campaign: Campaign;
  /** The account reached an ending of the campaign. */
  completed: boolean;
  /** Every edge of the campaign graph with its state (`taken · open · closed`). */
  edges: CampaignEdgeView[];
  maps: CampaignMapChoice[];
  /** False while the game's rules switch rewards off (plan §9.3): the window names no reward. Absent = shown. */
  rewardsShown?: boolean;
}

/** What the campaign window asks of the session (home island only); the session owns every rule. */
export interface CampaignWindowPort {
  /** Ready campaigns with their maps and lock state; empty when none can be read. */
  load(): Promise<CampaignChoice[]>;
  /** The launch check of one map from the home harbour that can send the most. */
  requirements(map: CampaignMap): CampaignRequirementStatus;
  /** Leaves for the map: true, or the English domain refusal (empty when the session already said why). */
  start(map: CampaignMap): Promise<true | string>;
}
