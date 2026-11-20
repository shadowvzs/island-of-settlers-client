import { ADVENTURE_LIMIT, ADVENTURE_OFFERS } from "@shared/catalog/balance";

import { COLONY_CREW, COLONY_ISLAND_OFFERS, COLONY_LIMIT, COLONY_SUPPLIES } from "../balance/colonies";
import { isColonyResourceTier } from "../world/colony-resource-tiers";
import { adventureIslandError, isAdventureIsland } from "./adventure-rules";
import { isAdventureTheme } from "./adventure-themes";
import { isColonyDifficulty } from "./colony-expedition-rules";
import { MAX_COLONY_ROUND } from "./colony-offer-replenishment";
import { validBattleRecord } from "./expedition-battle-record";
import { debugFlagError } from "./expedition-debug-rules";
import { isDiscoveryTimeZone,islandDiscoveryError } from "./island-discovery-policy";
import { isSavePoint } from "./save-validation";
import type { SettlementAdventureSave } from "./settlement-adventure";
import { adventureLandingError } from "./settlement-adventure-landing";
import type { SettlementColonySave } from "./settlement-colony";
import { colonyCounterattackError } from "./settlement-colony-counterattack";
import type { ColonyExpedition, ColonyExpeditionState } from "./settlement-colony-expeditions";
import type { SettlementSaveV1 } from "./settlement-save-state";

const STATUSES = new Set(["preparing", "sailing", "arrived"]);
const COLONY_ORES = new Set(["coal", "goldOre", "ironOre", "stone"]);
const PREPARING_PHASES = new Set(["navalToHarbour", "navalEnterHarbour", "navalWaiting"]);
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const isGoods = (value: unknown) => Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
  Object.values(value as object).every(count);

const COLONY_ISLAND_STATUSES = new Set(["contested", "conquered", "defeated"]);
const ADVENTURE_STATUSES = new Set(["contested", "won", "defeated"]);
const islandError = (island: SettlementColonySave["island"] | undefined) =>
  (island?.resourceTier !== undefined && !isColonyResourceTier(island.resourceTier)) ||
  !island || !count(island.id) || !count(island.seed) || typeof island.name !== "string" ||
  !isColonyDifficulty(island.difficulty) || !COLONY_ORES.has(island.ore) || !(island.voyageSeconds > 0) ||
  debugFlagError(island) || (island.theme !== undefined && !isAdventureTheme(island.theme)) ||
  Boolean(islandDiscoveryError(island));
const expeditionIslandError = (island: ColonyExpedition["island"]) =>
  isAdventureIsland(island) ? Boolean(adventureIslandError(island)) : islandError(island);

/** Adventures carry troops only: no crew and no supplies. */
const passengerShapeError = (expedition: ColonyExpedition) => {
  const adventure = isAdventureIsland(expedition.island);
  if (adventure && Object.keys(expedition.cargo).length) return "Invalid adventure expedition cargo";
  if (!Array.isArray(expedition.crew) || expedition.crew.length > (adventure ? 0 : COLONY_CREW) ||
    !Array.isArray(expedition.passengers) || !Array.isArray(expedition.emigrants))
    return "Invalid colony expedition crew";
  return null;
};

const expeditionShapeError = (expedition: ColonyExpedition, nextExpedition: number) => {
  if (!expedition || !Number.isSafeInteger(expedition.id) || expedition.id < 1 || expedition.id >= nextExpedition)
    return "Invalid colony expedition identity";
  if (!STATUSES.has(expedition.status) || expeditionIslandError(expedition.island))
    return "Invalid colony expedition settings";
  if (!isGoods(expedition.cargo) || !isGoods(expedition.landed) || !isGoods(expedition.troops))
    return "Invalid colony expedition goods";
  if (Object.entries(expedition.cargo).some(([ware, amount]) => amount > (COLONY_SUPPLIES[ware] ?? 0)))
    return "Invalid colony expedition supplies";
  if (![expedition.loads, expedition.departed, expedition.arrived].every(count) ||
    expedition.departed > expedition.loads || expedition.arrived > expedition.departed ||
    !Number.isFinite(expedition.elapsed) || !Number.isFinite(expedition.estimate))
    return "Invalid colony expedition progress";
  return passengerShapeError(expedition);
};

