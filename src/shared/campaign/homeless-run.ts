import type { PlayerProgress } from "../progression/player-progress";
import type { GameSaveV1 } from "../settlement/game-save";
import { campaignRunMarker, type CampaignRunState } from "./campaign-run";
import { recordLocalCampaignVictory } from "./local-campaign-progress";

/**
 * Campaign runs without a home island (plan §7.4 steps 4–5, lane GS3a). The session holds only the run: no filed
 * home, no departure, no cargo, no return voyage. Its island pins the session rules (`homeIsland: false`), which is
 * what lets `readGameSave` accept the missing home.
 */

/** The run's first game: the run on screen, its marker in an otherwise empty group, the slot's player progress. */
export const homelessRunGame = (run: GameSaveV1, createdAt: number, player?: PlayerProgress): GameSaveV1 => {
  if (!run.campaignRun) throw new Error("The campaign run has no campaign state");
  const campaign = { ...campaignRunMarker(run.campaignRun), runCreatedAt: createdAt };
  return { ...run, archipelago: { active: null, campaign, colonies: [], version: 1 }, ...(player ? { player } : {}) };
};

/**
 * The slot's player progress after the run ended: a victory records the map's exit once (the next map opens per
 * the graph); a defeat or give-up records nothing and never opens a new map. Nothing sails anywhere.
 */
export const homelessRunEndProgress = (
  run: Pick<CampaignRunState, "campaignId" | "exit" | "mapId" | "status">, player: PlayerProgress
): PlayerProgress => {
  if (run.status !== "won") return player;
  const campaignProgress = recordLocalCampaignVictory(player.campaignProgress, run.campaignId, run.mapId, run.exit);
  return { ...player, campaignProgress };
};
