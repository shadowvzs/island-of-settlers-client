import {
  availabilityTier, type BuildingAvailability, buildingLevelLimit, type HomeBuildingRules, isBuildingBanned,
  isHomeBuildingRules, isResourceTierAllowed, MAX_BUILDING_TIER, narrowBuildingAvailability
} from "../../../../island-of-settlers-shared/src/game-settings/building-availability";
import { aiBuildingTier } from "../balance/enemy-scaling";
import { materialBuildingGroup } from "./advanced-material-production";
import { commanderPaceOf } from "./commander/commander-profile-source";
import { contextIslandRole } from "./island-role";
import type { SettlementContext } from "./settlement-types";

/**
 * MAP BUILDING AVAILABILITY at runtime (owner 2026-11-17). The island's rules are the map file's
 * `availability` narrowed by a campaign map's blacklist, or, on the home island, the player's own saved
 * home rules (`homeBuildingRules`, changed only by the recorded `setHomeBuildingRules`). Placement and
 * upgrade requests read them; existing buildings are never touched by a rule change.
 */
export type { BuildingAvailability, HomeBuildingRules };
export { isHomeBuildingRules };

export const NOT_ON_THIS_MAP = "Not available on this map";

const cache = new WeakMap<SettlementContext, { key: unknown[]; rules: BuildingAvailability | undefined }>();

const mapAvailability = (context: SettlementContext) => {
  const scenario = context.options.world.scenario;
  const campaignBans = scenario?.kind === "campaign" && scenario.disabledBuildings?.length
    ? { banned: [...scenario.disabledBuildings] } : undefined;
  return narrowBuildingAvailability(scenario?.availability, campaignBans);
};

/** The rules this island plays with now; undefined = nothing narrowed. Cached per source object. */
export const contextBuildingAvailability = (context: SettlementContext): BuildingAvailability | undefined => {
  const scenario = context.options.world.scenario, home = homeOverride(context);
  const key = [scenario, scenario?.availability, scenario?.disabledBuildings, home];
  const cached = cache.get(context);
  if (cached && cached.key.every((value, index) => value === key[index])) return cached.rules;
  const rules = home ?? mapAvailability(context);
  cache.set(context, { key, rules });
  return rules;
};

/** The home override only counts on the home island (a colony or campaign run keeps its map rules). */
const homeOverride = (context: SettlementContext) =>
  contextIslandRole(context) === "home" ? context.homeBuildingRules : undefined;

/** The home sandbox unlock: the player's level no longer gates buildings on the home island. */
export const homeUnlocksAll = (context: SettlementContext) => !!homeOverride(context)?.unlockAll;

export const availabilityBanReason = (context: SettlementContext, typeId: number) =>
  isBuildingBanned(contextBuildingAvailability(context), typeId) ? NOT_ON_THIS_MAP : null;

/** The map tier a material producer needs (its material tier + 1); null for every other type. */
export const buildingRequiredTier = (typeId: number) => {
  const group = materialBuildingGroup(typeId);
  return group ? group.tier + 1 : null;
};

/** The tier a type still needs above the map cap, or null when the cap allows it. */
export const buildingTierBlock = (context: SettlementContext, typeId: number) => {
  const required = buildingRequiredTier(typeId);
  if (required === null) return null;
  return isResourceTierAllowed(contextBuildingAvailability(context), required - 1) ? null : required;
};

export const tierBlockReason = (required: number, cap: number) =>
  `Needs material tier ${required}; this map allows tier ${cap} at most`;

/** Why the cap refuses a new building of this type (bans first, then its material tier). */
export const availabilityRefusal = (context: SettlementContext, typeId: number) => {
  const banned = availabilityBanReason(context, typeId);
  if (banned) return banned;
  const required = buildingTierBlock(context, typeId);
  if (required === null) return null;
  return tierBlockReason(required, availabilityTier(contextBuildingAvailability(context)));
};

/**
 * Why the map refuses a computer faction's new building: its bans, then its material tier against the faction's
 * tier (the map tier, lowered on Easy by `aiBuildingTier`). Islands without rules refuse nothing, as before.
 */
export const factionAvailabilityRefusal = (context: SettlementContext, faction: number, typeId: number) => {
  const rules = contextBuildingAvailability(context);
  if (!rules) return null;
  if (isBuildingBanned(rules, typeId)) return NOT_ON_THIS_MAP;
  const required = buildingRequiredTier(typeId);
  if (required === null) return null;
  const cap = aiBuildingTier(availabilityTier(rules), commanderPaceOf(context, faction));
  return required <= cap ? null : tierBlockReason(required, cap);
};

/** Why the next level (saved `savedLevel` + 1, shown + 2) is beyond this map's cap; null when allowed. */
export const upgradeCapReason = (context: SettlementContext, typeId: number, savedLevel: number) => {
  const limit = buildingLevelLimit(contextBuildingAvailability(context), typeId);
  return savedLevel + 2 > limit ? `This map allows building level ${limit} at most.` : null;
};

/** The same cap for bridges: a bridge's level follows the building levels (level N = material tier N − 1). */
export const bridgeUpgradeCapped = (context: SettlementContext, savedLevel: number) =>
  savedLevel + 2 > availabilityTier(contextBuildingAvailability(context));

export const saveHomeBuildingRules = (context: SettlementContext) =>
  context.homeBuildingRules ? { homeBuildingRules: structuredClone(context.homeBuildingRules) } : {};

export const restoreHomeBuildingRules = (context: SettlementContext, saved: unknown) => {
  context.homeBuildingRules = isHomeBuildingRules(saved) ? structuredClone(saved) : undefined;
};

/** Normalised home rules: empty parts dropped; undefined when nothing differs from the map. */
const normalizedHomeRules = (rules: HomeBuildingRules): HomeBuildingRules | undefined => {
  const next: HomeBuildingRules = {};
  if (rules.unlockAll) next.unlockAll = true;
  if (rules.banned?.length) next.banned = [...rules.banned];
  if (rules.levelCaps?.length) next.levelCaps = rules.levelCaps.map(cap => ({ ...cap }));
  if (rules.tier !== undefined && rules.tier < MAX_BUILDING_TIER) next.tier = rules.tier;
  return Object.keys(next).length ? next : undefined;
};

/**
 * The home rules with the sandbox unlock switched on or off; the player's other home rules stay. The UI sends the
 * result through the recorded `setHomeBuildingRules` (switching off with nothing else set restores the map's rules).
 */
export const withHomeSandbox = (rules: HomeBuildingRules | undefined, enabled: boolean): HomeBuildingRules => {
  const { unlockAll: _unlockAll, ...rest } = rules ?? {};
  return enabled ? { ...rest, unlockAll: true } : rest;
};

/**
 * The recorded `setHomeBuildingRules` (owner: the player may change the home defaults, no penalty): home island
 * only; existing buildings stay, only new placements and upgrades follow the new rules.
 */
export const setHomeBuildingRules = (context: SettlementContext, rules: unknown): true | string => {
  if (contextIslandRole(context) !== "home") return "Only the home island's building rules can be changed";
  if (!isHomeBuildingRules(rules)) return "Invalid building rules";
  context.homeBuildingRules = normalizedHomeRules(rules);
  return true;
};
