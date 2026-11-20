import {
  type CampaignIssue, campaignIssue
} from "../../../../island-of-settlers-shared/src/campaign/campaign-issues";
import type { CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  type GameSettings, hasHomeIsland
} from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import type { CampaignMapFile } from "./campaign-map-file-checks";

/**
 * GS-MAP Check rules of a campaign map file's start setup and map rules (owner Q2/Q5, 2026-11-12): a start without
 * a home island needs people from the map file; an XP reward contradicts a map that switches experience off. The
 * record-only mode rules live in `game-mode/map-mode-checks.ts`.
 */

/** Without a home, a map whose start setup is on but gives neither settlers nor soldiers cannot be played. */
export const checkStoryStart = ({ scenario }: CampaignMapFile, settings: GameSettings, issues: CampaignIssue[]) => {
  if (hasHomeIsland(settings)) return;
  if (scenario.startSetup === "off" || scenario.settlers > 0 || scenario.startTroops?.length) return;
  issues.push(campaignIssue("warning", "campaignMapNoStoryStart", "mapFile"));
};

export const checkXpReward = (map: CampaignMap, { scenario }: CampaignMapFile, issues: CampaignIssue[]) => {
  if (scenario.rules?.experience !== "none" || map.rewards.xp <= 0) return;
  issues.push(campaignIssue("warning", "mapRulesXpReward", "rewards.xp", { xp: map.rewards.xp }));
};
