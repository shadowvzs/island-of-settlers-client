import type { CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { campaignAttemptNumber } from "../../shared/campaign/campaign-departure-game";
import { type CampaignRunStart, createCampaignRunState } from "../../shared/campaign/campaign-run";
import { homelessRunGame } from "../../shared/campaign/homeless-run";
import type { PlayerProgress } from "../../shared/progression/player-progress";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SimRules } from "../../shared/settlement/sim-rules";
import type { LoadedMap } from "../../shared/world/save/map-reader";
import { buildCampaignRunSave, campaignDepartureWorld } from "./campaign-run-start";

export interface HomelessRunStartInput {
  /** The server attempt of a signed-in slot (ONLINE-STORY); absent for browser slots (untracked, C9a). */
  attempt?: Pick<CampaignRunStart, "attemptId" | "mapStatus">;
  loaded: LoadedMap;
  map: CampaignMap;
  nation: ReturnType<SettlementSimulation["playerNation"]>;
  /** Game time (UTC ms) the run's clock starts at. */
  now: number;
  /** The slot's player progress (campaign progress, quests); absent for a fresh slot. */
  player?: PlayerProgress;
  /** The session rules (browser rules or a lease grant) with `homeIsland: false`, pinned before the first tick. */
  rules: SimRules;
}

/**
 * The first game of a campaign run without a home (plan §7.4 step 4): no departure and no cargo, the map file's own
 * start setup (nothing with `startSetup: "off"`), the session rules pinned, no Monument defenders. The caller saves
 * it to the working slot and boots it like any continued run.
 */
export const buildHomelessRunGame = async (
  { attempt, loaded, map, nation, now, player, rules }: HomelessRunStartInput
): Promise<GameSaveV1> => {
  if (rules.homeIsland) throw new Error("A run without a home needs rules without a home island");
  const world = campaignDepartureWorld({ loaded, map });
  const identity = { attempt: campaignAttemptNumber(now), campaignId: map.campaignId, mapId: map.id };
  const run = createCampaignRunState(identity, { ...attempt, ...rules.rewards ? { rewards: map.rewards } : {} });
  const runSave = await buildCampaignRunSave({ loaded, map, nation, now, rules, run, troops: [], world });
  return homelessRunGame(runSave, now, player);
};
