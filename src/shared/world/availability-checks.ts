import { buildingEntry } from "@shared/catalog";

import {
  availabilityTier, type BuildingAvailability, isBuildingBanned, isResourceTierAllowed
} from "../../../../island-of-settlers-shared/src/game-settings/building-availability";
import { BUILDING_CATALOG } from "../../render-common/buildings/building-catalog";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { MATERIAL_BUILDING_GROUPS, materialBuildingGroup } from "../settlement/advanced-material-production";
import { getConstructionCost } from "../settlement/construction-costs";
import { getProductionRule } from "../settlement/production-rules";
import type { MarbleDeposit } from "./marble-deposit";
import { PROP } from "./world-data";

/**
 * Map-save validation of MAP BUILDING AVAILABILITY (owner 2026-11-17). Pure: the editor, the campaign checks and
 * the verifier tools can share it. The chain rule follows `ai:check` (catalog `validateBuildPrograms`): every
 * production input and construction ware of a building in play must come from a building in play. Only the breaks
 * the bans cause are reported: wares the unbanned catalog produces but the narrowed one does not.
 */
export type AvailabilityIssue =
  | { kind: "chain"; severity: "error" | "warning"; banned: number[]; neededBy: number[]; ware: string }
  | { kind: "noMaterialSource"; severity: "warning"; stone: string; tier: number; wood: string };

interface ChainInput {
  nation: WorkerNation;
  rules: BuildingAvailability | undefined;
}

const placeableTypes = () => BUILDING_CATALOG.map(entry => entry.id)
  .filter(id => buildingEntry(id)?.building.placeable === true);

const inPlay = (rules: BuildingAvailability | undefined, id: number) => {
  if (isBuildingBanned(rules, id)) return false;
  const group = materialBuildingGroup(id);
  return !group || isResourceTierAllowed(rules, group.tier);
};

const outputsOf = (ids: readonly number[], nation: WorkerNation) =>
  new Set(ids.flatMap(id => getProductionRule(id, nation)?.outputs ?? []));

const constructionWares = (id: number, nation: WorkerNation) =>
  Object.entries(getConstructionCost(id, nation)).filter(([, count]) => count > 0).map(([ware]) => ware);

/** Buildings in play that need `ware` to be built (error) or worked (warning). */
const consumers = (ids: readonly number[], ware: string, nation: WorkerNation) => {
  const built = ids.filter(id => constructionWares(id, nation).includes(ware));
  const worked = ids.filter(id => !built.includes(id) && getProductionRule(id, nation)?.inputs.includes(ware));
  return { built, worked };
};

/** The bans that removed the last producers of `ware` (the producers among the banned types). */
const bannedProducers = (rules: BuildingAvailability | undefined, ware: string, nation: WorkerNation) =>
  (rules?.banned ?? []).filter(id => getProductionRule(id, nation)?.outputs.includes(ware));

/** Production chain breaks the bans cause (e.g. "Sawmill banned → no planks → Carpenter, … unbuildable"). */
export const availabilityChainIssues = ({ nation, rules }: ChainInput): AvailabilityIssue[] => {
  if (!rules?.banned?.length) return [];
  const all = placeableTypes(), allowed = all.filter(id => inPlay(rules, id));
  const producedByAll = outputsOf(all.filter(id => inPlay({ ...rules, banned: [] }, id)), nation);
  const producedNow = outputsOf(allowed, nation);
  return [...producedByAll].filter(ware => !producedNow.has(ware)).sort().flatMap(ware => {
    const banned = bannedProducers(rules, ware, nation);
    const { built, worked } = consumers(allowed, ware, nation);
    if (!banned.length || (!built.length && !worked.length)) return [];
    const severity = built.length ? "error" as const : "warning" as const;
    return [{ banned, kind: "chain" as const, neededBy: [...built, ...worked], severity, ware }];
  });
};

interface MaterialSourceInput {
  deposits: readonly MarbleDeposit[];
  propTypes: ArrayLike<number>;
  rules: BuildingAvailability | undefined;
}

const hasProp = (types: ArrayLike<number>, type: number) => {
  for (let index = 0; index < types.length; index++) if (types[index] === type) return true;
  return false;
};

/**
 * Each advanced material tier the map's tier allows (explicit tier only) needs its wood or its stone somewhere on
 * the map; otherwise its levels can only be reached with traded or rewarded material (warning).
 */
export const availabilityMaterialIssues = ({ deposits, propTypes, rules }: MaterialSourceInput) => {
  if (rules?.tier === undefined) return [];
  const tier = availabilityTier(rules);
  return MATERIAL_BUILDING_GROUPS.filter(group => group.tier < tier).flatMap((group): AvailabilityIssue[] => {
    const stone = deposits.some(deposit => (deposit.material ?? "marble") === group.stone);
    if (stone || hasProp(propTypes, PROP[group.tree])) return [];
    return [{ kind: "noMaterialSource", severity: "warning", stone: group.stone, tier: group.tier + 1,
      wood: group.tree.replace(/Tree$/, "") }];
  });
};
