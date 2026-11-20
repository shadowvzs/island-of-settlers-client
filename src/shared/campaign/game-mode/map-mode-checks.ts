import {
  type CampaignIssue, campaignIssue
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-issues";
import type { CampaignMap } from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  type GameSettings, hasHomeIsland
} from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { HOME_UNLOCK_KINDS } from "./constants";
import { rewardScopeOf } from "./reward-scope";

/**
 * Check rules of a campaign map record against the game mode (owner Q2, 2026-11-12; plan §13.3). With a home
 * island the expedition ships the required cargo and a won map pays rewards home; without one, home-bound unlock
 * conditions are ignored. A mode switch therefore shows the other mode's warnings. Record only (no map file), so
 * the campaign editor shows them beside the map's settings without loading the map.
 */

const hasVictoryRewards = ({ rewards }: CampaignMap) => rewards.coins > 0 || rewards.gems > 0 || rewards.xp > 0 ||
  rewards.goods.length > 0 || rewards.decorations.length > 0 || (rewards.settlers ?? 0) > 0 ||
  (rewards.soldiers?.length ?? 0) > 0;

/** Only a game that pays rewards home asks for them; rewards off or wallet-only rewards are not checked. */
export const checkModeRewards = (map: CampaignMap, settings: GameSettings, issues: CampaignIssue[]) => {
  if (rewardScopeOf(settings) !== "all" || hasVictoryRewards(map)) return;
  issues.push(campaignIssue("warning", "campaignMapNoRewards", "rewards", { mapId: map.id }));
};

/** With a home, the required cargo is all that lands: without settlers and soldiers the run starts empty. */
export const checkLaunchCargo = (map: CampaignMap, settings: GameSettings, issues: CampaignIssue[]) => {
  if (!hasHomeIsland(settings)) return;
  const { settlers, soldiers } = map.requiredCargo;
  if (settlers > 0 || soldiers.some(line => line.amount > 0)) return;
  issues.push(campaignIssue("warning", "campaignMapNoLaunchCargo", "requiredCargo", { mapId: map.id }));
};

/** Without a home, unlock conditions on home goods or home buildings never hold and are ignored. */
export const checkHomeUnlock = (map: CampaignMap, settings: GameSettings, issues: CampaignIssue[]) => {
  if (hasHomeIsland(settings)) return;
  map.unlock.forEach((condition, index) => {
    if (!HOME_UNLOCK_KINDS.has(condition.kind)) return;
    issues.push(campaignIssue("warning", "campaignMapHomeUnlock", `unlock[${index}]`, { kind: condition.kind }));
  });
};

/** Every mode warning of the map record, in a stable order. */
export const mapRecordModeIssues = (map: CampaignMap, settings: GameSettings): CampaignIssue[] => {
  const issues: CampaignIssue[] = [];
  checkModeRewards(map, settings, issues);
  checkLaunchCargo(map, settings, issues);
  checkHomeUnlock(map, settings, issues);
  return issues;
};
