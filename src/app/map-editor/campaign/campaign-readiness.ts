import { CAMPAIGN_DEFAULT_LANGUAGES } from "../../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import { unusedExitIssues } from "../../../../../island-of-settlers-shared/src/campaign/campaign-exit-usage";
import { exitsOf } from "../../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import {
  campaignIssue, type CampaignValidationResult, campaignValidationResult
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-issues";
import type {
  Campaign, CampaignMap, CampaignRewards
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { validateCampaignReady } from "../../../../../island-of-settlers-shared/src/campaign/campaign-ready-validation";
import { validateRewardEntries } from "../../../../../island-of-settlers-shared/src/catalog/validate/rewards";
import type { GameSettings } from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { namedActorIds } from "../../../../../island-of-settlers-shared/src/script/actor-names";
import type { ScriptIssue } from "../../../../../island-of-settlers-shared/src/script/issues";
import { questRewardEntries } from "../../../../../island-of-settlers-shared/src/script/quest-rewards";
import type { WorldData } from "../../../shared/world/world-data";
import type { CampaignMapCheck, CampaignReadyReport } from "./campaign-editor-state";
import { scriptPathNames } from "./check/path-labels";
import { CAMPAIGN_CHECK_LANGUAGES } from "./constants";

/** Reads a map file's bytes (the campaign slot), or null when it was never saved. */
export type ReadMapFileBytes = (slotId: string) => Promise<Uint8Array | null>;

/** What a map check reads besides the records: stored images, the map files and the deployment's game settings. */
export interface MapCheckSource {
  imageIds: ReadonlySet<string>;
  readBytes: ReadMapFileBytes;
  /** The game mode the map is checked against (plan §13.4, rev H11). */
  settings: GameSettings;
}

/** The Ready check of the campaign document against its working maps and the stored images. */
export const checkCampaign = (
  campaign: Campaign, maps: readonly CampaignMap[], imageIds: ReadonlySet<string>,
  languages: readonly string[] = CAMPAIGN_DEFAULT_LANGUAGES
) => validateCampaignReady(campaign, maps, { imageIds, languages });

/** The map file of a campaign map (loaded on first use, so the campaign editor chunk stays small), or null. */
const readMapWorld = async (map: CampaignMap, readBytes: ReadMapFileBytes): Promise<WorldData | null> => {
  const bytes = await readBytes(map.mapFile.id);
  if (!bytes) return null;
  const { readMapFile } = await import("../../../shared/world/save/map-reader");
  return (await readMapFile(bytes)).world;
};

const mapFileMissing = (map: CampaignMap) =>
  campaignValidationResult([campaignIssue("error", "campaignMapFileMissing", "mapFile", { mapId: map.id })]);

const checkMapRecord = async (
  map: CampaignMap, campaign: Campaign, world: WorldData, { imageIds, settings }: MapCheckSource,
  languages: readonly string[]
) => {
  const { validateCampaignMap } = await import("../../../shared/campaign/validate-campaign-map");
  // A speak step may name a campaign speaker or a named actor of the map file's script (a pirate, a bandit).
  const namedActors = world.script ? namedActorIds(world.script) : undefined;
  return validateCampaignMap(map, world,
    { imageIds, languages, namedActorIds: namedActors, speakers: campaign.speakers ?? [] }, settings);
};

/** The C7a Ready check of one map with its saved map file (`validateCampaignMap`). */
export const checkCampaignMap = async (
  map: CampaignMap, campaign: Campaign, source: MapCheckSource
): Promise<CampaignValidationResult> => {
  const world = await readMapWorld(map, source.readBytes);
  if (!world) return mapFileMissing(map);
  return checkMapRecord(map, campaign, world, source, CAMPAIGN_DEFAULT_LANGUAGES);
};

/**
 * Reward lines checked by the shared reward validator (`validateRewardEntries` over the RewardPicker lines), as
 * `invalidReward` issues under `path`.
 */
export const rewardLineIssues = (rewards: CampaignRewards | null, path: string): ScriptIssue[] => {
  if (!rewards) return [];
  const entries = questRewardEntries({ ...rewards, buildingUnlocks: [] });
  return validateRewardEntries(entries, {}, path).map(issue =>
    ({ code: "invalidReward", params: { detail: issue.message }, path: issue.path, severity: "error" }));
};

/** The reward lines of a map record: its victory rewards and every quest's home reward. */
const mapRewardIssues = (map: CampaignMap) => [
  ...rewardLineIssues(map.rewards, "rewards"),
  ...map.quests.flatMap((quest, index) => rewardLineIssues(quest.homeReward, `quests[${index}].homeReward`))
];

/**
 * The map file's script Ready check (`validateWorldScript`) against the records: the campaign's speakers and the
 * map's exits (an `endMap` naming an undeclared exit is `endMapUnknownExit`); null for a file without a script.
 */
const checkMapScript = async (world: WorldData, campaign: Campaign, map: CampaignMap) => {
  const { validateWorldScript } = await import("../../../shared/world/world-script-ready");
  return validateWorldScript(world, {
    exitIds: new Set(exitsOf(map)), languages: CAMPAIGN_CHECK_LANGUAGES,
    mapKind: world.scenario?.kind ?? "campaign",
    speakerIds: new Set((campaign.speakers ?? []).map(speaker => speaker.id))
  });
};

/** The record's result with the Check-only exit rule: declared exits no `endMap` of the map file names. */
const withUnusedExits = (result: CampaignValidationResult, map: CampaignMap, world: WorldData) => {
  const unused = unusedExitIssues(map, world.script);
  return unused.length ? campaignValidationResult([...result.errors, ...result.warnings, ...unused]) : result;
};

const checkMapFully = async (
  map: CampaignMap, campaign: Campaign, source: MapCheckSource
): Promise<CampaignMapCheck> => {
  const rewards = mapRewardIssues(map);
  const world = await readMapWorld(map, source.readBytes);
  if (!world) return { mapId: map.id, result: mapFileMissing(map), rewards, script: null };
  const [record, script] = await Promise.all([
    checkMapRecord(map, campaign, world, source, CAMPAIGN_CHECK_LANGUAGES), checkMapScript(world, campaign, map)
  ]);
  const scriptNames = world.script ? scriptPathNames(world.script) : undefined;
  return { mapId: map.id, result: withUnusedExits(record, map, world), rewards, script, scriptNames };
};

/**
 * The whole-campaign Check (CUX-CHECK): the campaign document, every map record with its map file, each file's
 * script, and the reward lines, in every game language and against the deployment's game mode (`source.settings`).
 * Only existing validators run; nothing is re-implemented.
 */
export const checkWholeCampaign = async (
  campaign: Campaign, maps: readonly CampaignMap[], source: MapCheckSource
): Promise<CampaignReadyReport> => ({
  campaign: checkCampaign(campaign, maps, source.imageIds, CAMPAIGN_CHECK_LANGUAGES),
  campaignRewards: rewardLineIssues(campaign.rewards, "rewards"),
  maps: await Promise.all(maps.map(map => checkMapFully(map, campaign, source)))
});

/** Errors and warnings of a report, every document and source counted. */
export const reportTotals = (report: CampaignReadyReport) => {
  const scripts = report.maps.flatMap(entry => (entry.script ? [entry.script] : []));
  const rewardErrors = (report.campaignRewards?.length ?? 0) +
    report.maps.reduce((sum, entry) => sum + (entry.rewards?.length ?? 0), 0);
  const results = [report.campaign, ...report.maps.map(entry => entry.result), ...scripts];
  return {
    errors: rewardErrors + results.reduce((sum, result) => sum + result.errors.length, 0),
    warnings: results.reduce((sum, result) => sum + result.warnings.length, 0)
  };
};
