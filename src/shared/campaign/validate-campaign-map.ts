import {
  type CampaignIssue, campaignIssue, type CampaignValidationResult, campaignValidationResult
} from "../../../../island-of-settlers-shared/src/campaign/campaign-issues";
import type { CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  validateCampaignMapReady
} from "../../../../island-of-settlers-shared/src/campaign/campaign-ready-validation";
import {
  DEFAULT_ONLINE_SETTINGS, type GameSettings
} from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { LANDING_HARBOUR_MISSING } from "../settlement/constants";
import { validateMapScenario } from "../settlement/settlement-map-scenario";
import { isMapScenario } from "../world/map-scenario";
import type { WorldData } from "../world/world-data";
import { type CampaignMapContextOptions, createCampaignMapContext } from "./campaign-map-context";
import {
  type CampaignMapFile, checkIgnoredRules, checkLandingHarbour, checkPlayerSlots, checkTroopPoints, checkVictoryTarget
} from "./campaign-map-file-checks";
import { checkStoryStart, checkXpReward } from "./campaign-map-start-checks";
import { mapRecordModeIssues } from "./game-mode/map-mode-checks";

/** The map file is a valid campaign scenario, or the issue that says why not. */
const campaignMapFile = (world: WorldData): CampaignMapFile | CampaignIssue => {
  const { scenario } = world;
  if (!scenario) return campaignIssue("error", "mapFileNotCampaign", "mapFile");
  if (!isMapScenario(scenario, world.cellsX, world.cellsZ))
    return campaignIssue("error", "mapScenarioError", "mapFile", { message: "Invalid scenario definition" });
  if (scenario.kind !== "campaign") return campaignIssue("error", "mapFileNotCampaign", "mapFile");
  return { scenario, world };
};

/**
 * Placement, garrison exits, roads and land reachability of every enemy unit, patrol and building from the landing
 * harbour (review R17), as reported by the editor's Play check.
 */
const scenarioPlayIssues = (world: WorldData) => validateMapScenario(world)
  .filter(message => message !== LANDING_HARBOUR_MISSING)
  .map(message => campaignIssue("error", "mapScenarioError", "mapFile", { message }));

const mapFileIssues = (map: CampaignMap, world: WorldData, settings: GameSettings) => {
  const file = campaignMapFile(world);
  if (!("scenario" in file)) return [file];
  const issues: CampaignIssue[] = [];
  issues.push(...mapRecordModeIssues(map, settings));
  checkStoryStart(file, settings, issues);
  checkXpReward(map, file, issues);
  checkLandingHarbour(file, issues);
  checkPlayerSlots(file, issues);
  checkVictoryTarget(map, file, issues);
  checkTroopPoints(map, file, issues);
  checkIgnoredRules(map, file, issues);
  issues.push(...scenarioPlayIssues(world));
  return issues;
};

/**
 * C7a: everything a campaign map must pass before "Ready" / "Publish to campaign" — every C1 map field
 * (`validateCampaignMapReady` with the catalog context, regions and their reachability included) plus its map file:
 * a campaign scenario, no player HQ and the landing harbour on a harbour spot (R4), one hostile faction and no
 * allied slot (R6), a target for the victory rule and a troop-point advisory (item 38), map-file rule fields the
 * run overrides, and the editor's placement/reachability proof with every enemy reachable by land from the landing
 * harbour (R17), and the start setup, launch cargo, unlock conditions and rewards against the game mode `settings`
 * (GS-MAP, MODE-EDITOR; the default home-island mode when the caller knows no settings). Pure apart from the world reads; draft saves skip it.
 */
export const validateCampaignMap = (
  map: CampaignMap, world: WorldData, options: CampaignMapContextOptions,
  settings: GameSettings = DEFAULT_ONLINE_SETTINGS
): CampaignValidationResult => {
  const ready = validateCampaignMapReady(map, createCampaignMapContext(world, options));
  return campaignValidationResult([...ready.errors, ...ready.warnings, ...mapFileIssues(map, world, settings)]);
};