/** The colony island's own settlement record; absent on the home island. */
export const validateColonySave = (colony: SettlementColonySave | undefined) => {
  if (colony === undefined) return null;
  if (colony?.island && islandDiscoveryError(colony.island)) return islandDiscoveryError(colony.island);
  if (!colony || colony.version !== 1 || islandError(colony.island) || !COLONY_ISLAND_STATUSES.has(colony.status) ||
    !count(colony.forts) || (colony.conqueredAt !== undefined && !Number.isFinite(colony.conqueredAt)))
    return "Invalid colony island state";
  if (!validBattleRecord(colony.battle)) return "Invalid colony battle record";
  if (colonyCounterattackError(colony.counterattack)) return "Invalid colony counterattack";
  return null;
};

/** The adventure island's own settlement record; absent everywhere else. */
export const validateAdventureSave = (
  adventure: SettlementAdventureSave | undefined, world?: { cellsX: number; cellsZ: number }
) => {
  if (adventure === undefined) return null;
  if (!adventure || adventure.version !== 1 || adventureIslandError(adventure.island) ||
    !ADVENTURE_STATUSES.has(adventure.status) || !count(adventure.enemies) ||
    (adventure.endedAt !== undefined && !Number.isFinite(adventure.endedAt)) ||
    adventureLandingError(adventure.landing))
    return "Invalid adventure island state";
  if (!validBattleRecord(adventure.battle)) return "Invalid adventure battle record";
  if (adventure.campSites !== undefined && (!Array.isArray(adventure.campSites) ||
    adventure.campSites.length > 6 || !adventure.campSites.every(site => isSavePoint(site) &&
      site.x >= 0 && site.z >= 0 && (!world || site.x < world.cellsX && site.z < world.cellsZ))))
    return "Invalid adventure camp sites";
  return null;
};

/** At most COLONY_LIMIT colony expeditions plus ADVENTURE_LIMIT adventures. */
const expeditionCountError = (state: ColonyExpeditionState) => {
  if (state.discoveryVersion !== undefined && state.discoveryVersion !== 1) return "Unsupported island discovery policy";
  if (state.discoveryTimeZone !== undefined && !isDiscoveryTimeZone(state.discoveryTimeZone))
    return "Invalid discovery timezone";
  for (const [offers, limit, check] of [
    [state.colonyOffers, COLONY_ISLAND_OFFERS, (island: unknown) => islandError(island as SettlementColonySave["island"])],
    [state.adventureOffers, ADVENTURE_OFFERS, (island: unknown) => Boolean(adventureIslandError(island))]
  ] as const) {
    if (offers !== undefined && (!Array.isArray(offers) || offers.length !== limit ||
      offers.some(check) || new Set(offers.map(island => island.id)).size !== offers.length))
      return "Invalid persisted island offers";
  }
  const adventures = state.expeditions.filter(expedition => isAdventureIsland(expedition?.island)).length;
  if (adventures > ADVENTURE_LIMIT || state.expeditions.length - adventures > COLONY_LIMIT)
    return "Too many colony or adventure expeditions";
  if (state.adventureRound !== undefined && !count(state.adventureRound)) return "Invalid adventure round";
  if (state.colonyRound !== undefined && (!count(state.colonyRound) || state.colonyRound > MAX_COLONY_ROUND))
    return "Invalid colony discovery round";
  return null;
};

/** Preparing colony crews are owned by their expedition until the fleet takes each load. */
export const validateColonyExpeditions = (save: SettlementSaveV1, held: Set<number>) => {
  const state = save.naval.colonies;
  if (state === undefined) return null; // Saves from before colonies have no extension.
  if (!state || !Number.isSafeInteger(state.nextExpedition) || !Array.isArray(state.expeditions))
    return "Invalid colony expedition state";
  const countError = expeditionCountError(state);
  if (countError) return countError;
  for (const expedition of state.expeditions) {
    if (expedition?.island && islandDiscoveryError(expedition.island)) return islandDiscoveryError(expedition.island);
    const error = expeditionShapeError(expedition, state.nextExpedition);
    if (error) return error;
    if (expedition.status !== "preparing") continue;
    for (const uid of [...expedition.crew, ...expedition.passengers]) {
      const actor = save.actors.find(candidate => candidate.uid === uid);
      if (held.has(uid) || !actor || actor.navalOrder !== 0 || !PREPARING_PHASES.has(actor.phase) ||
        !["Settler", "Soldier"].includes(actor.job)) return "Invalid colony expedition passenger";
      held.add(uid);
    }
  }
  return null;
};
