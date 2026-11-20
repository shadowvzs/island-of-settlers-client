import { CAMPAIGN_LIMITS, CAMPAIGN_PROTECTED_BUILDING_TYPES } from
  "../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import { BUILDING_CATALOG } from "../../render-common/buildings/building-catalog";
import { validScenarioPlayers } from "./scenario-players";

const CATALOG_IDS = new Set(BUILDING_CATALOG.map(entry => entry.id));
/** The HQ never appears either: a campaign map has no player HQ (R4). */
const NEVER_DISABLED = new Set([0, ...CAMPAIGN_PROTECTED_BUILDING_TYPES]);

/** Unique, ascending catalog ids that may be disabled (plan item 44; never HQ, Harbour or Storehouse). */
const validDisabledBuildings = (value: unknown) => {
  if (!Array.isArray(value) || value.length > CAMPAIGN_LIMITS.disabledBuildings) return false;
  return value.every((id, index) => Number.isSafeInteger(id) && CATALOG_IDS.has(id) && !NEVER_DISABLED.has(id) &&
    (index === 0 || id > value[index - 1]));
};

/**
 * The campaign-only scenario fields (`disabledBuildings`, `commanderAllowed`, `players`): valid shapes, and only on
 * a `kind: "campaign"` map.
 */
export const validScenarioCampaignRules = (scenario: Readonly<Record<string, unknown>>) => {
  const { commanderAllowed, disabledBuildings, kind, players } = scenario;
  if (disabledBuildings === undefined && commanderAllowed === undefined && players === undefined) return true;
  if (kind !== "campaign") return false;
  if (commanderAllowed !== undefined && typeof commanderAllowed !== "boolean") return false;
  if (players !== undefined && !validScenarioPlayers(players)) return false;
  return disabledBuildings === undefined || validDisabledBuildings(disabledBuildings);
};
