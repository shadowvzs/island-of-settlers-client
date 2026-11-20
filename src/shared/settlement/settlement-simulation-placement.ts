import { buildingEntry } from "@shared/catalog";

import { BUILDING_CATALOG } from "../../render-common/buildings/building-catalog";
import { GARRISON_CAPACITIES } from "../balance/military";
import { buildingLockReason, buildingUnlockLevel, isBuildingUnlocked } from "../progression/building-unlocks";
import { allowsMaterialBuilding, materialBuildingRefusal } from "./advanced-material-production";
import {
  availabilityBanReason, availabilityRefusal, buildingTierBlock, homeUnlocksAll
} from "./building-availability-rules";
import { hasStoneDeposit, marblePlotBlocked } from "./colony-marble-deposits";
import {
  type ConstructionStockLookup, constructionStockReason, createCachedConstructionStock
} from "./construction-stock-reason";
import { contextIslandRole } from "./island-role";
import type { createSettlementAdventure } from "./settlement-adventure";
import type { createSettlementColony } from "./settlement-colony";
import { demolishSettlementBuilding, settlementDemolitionReason } from "./settlement-demolition";
import { harbourBerthCount } from "./settlement-harbour-placement";
import { isHomeBuilding, isOwnBuilding } from "./settlement-home";
import type { createSettlementMilitary } from "./settlement-military";
import type { createSettlementNaval } from "./settlement-naval";
import { connectNearbyBuildingEntrances } from "./settlement-nearby-roads";
import { ownerOf, PLAYER_FACTION } from "./settlement-ownership";
import { claimBuilding, makeBuilding, placementReason } from "./settlement-placement";
import type { createSettlementTavern } from "./settlement-tavern";
import { territoryPlacementReason } from "./settlement-territory";
import type { createTerritoryRoadControls } from "./settlement-territory-roads";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { contextPlayerLevel } from "./sim-rules";

interface SimulationPlacementSystems {
  adventure: ReturnType<typeof createSettlementAdventure>;
  /** The authored scenario the island was created from, if any. */
  authored: SettlementContext["options"]["world"]["scenario"];
  colony: ReturnType<typeof createSettlementColony>;
  /** Stock of a ware in storages not yet promised to construction sites. */
  freeStock: ConstructionStockLookup;
  military: ReturnType<typeof createSettlementMilitary>;
  naval: ReturnType<typeof createSettlementNaval>;
  tavern: ReturnType<typeof createSettlementTavern>;
  territoryRoads: ReturnType<typeof createTerritoryRoadControls>;
}

type BuildingLimit = NonNullable<(typeof BUILDING_CATALOG)[number]["buildLimit"]>;
/** Refusal of a type the campaign map disables (hidden in the menu; owner Q7). */
export { NOT_ON_THIS_MAP } from "./building-availability-rules";

/** A building draft at this plot, costed in `nation`; the building counter is left as it was. */
export const draftBuilding = (
  context: SettlementContext, typeId: number, x: number, z: number, rotation: number, nation = context.playerNation
) => {
  const nextBuilding = context.nextBuilding;
  const draft = makeBuilding(context, typeId, x, z, rotation, nation);
  context.nextBuilding = nextBuilding;
  return draft;
};

const MARBLE_PLOT_REASON = "Keep this marble outcrop clear for quarrying";

interface OwnedDraftPlacement {
  building: SettlementBuilding;
  connectRoads: (from: SettlementPoint, to: SettlementPoint) => unknown;
  freeStock: ConstructionStockLookup;
  owner: number;
}

/** Why the owner may not use the draft's plot: the marble outcrop, the placement rules, the owner's territory. */
export const ownedPlotReason = (context: SettlementContext, building: SettlementBuilding, owner: number) => {
  if (marblePlotBlocked(context, building)) return MARBLE_PLOT_REASON;
  return placementReason(context, building) ?? territoryPlacementReason(context, building, owner);
};

/**
 * The placement core every entry shares (EAI1a E2): plot rules, the owner's territory, the owner's
 * construction stock, then the claim and the owner's road links. Human-only gates (unlocks, limits,
 * campaign blacklist, colony/adventure refusals) stay in the entry; the faction entry is
 * `settlement-faction-placement.ts`.
 * A computer owner is written onto the draft before the claim (plan §4.2); the player's draft keeps
 * `militaryFaction` unset.
 */
