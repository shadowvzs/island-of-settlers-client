import { CAMPAIGN_DEFAULT_EXIT } from "../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import {
  type CampaignProgress, type CampaignProgressEntry, isCampaignExitId
} from "../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import { isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";

/**
 * Campaign progress of a slot without a server (plan §5.4 rev H6, §7.4 step 5; lane GS3a): the BR0 progress shape
 * per campaign, kept in `PlayerProgress.campaignProgress`. The first victory of a map records its exit; a later
 * victory never changes it (as the server's progress row), so the graph state matches a signed-in account's.
 */
export type LocalCampaignProgress = Readonly<Record<string, Readonly<Record<string, CampaignProgressEntry>>>>;

const isProgressEntry = (value: unknown) => isPlainObject(value) && isCampaignExitId(value.exit);

/** Absent, or campaign id → map id → `{ exit }` with well-formed exits. */
export const validLocalCampaignProgress = (value: unknown) => value === undefined || (isPlainObject(value) &&
  Object.values(value).every(maps => isPlainObject(maps) && Object.values(maps).every(isProgressEntry)));

/** The campaign's completed maps as the graph helpers read them (`campaignNodeView`, `campaignMapStatuses`). */
export const localCampaignProgressOf = (
  progress: LocalCampaignProgress | undefined, campaignId: string
): CampaignProgress => new Map(Object.entries(progress?.[campaignId] ?? {}));

/** The progress after a won map: its first victory's exit (absent = the implicit `victory`); later wins keep it. */
export const recordLocalCampaignVictory = (
  progress: LocalCampaignProgress | undefined, campaignId: string, mapId: string, exit = CAMPAIGN_DEFAULT_EXIT
): LocalCampaignProgress => {
  const maps = progress?.[campaignId] ?? {};
  if (maps[mapId]) return progress ?? {};
  return { ...progress, [campaignId]: { ...maps, [mapId]: { exit } } };
};
