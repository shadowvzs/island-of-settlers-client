import { buildingLevelCost, hasBuildingLevels, hasLevelEffect, levelShare, levelTerritoryRadius,
  maxSavedBuildingLevel } from "./building-levels";
import { upgradeCapReason } from "./building-availability-rules";
import { nationConstructionShare } from "./nation-bonuses";
import { addGood, STORAGE_IDS } from "./production-rules";
import { productionTimeScale } from "./production-timing";
import { hasRoadRoute } from "./road-route-helpers";
import { isOwnBuilding } from "./settlement-home";
import { localStockSources, sharesLocalStockPool } from "./settlement-local-stock";
import { nationOf } from "./settlement-nation";
import {
  civilianOwnerOf, type EconomyContext, economyOwnerOf, hasEconomy, ownerOf, PLAYER_FACTION
} from "./settlement-ownership";
import { productionTalentBonus, talentsOf } from "./settlement-talents";
import type { Goods, SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

type UpgradeBuilding = Pick<SettlementBuilding, "typeId" | "workshopUpgrade">;
type OwnedUpgradeBuilding = UpgradeBuilding & Partial<Pick<SettlementBuilding, "militaryFaction">>;
/** A building's completed upgrade level while the player owns it; 0 otherwise (pending never counts). */
const ownLevel = (building: OwnedUpgradeBuilding) =>
  building.militaryFaction ? 0 : building.workshopUpgrade?.level ?? 0;
/** Highest saved upgrade level of a type (building level 5 → 4); 0 for a type without levels. */
export const maxWorkshopUpgradeLevel = maxSavedBuildingLevel;
/**
 * A hostile site of a faction without an economy keeps neutral rates; the buildings of every economy (the
 * player's and a computer economy's, EAI1c A19) follow the same level and time rules. Without a context
 * (offline and UI callers) every hostile site counts as neutral, as before.
 */
const isNeutralSite = (building: OwnedUpgradeBuilding, context: EconomyContext = {}) =>
  !!building.militaryFaction && !hasEconomy(context, building.militaryFaction);
/** Cost of the building's next level (`building-levels.ts`); {} at its maximum. */
export const workshopUpgradeCost = (building: UpgradeBuilding): Goods =>
  buildingLevelCost(building.typeId, building.workshopUpgrade?.level ?? 0);
export const isUpgradeableWorkshopType = hasBuildingLevels;
export const canUpgradeWorkshop = (building: SettlementBuilding) =>
  hasBuildingLevels(building.typeId) && building.construction === 1 && isOwnBuilding(building);

/** An effect's bonus share at the building's own level when its family has that effect, else 0. */
const effectShare = (building: OwnedUpgradeBuilding, effect: "door" | "sight" | "training" | "workSpeed") =>
  hasLevelEffect(building.typeId, effect) ? levelShare(effect, ownLevel(building)) : 0;
/**
 * Work-cycle rate of a production building: its level (+10% per level above 1) and the player's
 * production talent `talentBonus` add up (owner 2026-10-20: bonuses stack additively).
 */
export const workshopCycleFactor = (building: OwnedUpgradeBuilding, talentBonus = 0, context?: EconomyContext) => {
  if (!hasLevelEffect(building.typeId, "workSpeed") || isNeutralSite(building, context)) return 1;
  return 1 + effectShare(building, "workSpeed") + talentBonus;
};
/**
 * Simulation time rate of a production building's in-place work: `workshopCycleFactor` over the
 * production time scale (halved production times, slower building-material tiers of `output`).
 */
export const productionCycleRate = (
  building: OwnedUpgradeBuilding, talentBonus = 0, output?: string, context?: EconomyContext
) => {
  const factor = workshopCycleFactor(building, talentBonus, context);
  if (!hasLevelEffect(building.typeId, "workSpeed") || isNeutralSite(building, context)) return factor;
  return factor / productionTimeScale(building.typeId, output);
};
/** Tavern recruit training rate: its level plus the recruit training talent. */
export const tavernTrainingFactor = (building: OwnedUpgradeBuilding, talentBonus = 0, context?: EconomyContext) => {
  if (!hasLevelEffect(building.typeId, "training") || isNeutralSite(building, context)) return 1;
  return 1 + effectShare(building, "training") + talentBonus;
};
/** Lookout tower sight/fog-reveal radius multiplier. */
export const lookoutSightFactor = (building: OwnedUpgradeBuilding) => 1 + effectShare(building, "sight");
/** Door strength of a player's military building: incoming door damage is divided by it. */
export const militaryDoorFactor = (building: OwnedUpgradeBuilding | undefined) =>
  building ? 1 + effectShare(building, "door") : 1;
/**
 * A blow's damage to a door: a player door withstands more blows with its building's level plus the
 * door strength talent `talentBonus` (additive).
 */
export const doorBlowDamage = (
  damage: number, doorFaction: number, building: OwnedUpgradeBuilding | undefined, talentBonus = 0
) => doorFaction === 0 ? damage / (militaryDoorFactor(building) + talentBonus) : damage;
/** Territory radius a building claims now; a pending upgrade never changes (or shrinks) it. */
export const territoryRadius = (building: OwnedUpgradeBuilding) =>
  levelTerritoryRadius(building.typeId, ownLevel(building));

/**
 * In-place phases of a production worker's cycle: work clips and timers, waits, feeding, felling,
 * planting and rest. Walking and carrying trips (and stock hand-offs) are not listed.
 */
const IN_PLACE_WORK_PHASES = new Set(["work", "rest", "fishCast", "fishWait", "fishReel", "wellWork",
  "foresterPickup", "foresterPlant", "foresterReturn", "waitTreeFall", "huntAim", "huntWait",
  "pigFeedPutdown", "boatWork", "shipWork", "fisherBoatLift", "fisherBoatLaunch",
  "fisherBoatNet", "fisherBoatBeach"]);
/** Current handler contract: phases whose timer/animation clock follows the worker rate. */
export const isInPlaceWorkPhase = (phase: string) => IN_PLACE_WORK_PHASES.has(phase);
export interface WorkerCycleRateDetail {
  /** Whether this phase consumes the building/talent/material rate at all. */
  applies: boolean;
  /** Total simulation-time rate applied to the phase's timer/animation clock. */
  rate: number;
  /** Additive building-level share (not yet divided by the material time scale). */
  levelShare: number;
  /** Additive level/talent share for this building's applicable bonus group. */
  talentShare: number;
  /** Production time scale: 1 for normal speed, >1 for slower material tiers, <1 for the speed factor. */
  materialScale: number;
}
const NO_RATE_DETAIL: WorkerCycleRateDetail = { applies: false, levelShare: 0, materialScale: 1, rate: 1,
  talentShare: 0 };
type RateContext = Pick<SettlementContext, "buildings" | "factionTalents" | "talents">;

/**
 * A computer builder's hammering (`construct`, action `work`) at its faction's map handicap (EAI5a): the only rate
 * of that phase. The player's talent and nation shares read `builderWork` alone, as before.
 */
const handicapHammerRate = (
  context: RateContext, actor: Partial<Pick<SettlementActor, "action" | "hostileCivilianFaction">>
): WorkerCycleRateDetail => {
  const owner = civilianOwnerOf(actor);
  if (actor.action !== "work" || owner === PLAYER_FACTION) return NO_RATE_DETAIL;
  const talentShare = talentsOf(context, owner).constructionSpeed;
  if (!talentShare) return NO_RATE_DETAIL;
  return { applies: true, levelShare: 0, materialScale: 1, rate: 1 + talentShare, talentShare };
};

/**
 * The exact rate and its current shares. `workerCycleRate` is this detail's `rate`; keeping one
 * source prevents the phase inspector from inventing a second timing policy.
 */
export const workerCycleRateDetail = (
  context: RateContext & Partial<Pick<SettlementContext, "options" | "playerNation">>,
  actor: Pick<SettlementActor, "uid" | "building" | "phase"> &
    Partial<Pick<SettlementActor, "action" | "hostileCivilianFaction" | "productionOutput">>
): WorkerCycleRateDetail => {
  // A builder's hammering (never its walk) follows its economy's construction talent and national practice.
  if (actor.phase === "builderWork") {
    if (actor.action !== "work") return NO_RATE_DETAIL;
    const owner = civilianOwnerOf(actor);
    const talentShare = talentsOf(context, owner).constructionSpeed;
    const rate = 1 + talentShare + nationConstructionShare(nationOf(context, owner));
    return { applies: true, levelShare: 0, materialScale: 1, rate, talentShare };
  }
  if (actor.phase === "construct") return handicapHammerRate(context, actor);
  if (!IN_PLACE_WORK_PHASES.has(actor.phase)) return NO_RATE_DETAIL;
  const building = context.buildings.find(entry => entry.uid === actor.building);
  if (building?.worker !== actor.uid) return NO_RATE_DETAIL;
  const levelShare = workshopCycleFactor(building, 0, context) - 1;
  const talentShare = productionTalentBonus(context, building.typeId, economyOwnerOf(context, building));
  // Match `productionCycleRate`: only a type with the work-speed effect uses the material time
  // scale; other producers keep the plain talent/level factor.
  const materialScale = hasLevelEffect(building.typeId, "workSpeed") && !isNeutralSite(building, context)
    ? productionTimeScale(building.typeId, actor.productionOutput) : 1;
  return { applies: true, levelShare, materialScale,
    rate: (1 + levelShare + talentShare) / materialScale, talentShare };
};
/**
 * Simulation time rate of an actor this tick: a production building's own worker runs its whole in-place
 * work (timers and the clips sampled from `animationTime`) at `productionCycleRate`.
 */
export const workerCycleRate = (
  context: RateContext & Partial<Pick<SettlementContext, "options">>,
  actor: Pick<SettlementActor, "uid" | "building" | "phase"> &
    Partial<Pick<SettlementActor, "action" | "productionOutput">>
) => workerCycleRateDetail(context, actor).rate;

const stocks = (building: SettlementBuilding) => building.workshopUpgrade?.reserved ?? building.input;
const incoming = (building: SettlementBuilding) => building.workshopUpgrade?.reserved ?
  building.workshopUpgrade.incoming ?? {} : building.incoming;
export const workshopUpgradeDemand = (building: SettlementBuilding): Goods => {
  if (!building.workshopUpgrade?.requested || !canUpgradeWorkshop(building)) return {};
  return Object.fromEntries(Object.entries(workshopUpgradeCost(building)).map(([ware, count]) =>
    [ware, Math.max(0, count - (stocks(building)[ware] ?? 0) - (incoming(building)[ware] ?? 0))]));
};
export const workshopUpgradeSupplied = (building: SettlementBuilding) =>
  Object.entries(workshopUpgradeCost(building)).every(([ware, count]) => (stocks(building)[ware] ?? 0) >= count);
export const workshopUpgradeAvailability = (context: SettlementContext, building: SettlementBuilding) => {
  const supply: Goods = {}, upgrade = building.workshopUpgrade;
  if (!canUpgradeWorkshop(building) || upgrade?.requested || upgrade?.cancelling ||
    (upgrade?.level ?? 0) >= maxWorkshopUpgradeLevel(building.typeId))
    return { available: false, supply, reason: "This building cannot start another upgrade." };
  const capped = upgradeCapReason(context, building.typeId, upgrade?.level ?? 0);
  if (capped) return { available: false, supply, reason: capped };
  const owner = economyOwnerOf(context, building);
  const storages = context.buildings.filter(storage => storage.construction === 1 &&
    ownerOf(storage) === owner && STORAGE_IDS.has(storage.typeId) &&
    sharesLocalStockPool(context, building.access, storage) &&
    (storage === building || hasRoadRoute(context.options.roads, storage.access, building.access)));
  if (!storages.length) return { available: false, supply, reason: "Connect this building to storage with a road." };
  const cost = workshopUpgradeCost(building);
  for (const ware of Object.keys(cost)) {
    supply[ware] = localStockSources(context, building.access, storages)
      .reduce((sum, storage) => sum + (storage.inventory[ware] ?? 0), 0);
    for (const other of context.buildings) {
      if (other === building || !other.workshopUpgrade?.requested ||
        !sharesLocalStockPool(context, building.access, other)) continue;
      const needed = workshopUpgradeDemand(other)[ware] ?? 0;
      if (needed && storages.some(storage =>
        hasRoadRoute(context.options.roads, storage.access, other.access)))
        supply[ware] = Math.max(0, supply[ware]! - needed);
    }
  }
  const enough = Object.entries(cost).every(([ware, count]) => (supply[ware] ?? 0) >= count);
  return { available: enough, supply, reason: enough ? "" :
    `Needs ${Object.entries(cost).map(([ware, count]) => `${count} ${ware}`).join(" and ")} in connected storage.` };
};
export const finishWorkshopUpgrade = (building: SettlementBuilding) => {
  const upgrade = building.workshopUpgrade;
  if (!upgrade?.requested || !canUpgradeWorkshop(building) || !workshopUpgradeSupplied(building) ||
    upgrade.level >= maxWorkshopUpgradeLevel(building.typeId)) return false;
  for (const [ware, count] of Object.entries(workshopUpgradeCost(building))) addGood(stocks(building), ware, -count);
  building.workshopUpgrade = { level: (upgrade.level + 1) as 1 | 2 | 3 | 4 };
  return true;
};
export const requestWorkshopUpgrade = (building: SettlementBuilding) => {
  const upgrade = building.workshopUpgrade;
  if (!canUpgradeWorkshop(building) || upgrade?.requested || upgrade?.cancelling ||
    (upgrade?.level ?? 0) >= maxWorkshopUpgradeLevel(building.typeId)) return false;
  building.workshopUpgrade = { level: upgrade?.level ?? 0, requested: true, reserved: {}, incoming: {} };
  if (STORAGE_IDS.has(building.typeId)) for (const [ware, required] of Object.entries(workshopUpgradeCost(building))) {
    const count = Math.min(required, building.inventory[ware] ?? 0);
    if (count) { addGood(building.inventory, ware, -count); addGood(building.workshopUpgrade.reserved!, ware, count); }
  }
  return true;
};
export const cancelWorkshopUpgrade = (building: SettlementBuilding) => {
  const upgrade = building.workshopUpgrade;
  if (!upgrade?.requested) return false;
  building.workshopUpgrade = { level: upgrade.level, cancelling: true,
    ...(upgrade.reserved ? { reserved: upgrade.reserved, incoming: upgrade.incoming ?? {} } : {}) };
  return true;
};
export const updateWorkshopUpgrade = (building: SettlementBuilding) => {
  const upgrade = building.workshopUpgrade;
  if (!upgrade || (!upgrade.requested && !upgrade.cancelling)) return;
  if (!canUpgradeWorkshop(building)) cancelWorkshopUpgrade(building);
  if (!building.workshopUpgrade?.cancelling) return;
  for (const ware of Object.keys(workshopUpgradeCost(building))) {
    const count = stocks(building)[ware] ?? 0;
    if (count) { addGood(STORAGE_IDS.has(building.typeId) ? building.inventory : building.output, ware, count); addGood(stocks(building), ware, -count); }
  }
  if (Object.values(incoming(building)).every(count => count === 0))
    building.workshopUpgrade = upgrade.level ? { level: upgrade.level } : undefined;
};
export const updateWorkshopUpgrades = (context: SettlementContext) => {
  for (const building of context.buildings) updateWorkshopUpgrade(building);
};
export const validWorkshopUpgrade = (building: SettlementBuilding) => {
  const upgrade = building.workshopUpgrade;
  if (upgrade === undefined) return true;
  if (!upgrade || typeof upgrade !== "object" || !hasBuildingLevels(building.typeId) || building.construction !== 1 ||
    !Number.isInteger(upgrade.level) || upgrade.level < 0 || upgrade.level > maxWorkshopUpgradeLevel(building.typeId)) return false;
  if (Object.keys(upgrade).some(key => !["level", "requested", "cancelling", "progress", "builder", "reserved", "incoming"].includes(key)))
    return false;
  if (upgrade.progress !== undefined && (!Number.isFinite(upgrade.progress) || upgrade.progress < 0 || upgrade.progress >= 1))
    return false;
  if (upgrade.builder !== undefined && (!Number.isSafeInteger(upgrade.builder) || upgrade.builder < 0)) return false;
  for (const goods of [upgrade.reserved, upgrade.incoming]) {
    if (goods === undefined) continue;
    if (!goods || typeof goods !== "object" || Array.isArray(goods) || Object.entries(goods).some(([ware, count]) =>
      !Object.hasOwn(workshopUpgradeCost(building), ware) || !Number.isSafeInteger(count) || count < 0 ||
      count > workshopUpgradeCost(building)[ware]!)) return false;
  }
  if (upgrade.incoming && !upgrade.reserved) return false;
  for (const [ware, count] of Object.entries(workshopUpgradeCost(building)))
    if ((upgrade.reserved?.[ware] ?? 0) + (upgrade.incoming?.[ware] ?? 0) > count ||
      (upgrade.incoming?.[ware] ?? 0) > (building.incoming[ware] ?? 0)) return false;
  if (upgrade.cancelling && (upgrade.progress !== undefined || upgrade.builder !== undefined)) return false;
  if (upgrade.requested || upgrade.cancelling) return upgrade.level < maxWorkshopUpgradeLevel(building.typeId) &&
    ((upgrade.requested === true && upgrade.cancelling === undefined) ||
      (upgrade.cancelling === true && upgrade.requested === undefined));
  return upgrade.level > 0 && upgrade.progress === undefined && upgrade.builder === undefined &&
    upgrade.reserved === undefined && upgrade.incoming === undefined &&
    upgrade.requested === undefined && upgrade.cancelling === undefined;
};