export const placeOwnedDraft = (
  context: SettlementContext, { building, connectRoads, freeStock, owner }: OwnedDraftPlacement
) => {
  const reason = ownedPlotReason(context, building, owner);
  if (reason) return { ok: false, reason };
  const stockReason = constructionStockReason(context, building.required, building.access, freeStock, owner);
  if (stockReason) return { ok: false, reason: stockReason };
  if (owner !== PLAYER_FACTION) building.militaryFaction = owner;
  context.nextBuilding = building.uid + 1;
  claimBuilding(context, building);
  connectNearbyBuildingEntrances(context, connectRoads, owner);
  return { ok: true, building };
};

/** Player building placement, its previews, and removal of player and authored hostile sites. */
export const createSimulationPlacement = (context: SettlementContext, systems: SimulationPlacementSystems) => {
  const { adventure, authored, colony, freeStock, military, naval, tavern, territoryRoads } = systems;
  /** The level the unlock gate checks; none without a player or in an unlock-all authored scenario. */
  const gateLevel = () => {
    if (context.options.unlockAllBuildings || authored?.buildingUnlocks === "all" || homeUnlocksAll(context))
      return undefined;
    return contextPlayerLevel(context);
  };
  /** The level a building still needs, or null when the gate allows it (the menu greys locked cards). */
  const buildingLockLevel = (typeId: number) =>
    isBuildingUnlocked(typeId, gateLevel()) ? null : buildingUnlockLevel(typeId);
  const isColony = () => !!colony.save() || authored?.kind === "colony";
  const islandRole = () => contextIslandRole(context);
  /** Home-only types: the home island; the Lodge also on a campaign map that allows the commander (R11). */
  const allowedOffHome = (limit: BuildingLimit) => {
    const role = islandRole();
    return role === "home" || (role === "campaign" && !!limit.commanderCampaign && !!authored?.commanderAllowed);
  };
  /** An owner's buildings and sites of a type: enemy buildings never use the player's limit (R13). */
  const ownCount = (typeId: number, owner = PLAYER_FACTION) =>
    context.buildings.filter(building => building.typeId === typeId && ownerOf(building) === owner).length;
  /** A one-off building (catalog limit 1, e.g. the Monument) already stands or is placed as a site. */
  const singleBuildingBuilt = (typeId: number) =>
    BUILDING_CATALOG.find(entry => entry.id === typeId)?.buildLimit?.max === 1 && ownCount(typeId) > 0;
  /** The catalog's per-island count of a type, per owner (construction sites included). */
  const countLimitReason = (typeId: number, owner: number) => {
    const definition = BUILDING_CATALOG.find(entry => entry.id === typeId);
    const max = definition?.buildLimit?.max;
    if (max === undefined || ownCount(typeId, owner) < max) return null;
    return max === 1 ? `Only one ${definition!.name} can be built`
      : `Only ${max} ${definition!.name} buildings can be built`;
  };
  /**
   * Shared catalog limits: home-only buildings and per-island counts (including construction sites).
   * `ignoreSingle`: the menu keeps a built one-off building's card (shown as already built).
   */
  const buildLimitReason = (typeId: number, ignoreSingle = false) => {
    const definition = BUILDING_CATALOG.find(entry => entry.id === typeId);
    const limit = definition?.buildLimit;
    if (!limit) return null;
    if (limit.homeOnly && !allowedOffHome(limit))
      return `${definition!.name} can only be built on the home island`;
    if (ignoreSingle && limit.max === 1) return null;
    return countLimitReason(typeId, PLAYER_FACTION);
  };
  /** The map's bans (campaign blacklist included) and material tier cap (MAP BUILDING AVAILABILITY). */
  const refusal = (typeId: number) => availabilityRefusal(context, typeId) ?? buildLimitReason(typeId);
  const allowsMaterial = (typeId: number) => {
    return allowsMaterialBuilding(context, typeId, isColony(), stone => hasStoneDeposit(context, stone));
  };
  const placeBuilding = (typeId: number, x: number, z: number, rotation = 0) => {
    if (buildingEntry(typeId)?.building.placeable !== true) return { ok: false, reason: "Choose a buildable building" };
    const limited = refusal(typeId);
    if (limited) return { ok: false, reason: limited };
    if (!colony.allowsBuilding(typeId)) return { ok: false, reason: colony.buildingRefusal() };
    if (!adventure.allowsBuilding() || authored?.kind === "adventure")
      return { ok: false, reason: "Adventure islands are conquered by troops only" };
    if (!allowsMaterial(typeId))
      return { ok: false, reason: materialBuildingRefusal(typeId, isColony() ? context.options.world.colonyResourceTier ?? 1 : undefined) };
    if (!isBuildingUnlocked(typeId, gateLevel())) return { ok: false, reason: buildingLockReason(typeId) };
    const building = draftBuilding(context, typeId, x, z, rotation);
    return placeOwnedDraft(context, {
      building, connectRoads: territoryRoads.connectRoads, freeStock, owner: PLAYER_FACTION
    });
  };
  /**
   * Demolition once the caller's owner check passed (EAI1a E8/A27): the naval and demolition refusals,
   * then every system forgets the site. `discardStock`: no salvage reaches the owner's storages.
   */
  const removeSite = (building: SettlementBuilding, discardStock = false) => {
    const { uid } = building;
    if (!naval.canRemoveBuilding(uid))
      return { ok: false, reason: "Finish pier work or cancel passenger voyages first" };
    const refusal = settlementDemolitionReason(context, building);
    if (refusal) return { ok: false, reason: refusal };
    naval.removeBuilding(uid);
    military.removeBuilding(uid);
    tavern.removeBuilding(uid);
    if (discardStock) {
      building.inventory = {}; building.input = {}; building.output = {}; building.catapultSupply = undefined;
    }
    return demolishSettlementBuilding(context, uid);
  };
  const removeMilitarySite = (uid:number, scenario:boolean) => {
    const building=context.buildings.find(b=>b.uid===uid);
    if(!building || isHomeBuilding(building)) return demolishSettlementBuilding(context,uid);
    if (scenario && isOwnBuilding(building))
      return { ok: false, reason: "Only authored hostile military sites can be removed" };
    if (!scenario && ownerOf(building) > 0)
      return { ok: false, reason: "Capture this hostile building before demolishing it" };
    // Explicit scenario cleanup never converts hostile stock into player salvage.
    return removeSite(building, scenario);
  };
  /** A finished hostile site, placed like colony forts: plot rules apply, player territory does not. */
  const placeMilitaryScenarioSite = (typeId: number, x: number, z: number, rotation = 0) => {
    if (!GARRISON_CAPACITIES[typeId]) return { ok: false as const, reason: "Choose a military building" };
    const site = draftBuilding(context, typeId, x, z, rotation);
    const reason = placementReason(context, site);
    if (reason) return { ok: false as const, reason };
    Object.assign(site, { construction: 1, foundationProgress: 1, militaryFaction: 1, required: {} });
    context.nextBuilding = site.uid + 1;
    claimBuilding(context, site);
    return { building: site, ok: true as const };
  };
  /** `ignoreLevel`: development tools may place a building before the player's level unlocks it. */
  const allowsBuilding = (typeId: number, ignoreLevel = false, ignoreSingle = false) => {
    if (!BUILDING_CATALOG.some(entry => entry.id === typeId) || !allowsMaterial(typeId)) return false;
    if (availabilityBanReason(context, typeId) ?? buildLimitReason(typeId, ignoreSingle)) return false;
    if (!ignoreLevel && buildingTierBlock(context, typeId) !== null) return false;
    if (!ignoreLevel && !isBuildingUnlocked(typeId, gateLevel())) return false;
    return colony.allowsBuilding(typeId) && adventure.allowsBuilding();
  };
  const validatePlacement = (typeId: number, x: number, z: number, rotation = 0) => {
    if (!BUILDING_CATALOG.some((entry) => entry.id === typeId)) return "Unknown building";
    const limited = refusal(typeId);
    if (limited) return limited;
    const draft = draftBuilding(context, typeId, x, z, rotation);
    return placementReason(context, draft) ?? territoryPlacementReason(context, draft);
  };
  const cachedFreeStock = createCachedConstructionStock(context);
  /**
   * The construction stock refusal `placeBuilding` would give at this plot (NEW-ISLAND-FEEDBACK), for the
   * placement preview: same rule and wording, cached per landmass pool and stock revision.
   */
  const placementStockReason = (typeId: number, x: number, z: number, rotation = 0) => {
    const draft = draftBuilding(context, typeId, x, z, rotation);
    return constructionStockReason(context, draft.required, draft.access, cachedFreeStock);
  };
  /** Berths (1 or 2) a harbour placed here would get; null for other buildings and refused plots. */
  const harbourBerthPreview = (typeId: number, x: number, z: number, rotation = 0) => {
    if (typeId !== 39) return null;
    return harbourBerthCount(context, draftBuilding(context, typeId, x, z, rotation));
  };
  return {
    allowsBuilding, allowsMaterial, buildingLockLevel, countLimitReason, harbourBerthPreview, islandRole,
    placeBuilding, placeMilitaryScenarioSite, placementStockReason, removeMilitarySite, removeSite,
    singleBuildingBuilt, validatePlacement
  };
};
