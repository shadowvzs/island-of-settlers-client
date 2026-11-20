import { buildingEntry } from "@shared/catalog";

import { activeFactionAi } from "../world/scenario-faction-ai";
import {
  type ScenarioStartTroop, startTroopRecruits, validScenarioStartTroops
} from "../world/scenario-start-troops";
import { isBaseProducer } from "./advanced-material-production";
import { factionAvailabilityRefusal } from "./building-availability-rules";
import { HEADQUARTERS_TYPE_ID } from "./building-type-ids";
import type { ConstructionStockLookup } from "./construction-stock-reason";
import { developStartSoldiers } from "./economy-ai/develop-level";
import { STORAGE_IDS } from "./production-rules";
import type { RoadPlan } from "./road-types";
import { finishDraft } from "./settlement-debug-raise";
import { findFactionHome } from "./settlement-home";
import { nationOf } from "./settlement-nation";
import { connectNearbyBuildingEntrances } from "./settlement-nearby-roads";
import { hasEconomy, ownerOf, PLAYER_FACTION } from "./settlement-ownership";
import {
  type createSimulationPlacement, draftBuilding, ownedPlotReason, placeOwnedDraft
} from "./settlement-simulation-placement";
import { createTerritoryRoadControls } from "./settlement-territory-roads";
import type { Goods, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { reconcileStorageAccess } from "./shared-storage";

/** A plot a computer faction asks for: the building type, its plot centre and quarter turns. */
export interface FactionBuildingDraft {
  rotation?: number;
  typeId: number;
  x: number;
  z: number;
}

/** `aiPlace` start kit of a finished storage: idle settlers, reserve soldiers waiting inside and stored wares. */
export interface FactionStartKit {
  settlers?: number;
  soldiers?: readonly ScenarioStartTroop[];
  stock?: Readonly<Goods>;
}

/** The placed building, or why the request was refused. */
export interface FactionPlacementResult {
  building?: SettlementBuilding;
  ok: boolean;
  reason?: string;
}

type PlayerPlacement = ReturnType<typeof createSimulationPlacement>;

interface FactionPlacementSystems {
  /** Stock of a ware in the owner's storages not yet promised to construction sites. */
  freeStock: ConstructionStockLookup;
  placement: Pick<PlayerPlacement, "allowsMaterial" | "countLimitReason" | "removeSite">;
}

export const NOT_AN_ECONOMY_FACTION = "Choose a computer faction that runs an economy";
export const NOT_A_FACTION_BUILDING = "Choose a building of this faction";
export const NOT_BUILDABLE = "Choose a buildable building";
const INVALID_PLOT = "Choose a valid plot";
const INVALID_START_KIT = "A start kit needs a storage, whole settlers, valid soldiers and whole ware counts";

const refused = (reason: string): FactionPlacementResult => ({ ok: false, reason });

const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

const validDraft = (draft: FactionBuildingDraft) =>
  Number.isSafeInteger(draft?.typeId) && Number.isFinite(draft.x) && Number.isFinite(draft.z) &&
  (draft.rotation === undefined || Number.isSafeInteger(draft.rotation));

const validStartKit = (typeId: number, kit: FactionStartKit) => {
  const { settlers, soldiers, stock } = kit;
  if (settlers === undefined && soldiers === undefined && stock === undefined) return true;
  return STORAGE_IDS.has(typeId) && (settlers === undefined || isCount(settlers)) &&
    validScenarioStartTroops(soldiers) && Object.values(stock ?? {}).every(isCount);
};

/** The kit's own soldiers; a storage's kit with settlers or wares but no soldier list: the `develop` level's. */
const kitSoldiers = (context: SettlementContext, building: SettlementBuilding, kit: FactionStartKit) => {
  if (kit.soldiers) return kit.soldiers;
  if (!STORAGE_IDS.has(building.typeId) || (kit.settlers === undefined && kit.stock === undefined)) return undefined;
  return developStartSoldiers(context, ownerOf(building));
};

/** The start kit enters the finished storage: reserve soldiers, copied wares, then the pools see the new stock. */
const applyStartKit = (context: SettlementContext, building: SettlementBuilding, kit: FactionStartKit) => {
  if (kit.settlers) building.idleSettlers = kit.settlers;
  const soldiers = kitSoldiers(context, building, kit);
  if (soldiers?.length) context.military?.storeFactionReserves?.(startTroopRecruits(soldiers), building);
  if (!kit.stock) return;
  const wares = Object.keys(kit.stock).sort().filter(ware => kit.stock![ware]! > 0);
  building.inventory = Object.fromEntries(wares.map(ware => [ware, kit.stock![ware]!]));
  reconcileStorageAccess(context);
};

/** The depot a map's faction start fills: the faction's home (an enemy HQ), else its first storage in map order. */
const factionStartDepot = (context: SettlementContext, faction: number) => {
  const home = findFactionHome(context, faction);
  if (home && STORAGE_IDS.has(home.typeId)) return home;
  return context.buildings.find(building => ownerOf(building) === faction && STORAGE_IDS.has(building.typeId));
};

/**
 * A new game of an authored map: every active AI entry's `start` (settlers, soldiers, wares) enters its faction's
 * authored depot through the `aiPlace` start-kit path. A faction without an authored depot gets nothing here (a
 * tester's or fixture's `aiPlace` kit is its start); `none` entries keep today's behaviour.
 */
export const applyFactionAiStarts = (context: SettlementContext) => {
  for (const entry of activeFactionAi(context.options.world.scenario?.factionAi)) {
    if (!entry.start) continue;
    const depot = factionStartDepot(context, entry.faction);
    if (depot) applyStartKit(context, depot, entry.start);
  }
};

/**
 * Building placement, demolition and road links of computer factions that run an economy (enemy
 * economy AI plan §4.2/§4.3, EAI1d). They share the player's core (`placeOwnedDraft`, `removeSite`,
 * the territory road controls) and skip the human-only gates: level unlocks, the campaign blacklist,
 * home-island-only types, the colony and adventure refusals and the colony's base producer refusal.
 * None is a recorded command: the AI calls them inside the tick, so a replay repeats them; `aiPlace`
 * is the recorded development command for testers and fixtures.
 */
export const createFactionPlacement = (context: SettlementContext, systems: FactionPlacementSystems) => {
  const { freeStock, placement } = systems;
  const factionReason = (faction: number) => {
    const valid = Number.isSafeInteger(faction) && faction !== PLAYER_FACTION && hasEconomy(context, faction);
    return valid ? null : NOT_AN_ECONOMY_FACTION;
  };
  const roadsOf = (faction: number) => createTerritoryRoadControls(context, faction).connectRoads;
  /** A faction's first headquarters is raised, never built: only the finished debug entry offers it. */
  const offersType = (faction: number, typeId: number, finished: boolean) => {
    if (buildingEntry(typeId)?.building.placeable === true) return true;
    return finished && typeId === HEADQUARTERS_TYPE_ID && !findFactionHome(context, faction);
  };
  /** The material rules: the base producers on every map (a colony refuses them to the player only). */
  const allowsMaterial = (typeId: number) => isBaseProducer(typeId) || placement.allowsMaterial(typeId);
  /** Why the faction may not build this type now: never offered, its material, or its build limit. */
  const typeReason = (faction: number, typeId: number, finished: boolean) => {
    if (!offersType(faction, typeId, finished) || !allowsMaterial(typeId)) return NOT_BUILDABLE;
    // The map's bans and tier cap bind computer factions too (Easy one tier lower); the player's level never does.
    return factionAvailabilityRefusal(context, faction, typeId) ?? placement.countLimitReason(typeId, faction);
  };
  /** Why the faction may not ask for this building at all; the plot rules follow in the shared core. */
  const requestReason = (faction: number, draft: FactionBuildingDraft, finished: boolean) => {
    const invalid = factionReason(faction);
    if (invalid) return invalid;
    if (!validDraft(draft)) return INVALID_PLOT;
    return typeReason(faction, draft.typeId, finished);
  };
  /** The faction's unplaced draft of a plot (no uid consumed): its footprint, flag and cost in its nation. */
  const factionSiteDraft = (faction: number, draft: FactionBuildingDraft) =>
    draftBuilding(context, draft.typeId, draft.x, draft.z, draft.rotation ?? 0, nationOf(context, faction));
  const place = (faction: number, draft: FactionBuildingDraft, finished: boolean): FactionPlacementResult => {
    const reason = requestReason(faction, draft, finished);
    if (reason) return refused(reason);
    const building = factionSiteDraft(faction, draft);
    if (finished) finishDraft(building, "Complete");
    return placeOwnedDraft(context, { building, connectRoads: roadsOf(faction), freeStock, owner: faction });
  };
  /** A construction site of `faction`: its territory, its stock, its road links, its build limits. */
  const placeFactionBuilding = (faction: number, draft: FactionBuildingDraft) => place(faction, draft, false);
  /** The build planner's request check (once per decision): why the faction may not build the type at all. */
  const factionTypeReason = (faction: number, typeId: number) =>
    factionReason(faction) ?? typeReason(faction, typeId, false);
  /**
   * The build planner's plot check of a `factionSiteDraft` (after `factionTypeReason`): the shared core's plot
   * rules and the faction's territory, without the stock check, so a refusal is the plot's own (plan §3.5 memo).
   */
  const factionPlotReason = (faction: number, building: SettlementBuilding) =>
    ownedPlotReason(context, building, faction);
  /** The faction's dirt road planner (its territory rules), for the build planner's road target search. */
  const planFactionRoad = (faction: number, start: SettlementPoint, end: SettlementPoint) =>
    createTerritoryRoadControls(context, faction).planRoad(start, end, "dirt");
  /** Lays a road `planFactionRoad` checked, unplanned again; falls back to planning it between its ends. */
  const layFactionRoad = (faction: number, plan: Pick<RoadPlan, "points">) => {
    if (factionReason(faction)) return false;
    if (createTerritoryRoadControls(context, faction).addPlannedRoad(plan)) return true;
    return connectFactionRoads(faction, plan.points[0]!, plan.points.at(-1)!) === true;
  };
  /** A dirt road inside the faction's territory, then its nearby entrances join it (as the player's do). */
  const connectFactionRoads = (faction: number, start: SettlementPoint, end: SettlementPoint) => {
    if (factionReason(faction)) return false;
    const connectRoads = roadsOf(faction);
    const connected = connectRoads(start, end);
    if (connected) connectNearbyBuildingEntrances(context, connectRoads, faction);
    return connected;
  };
  /** Demolition by its owner faction only; the faction's home stays, as the player's does. */
  const demolishFactionBuilding = (faction: number, uid: number) => {
    const invalid = factionReason(faction);
    if (invalid) return refused(invalid);
    const building = context.buildings.find(entry => entry.uid === uid);
    if (!building || ownerOf(building) !== faction) return refused(NOT_A_FACTION_BUILDING);
    if (building === findFactionHome(context, faction)) return refused("A faction keeps its home building");
    return placement.removeSite(building);
  };
  /**
   * Development command: a faction's construction site, or with `startKit` a finished building raised
   * for free (a storage takes the kit's settlers and wares). The kit is how a tester gives a faction
   * its first depot: the first headquarters precedes the faction's territory and stock.
   */
  const aiPlace = (faction: number, draft: FactionBuildingDraft, startKit?: FactionStartKit) => {
    if (!startKit) return place(faction, draft, false);
    if (validDraft(draft) && !validStartKit(draft.typeId, startKit)) return refused(INVALID_START_KIT);
    const placed = place(faction, draft, true);
    if (placed.ok && placed.building) applyStartKit(context, placed.building, startKit);
    return placed;
  };
  return {
    aiPlace, connectFactionRoads, demolishFactionBuilding, factionPlotReason, factionSiteDraft, factionTypeReason,
    layFactionRoad, placeFactionBuilding, planFactionRoad
  };
};

export type FactionPlacement = ReturnType<typeof createFactionPlacement>;
