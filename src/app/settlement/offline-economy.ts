import { COLONY_LIFETIME_MS, COLONY_MATERIAL_WARES } from "@shared/catalog/balance";

import { TICK_HZ, TICK_SECONDS } from "../../../../island-of-settlers-shared/src/time/constants";
import { TOOL_WARES } from "../../render-common/wares/ware-catalog";
import { OFFLINE_CATCH_UP_CAP_SECONDS } from "../../shared/balance/offline";
import {
  COLONY_POPULATION_BASE_LIMIT, POPULATION_BASE_LIMIT, POPULATION_GROWTH_SECONDS
} from "../../shared/balance/population";
import {
  createPlayerProgress, questDayKey, recordProduction, refreshQuests
} from "../../shared/progression/player-progress";
import { talentModifiers } from "../../shared/progression/talents";
import { recordHomeQuestEvent } from "../../shared/quests/home-quests";
import { colonyOreShipMs, type ColonyRecord,deferOreShips } from "../../shared/settlement/archipelago";
import { applyReturnedColonyRelief } from "../../shared/settlement/archipelago-relief";
import { completeArmoryOrder } from "../../shared/settlement/armory-orders";
import { colonyUpgradeReserve } from "../../shared/settlement/colony-advanced-material-trade";
import { COLONY_FOODS, colonySupplyDemand, FOOD } from "../../shared/settlement/colony-economy";
import { colonyOreWare } from "../../shared/settlement/colony-island-rules";
import { createGameSave, type GameSaveV1 } from "../../shared/settlement/game-save";
import { advanceOfflineHarbourShuttles } from "../../shared/settlement/harbour-shuttle-offline";
import { applyOfflineCivilianRaid } from "../../shared/settlement/offline-civilian-raid";
import { STORAGE_IDS } from "../../shared/settlement/production-rules";
import { isActiveResidence, residenceGrowthSeconds, residenceLevel, residenceLimitBonus } from "../../shared/settlement/residences";
import { isHomeBuilding, isHomeType, isOwnBuilding } from "../../shared/settlement/settlement-home";
import { civilianOwnerOf, ownerOf, PLAYER_FACTION } from "../../shared/settlement/settlement-ownership";
import type { Goods, SettlementBuilding } from "../../shared/settlement/settlement-types";
import { isSharedStorageWare } from "../../shared/settlement/shared-storage";
import { wareBoxUnits } from "../../shared/settlement/ship-cargo-boxes";
import { stageGameSession } from "./game-session";
import { offlineCyclesPerJobCycle } from "./offline-boat-fishing";
import { prepareOfflineEconomyArrivals } from "./offline-economy-arrivals";
import { createEconomyCycleObservation, extendedCalibratedEconomyCycle } from "./offline-economy-calibration";
import { prepareOfflineEconomyDeliveries } from "./offline-economy-deliveries";
import { type OfflineEconomyIsland,type OfflineEconomyJob,runOfflineEconomyEvents } from "./offline-economy-events";
import { prepareOfflineEconomyFastShips } from "./offline-economy-fast-ship";
import { prepareOfflineEconomyFlax } from "./offline-economy-flax";
import { prepareOfflineEconomyHandcartReceipts } from "./offline-economy-handcarts";
import { prepareOfflineEconomyInputs } from "./offline-economy-inputs";
import { prepareOfflineEconomyLogistics } from "./offline-economy-logistics";
import { prepareOfflineEconomyOutputs } from "./offline-economy-outputs";
import {
  computerEconomyJobs, estimateOfflineComputerEconomies, goodsOfOwner, type OfflineComputerEconomy, storageWareName,
  taggedGoods, waresOfOwner
} from "./offline-economy-owners";
import { completedEconomyJobOutput } from "./offline-economy-production";
import {
  estimateOfflineEconomyRates, OFFLINE_ECONOMY_TICKS_PER_SECOND as TPS, type OfflineEconomyRates
} from "./offline-economy-rates";
import { prepareOfflineEconomySources } from "./offline-economy-sources";
import { prepareOfflineEconomyWildlife } from "./offline-economy-wildlife";
import { commitFlaxCarriers, flaxCarrierPool } from "./offline-flax-carriers";
import { settleOriginalShipwrights } from "./offline-flax-shipwright";
import { recoverOfflineMilitary } from "./offline-military-recovery";
import {
  advanceOfflineGame, expireColonies, islandCatchUpSeconds, type OfflineProgress, type OfflineReplayOptions,
  offlineSeconds
} from "./offline-progress";
import { offlineStorageCapacity } from "./offline-storage-capacity";
import { advanceOfflineTradeCalendar } from "./offline-trade-calendar";

const ECONOMY_APPROXIMATIONS = [
  "Static or measured worker rates; shared transport work budget, physical input leads and priority buffers; original worker goods retain their owners.",
  "New unfinished ordinary cycles and voyages are refunded at cutoff; flax, cloth and sea-hull receipts stay with their producer/site.",
  "Flax plots, looms and sea-ship sites use explicit finite state; no farm harvest, cloth or fleet ship is credited from end-of-gap stock.",
  "Existing combat, construction, services and unmodeled animal/source behavior resume after recovery.",
  "Raiders among civilians: estimated civilian losses (offline-civilian-raid.ts) are applied before the " +
    "window; the fights themselves resume after recovery.",
  "Military promotion is a service: the fast model never promotes soldiers or spends their coins and national drink; training resumes after recovery.",
  "Resting soldiers recover for the modeled remainder only where they are already inside a completed friendly storage, harbour or military building; travel, fights and arrivals resume on exact ticks.",
  "Colony shipments use conservative voyage/service intervals and per-ware demand targets; physical berth contention is approximated.",
  "Trade calendars advance through the full absence; expired escrow returns to its original pool at recovery end. Newly filled offers await normal physical shipping."
];

export interface OfflineEconomyMetrics {
  mode: "economy";
  gameSeconds: number;
  islands: number;
  events: number;
  wallMs: number;
  calibrationSeconds: number;
  modeledSeconds: number;
  /** Event-remainder output only. Calibration output is observed separately through onProduced. */
  productionScope: "event-remainder";
  /** Gross physical output; shipping and synthetic source tokens are excluded. */
  production: { islandId: string; produced: Goods; consumed: Goods; sent: Goods; received: Goods }[];
  /** Recipe jobs only; exact-prefix completions and wildlife receipts are observed separately. */
  buildingProduction?: { islandId: string; uid: number; typeId: number; produced: Goods }[];
  estimates: { islandId: string; rates: ReturnType<typeof estimateOfflineEconomyRates> }[];
  approximations: string[];
  treeFellings?: { islandId: string; seconds: number; treeId: number }[];
}

const add = (goods: Goods, ware: string, count: number) => {
  const next = (goods[ware] ?? 0) + count;
  if (!Number.isSafeInteger(next) || next < 0) throw new Error(`Offline economy: invalid ${ware} balance`);
  goods[ware] = next;
};
/** The player's physical goods: neither source tokens nor a computer economy's pool (EAI5b). */
const physical = (goods: Readonly<Goods>): Goods =>
  Object.fromEntries(Object.entries(goodsOfOwner(goods, PLAYER_FACTION)).filter(([ware]) => !ware.startsWith("~")));

/**
 * Only freely owned storage stock participates. Buffers, incoming manifests and actor cargo keep their owners.
 * `owner`: whose pool (the player's, or a computer economy's own storages, EAI5b).
 */
export const offlineEconomyStorage = (save: GameSaveV1, allowed?: readonly number[], owner = PLAYER_FACTION) => {
  const reachable = save.settlement.buildings.filter(building => building.construction === 1 &&
    ownerOf(building) === owner && STORAGE_IDS.has(building.typeId) &&
    (!allowed || allowed.includes(building.uid)));
  const home = reachable.find(isHomeType) ?? reachable[0];
  const poolId = home?.storagePoolId;
  const slots = reachable.filter(slot => slot.storagePoolId === poolId);
  const pool = save.settlement.storagePools.pools.find(entry => entry.id === poolId);
  if (slots.length && !pool) throw new Error("Offline economy: missing local storage pool");
  const stock: Goods = {};
  for (const [ware, count] of Object.entries(pool?.available ?? {})) add(stock, ware, count);
  for (const slot of slots) {
    // reserveShipGoods moves goods OUT of inventory into separate shipReserve escrow. Remaining
    // inventory is already free; subtracting shipReserve again would withhold stock twice.
    for (const [ware, count] of Object.entries(slot.inventory)) if (!isSharedStorageWare(ware)) add(stock, ware, count);
  }
  return { pool, slots, stock };
};

/** Applies only a net free-storage change, preserving per-building ship reserves and all other ownership. */
export const applyOfflineEconomyStock = (
  save: GameSaveV1, before: Readonly<Goods>, after: Readonly<Goods>, allowed?: readonly number[],
  owner = PLAYER_FACTION
) => {
  const { pool, slots } = offlineEconomyStorage(save, allowed, owner);
  const wares = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const ware of wares) {
    if (ware.startsWith("~")) continue;
    const change = (after[ware] ?? 0) - (before[ware] ?? 0);
    if (isSharedStorageWare(ware)) {
      if (!pool) throw new Error(`Offline economy: no local storage pool for ${ware}`);
      if (change < 0 && (pool.available[ware] ?? 0) < -change)
        throw new Error(`Offline economy: unavailable ${ware} at commit`);
      if (change > 0 && !slots.some(slot => slot.accepts[ware] !== false))
        throw new Error(`Offline economy: no storage accepts ${ware}`);
      continue;
    }
    if (change < 0 && slots.reduce((sum, slot) => sum + (slot.inventory[ware] ?? 0), 0) < -change)
      throw new Error(`Offline economy: unavailable ${ware} at commit`);
    if (change > 0 && !slots.some(slot => slot.accepts[ware] !== false))
      throw new Error(`Offline economy: no storage accepts ${ware}`);
  }
  for (const ware of wares) {
    if (ware.startsWith("~")) continue;
    const change = (after[ware] ?? 0) - (before[ware] ?? 0);
    if (isSharedStorageWare(ware)) {
      add(pool!.available, ware, change);
      continue;
    }
    if (change < 0) {
      let remaining = -change;
      for (const slot of slots) {
        const free = slot.inventory[ware] ?? 0;
        const amount = Math.min(remaining, free);
        add(slot.inventory, ware, -amount); remaining -= amount;
      }
      if (remaining) throw new Error(`Offline economy: unavailable ${ware} at commit`);
    } else if (change > 0) {
      const destination = slots.find(slot => slot.accepts[ware] !== false);
      if (!destination) throw new Error(`Offline economy: no storage accepts ${ware}`);
      add(destination.inventory, ware, change);
    }
  }
};

/** Fast delivery completion changes carrier phases; drop receipts that no longer describe them. */
export const pruneStaleStockTraffic = (save: GameSaveV1, before: ReadonlyMap<number, string>) => {
  const traffic = save.settlement.stockTraffic;
  if (!traffic) return;
  const actors = new Map(save.settlement.actors.map(actor => [actor.uid, actor]));
  const buildings = new Set(save.settlement.buildings.map(building => building.uid));
  const changed = new Set<number>();
  for (const [uid, phase] of before) if (actors.get(uid)?.phase !== phase) changed.add(uid);
  for (const actor of actors.keys()) if (!before.has(actor)) changed.add(actor);
  traffic.actors = traffic.actors.filter(entry => {
    const actor = actors.get(entry.actor);
    return Boolean(actor) && !changed.has(entry.actor) && entry.phase === actor!.phase;
  });
  traffic.owners = traffic.owners.filter(entry =>
    Boolean(actors.get(entry.actor)) && !changed.has(entry.actor) && buildings.has(entry.building));
};

/** `computers`: the island's computer economies; their civilians are their own people, not the player's (EAI5b). */
const advancePopulation = (save: GameSaveV1, seconds: number, computers: ReadonlySet<number>) => {
  const state = save.settlement, talents = talentModifiers(save.player?.talents);
  const home = state.buildings.find(building => building.construction === 1 && isHomeBuilding(building));
  if (!home) return;
  const residences = state.buildings.filter(building => isActiveResidence(building));
  const limit = Math.floor(((home.colonyHome ? COLONY_POPULATION_BASE_LIMIT : POPULATION_BASE_LIMIT) +
    residences.reduce((sum, building) => sum + residenceLimitBonus(building.typeId, residenceLevel(building)), 0)) *
    (1 + talents.populationLimit) + 1e-9);
  const hostile = new Set(state.military?.soldiers.filter(soldier => (soldier.combat?.faction ?? 0) !== 0).map(soldier => soldier.actor));
  const people = state.settlers + state.actors.filter(actor => actor.phase !== "retired" &&
    actor.job !== "Mount" && !hostile.has(actor.uid) && !computers.has(civilianOwnerOf(actor))).length;
  let room = Math.max(0, limit - people), elapsed = 0, births = 0;
  const clocks = [{ interval: POPULATION_GROWTH_SECONDS, time: state.settlerGrowthTime, building: undefined as SettlementBuilding | undefined },
    ...residences.map(building => ({ interval: residenceGrowthSeconds(building.typeId), time: building.settlerGrowthTime ?? 0, building }))];
  const speed = 1 + talents.settlerGrowthSpeed;
  while (room > 0 && elapsed < seconds) {
    const step = Math.min(seconds - elapsed, ...clocks.map(clock => Math.max(0, (clock.interval - clock.time) / speed)));
    for (const clock of clocks) clock.time += step * speed;
    elapsed += step;
    let born = 0;
    for (const clock of clocks) {
      if (room <= 0) {
        // Exact population processing stops before later residence clocks when the last birth fills
        // the island. Keep those unvisited clocks in their previous valid phase.
        clock.time = Math.max(0, clock.time - step * speed);
        continue;
      }
      if (clock.time + 1e-8 >= clock.interval) {
        clock.time = Math.max(0, clock.time - clock.interval); room--; births++; born++;
      }
    }
    if (!step && !born) break;
  }
  state.settlerGrowthTime = clocks[0]!.time;
  for (const clock of clocks) if (clock.building) clock.building.settlerGrowthTime = clock.time;
  state.settlers += births; state.settlerBirths += births;
  home.idleSettlers = (home.idleSettlers ?? 0) + births;
};

type LoadedIsland = {
  id: string; save: GameSaveV1; colony?: ColonyRecord;
  loaded: Awaited<ReturnType<typeof stageGameSession>>;
  rates: ReturnType<typeof estimateOfflineEconomyRates>;
  sources: ReturnType<typeof prepareOfflineEconomySources>;
  arrivals: ReturnType<typeof prepareOfflineEconomyArrivals>;
  outputs: ReturnType<typeof prepareOfflineEconomyOutputs>;
  deliveries: ReturnType<typeof prepareOfflineEconomyDeliveries>;
  handcarts: ReturnType<typeof prepareOfflineEconomyHandcartReceipts>;
  inputs: ReturnType<typeof prepareOfflineEconomyInputs>;
  logistics: ReturnType<typeof prepareOfflineEconomyLogistics>;
  flax: ReturnType<typeof prepareOfflineEconomyFlax>;
  ships: ReturnType<typeof prepareOfflineEconomyFastShips>;
  wildlife?: ReturnType<typeof prepareOfflineEconomyWildlife>;
  storage: ReturnType<typeof offlineEconomyStorage>;
  /** The island's computer economies with their own pools (EAI5b). */
  computers: { economy: OfflineComputerEconomy; storage: ReturnType<typeof offlineEconomyStorage> }[];
  seconds: number;
  /** The island's own save time: its modeled window starts here (review R3, C2a). */
  start: number;
};

/** Shipping shares stock and time with production. Demand targets include cargo already reserved in transit. */
const shippingJobs = (home: LoadedIsland, colonies: LoadedIsland[]): OfflineEconomyJob[] => {
  const jobs: OfflineEconomyJob[] = [];
  for (const colony of colonies) {
    const record = colony.colony!;
    if (record.status !== "conquered") continue;
    const demand = colonySupplyDemand(colony.save.settlement.buildings);
    const voyage = Math.max(0, record.island.voyageSeconds);
    // One bounded conservative service interval includes sailing plus a minute for loading/berthing.
    const duration = Math.ceil((2 * voyage + 60) * TPS);
    const endTick = Math.floor(colony.seconds * TPS);
    const oreInterval = colonyOreShipMs(talentModifiers(colony.save.player?.talents).colonyShipIntervalReduction);
    const transfer = (uid: string, from: LoadedIsland, to: LoadedIsland, ware: string,
      batch: number, target?: number, reserve = 0, extra: Partial<OfflineEconomyJob> = {}) => {
      jobs.push({ uid, kind: "transfer", islandId: from.id, destinationIslandId: to.id,
        inputs: { [ware]: 1 }, outputs: { [ware]: 1 }, maxTransferUnits: Math.max(1, batch),
        sourceReserves: { [ware]: reserve }, ...(target === undefined ? {} : { destinationTargets: { [ware]: target } }),
        cycleTicks: duration, firstTick: Math.min(60 * TPS, endTick), endTick, ...extra });
    };
    for (const [ware, missing] of Object.entries(demand)) {
      if (ware === FOOD) {
        const target = missing + COLONY_FOODS.reduce((sum, food) => sum + (colony.storage.stock[food] ?? 0), 0);
        for (const food of COLONY_FOODS) transfer(`supply:${colony.id}:${food}`, home, colony, food, 40,
          undefined, 0, { destinationTargetGroup: { wares: [...COLONY_FOODS], units: target } });
      } else transfer(`supply:${colony.id}:${ware}`, home, colony, ware, 40, (colony.storage.stock[ware] ?? 0) + missing);
    }
    const wares = [colonyOreWare(record.island), ...COLONY_MATERIAL_WARES];
    for (const ware of new Set(wares)) {
      const box = wareBoxUnits(ware), reserve = colonyUpgradeReserve(colony.save.settlement.buildings, ware);
      transfer(`export-box:${colony.id}:${ware}`, colony, home, ware, box, undefined, reserve,
        { minTransferUnits: box });
      transfer(`export-hour:${colony.id}:${ware}`, colony, home, ware, box, undefined, reserve,
        { firstTick: Math.max(0, Math.ceil(((record.nextOreShipAt ?? colony.save.savedAt + oreInterval) -
          colony.save.savedAt) / 1000 * TPS)), startIntervalTicks: oreInterval / 1000 * TPS });
    }
  }
  return jobs;
};

/** One economy's production jobs on its island, with their carrier work and horizon. */
const islandProductionJobs = (island: LoadedIsland, rates: OfflineEconomyRates): OfflineEconomyJob[] =>
  rates.jobs.map((job, index) => {
    const rate = rates.buildings[index]!;
    return { ...job, islandId: island.id,
      workTicks: job.inputSuppliers === undefined ? Math.ceil(rate.carrierSeconds * TPS) : 0,
      uid: `${island.id}:${job.uid}`, endTick: job.endTick ?? Math.floor(island.seconds * TPS) };
  });

/** Free room per ware in one owner's storages; existing overfull stocks are preserved but never enlarged. */
const storageCapacities = (
  save: GameSaveV1, storage: ReturnType<typeof offlineEconomyStorage>, wares: Iterable<string>,
  talentBonus: number, owner: number
) => {
  const snapshot = offlineStorageCapacity(save, storage.slots, talentBonus, owner);
  const capacities: Goods = {};
  for (const ware of wares) if (!ware.startsWith("~")) {
    const retained = (snapshot.stored[ware] ?? 0) - (storage.stock[ware] ?? 0);
    capacities[ware] = Math.max(storage.stock[ware] ?? 0,
      snapshot.capacity - (snapshot.reserved[ware] ?? 0) - retained);
    if (!storage.slots.some(slot => slot.accepts[ware] !== false))
      capacities[ware] = storage.stock[ware] ?? 0;
  }
  return capacities;
};

/** The computer economies' pools in the island's ledger: tagged stock, room and their carriers (EAI5b). */
const computerAccounts = (island: LoadedIsland, islandWares: ReadonlySet<string>) => {
  const stock: Goods = {}, capacities: Goods = {};
  let carriers = 0;
  for (const { economy, storage } of island.computers) {
    const wares = new Set([...Object.keys(storage.stock), ...waresOfOwner(islandWares, economy.owner)]);
    Object.assign(stock, taggedGoods(storage.stock, economy.owner));
    Object.assign(capacities, taggedGoods(storageCapacities(island.save, storage, wares, 0, economy.owner),
      economy.owner));
    carriers += economy.rates.routes.equivalentCarriers;
  }
  return { capacities, carriers, stock };
};

/** Prefixed production/site jobs and each island's finite capacities for the event kernel. */
const assembleOfflineEconomy = (islands: LoadedIsland[], player: GameSaveV1["player"]):
{ economyIslands: OfflineEconomyIsland[]; jobs: OfflineEconomyJob[] } => {
  const jobs: OfflineEconomyJob[] = islands.flatMap(island => islandProductionJobs(island, island.rates));
  jobs.push(...islands.flatMap(island => [
    ...island.flax.jobs.map(job => ({ ...job, islandId: island.id, uid: `${island.id}:${job.uid}`,
      endTick: job.endTick ?? Math.floor(island.seconds * TPS) })),
    ...island.ships.jobs.map(job => ({ ...job, uid: `${island.id}:${job.uid}`,
      endTick: job.endTick ?? Math.floor(island.seconds * TPS) }))
  ]));
  jobs.push(...islands.flatMap(island => island.sources.jobs.map(job => ({ ...job, islandId: island.id,
    uid: `${island.id}:${job.uid}`, endTick: Math.floor(island.seconds * TPS) }))));
  jobs.push(...islands.flatMap(island => island.arrivals.jobs));
  jobs.push(...islands.flatMap(island => island.outputs.jobs));
  jobs.push(...islands.flatMap(island => island.deliveries.jobs));
  jobs.push(...islands.flatMap(island => island.handcarts.jobs));
  jobs.push(...islands.flatMap(island => island.logistics.jobs));
  const home = islands.find(island => island.id === "home");
  if (home) jobs.push(...shippingJobs(home, islands.filter(island => island.colony)));
  // The computer economies' jobs come after every player job: the player takes a shared source first.
  jobs.push(...islands.flatMap(island => island.computers.flatMap(({ economy }) =>
    islandProductionJobs(island, economy.rates))));
  const economyIslands: OfflineEconomyIsland[] = [...islands.map(island => {
    const islandWares = new Set([...Object.keys(island.storage.stock), ...jobs.filter(job =>
      job.islandId === island.id || job.destinationIslandId === island.id).flatMap(job =>
      [...Object.keys(job.inputs), ...Object.keys(job.outputs), ...job.alternativeFoods ?? []])]);
    const capacities = storageCapacities(island.save, island.storage, waresOfOwner(islandWares, PLAYER_FACTION),
      talentModifiers(player?.talents).storageCapacity, PLAYER_FACTION);
    const computers = computerAccounts(island, islandWares);
    Object.assign(capacities, island.sources.capacities, computers.capacities);
    const recruitableWorkers = flaxCarrierPool(island.save, island.rates.storageUids);
    const workCapacity = recruitableWorkers === undefined
      ? island.rates.routes.equivalentCarriers + computers.carriers
      : island.save.settlement.actors.filter(actor => actor.job === "Carrier" && actor.phase !== "retired").length;
    return { islandId: island.id, stock: { ...island.storage.stock, ...island.sources.stock,
      ...island.flax.stock, ...computers.stock }, capacities, workCapacity, recruitableWorkers };
  }), ...islands.flatMap(island => island.arrivals.islands), ...islands.flatMap(island => island.outputs.islands),
    ...islands.flatMap(island => island.deliveries.islands), ...islands.flatMap(island => island.handcarts.islands),
    ...islands.flatMap(island => island.logistics.islands), ...islands.flatMap(island => island.ships.islands)];
  return { economyIslands, jobs };
};

/** Completed cycles move each producer's output cursor; charcoal/crop phases keep their saved cursor. */
const advanceBuildingCycles = (
  island: LoadedIsland, rates: OfflineEconomyRates, completedCycles: Readonly<Record<string, number>>
) => {
  for (const rate of rates.buildings) {
    const building = island.save.settlement.buildings.find(building => building.uid === rate.uid)!;
    const job = rates.jobs.find(job => job.uid === rate.jobUid)!;
    const cycles = completedCycles[`${island.id}:${rate.jobUid}`] ?? 0;
    // Other ordinary cycles retain their output sequence; the armory completes its ordered outputs.
    if (building.typeId === 24) {
      for (const output of job.outputSequence?.slice(0, cycles) ?? [])
        completeArmoryOrder(building, storageWareName(Object.keys(output).find(ware => !ware.startsWith("~"))!));
    } else if (![5, 27, 37, 60].includes(building.typeId))
      building.cycle += cycles * offlineCyclesPerJobCycle(building);
  }
};

type EconomyLedger = ReturnType<typeof runOfflineEconomyEvents>["islands"][number];

/**
 * One island's modeled window into its save: every economy's stock (the player's, then each computer economy's own
 * pool), sources, saved boat jobs, people, resting soldiers, the clock and the producers' output cursors.
 */
const commitIslandLedger = (
  island: LoadedIsland, ledger: EconomyLedger, completedCycles: Readonly<Record<string, number>>,
  player: GameSaveV1["player"]
) => {
  commitFlaxCarriers(island.save, ledger.recruitedWorkers ?? 0, island.rates.storageUids);
  applyOfflineEconomyStock(island.save, island.storage.stock, goodsOfOwner(ledger.stock, PLAYER_FACTION),
    island.rates.storageUids);
  for (const { economy, storage } of island.computers)
    applyOfflineEconomyStock(island.save, storage.stock, goodsOfOwner(ledger.stock, economy.owner),
      economy.rates.storageUids, economy.owner);
  island.wildlife?.apply(completedCycles, ledger);
  island.sources.apply(Object.fromEntries(Object.entries(ledger.consumed).filter(([ware]) => ware !== "~carriers" &&
    !ware.startsWith("~wildlife:") && !ware.startsWith("~flax:") && !ware.startsWith("~ship:"))),
    ledger.stock, ledger.produced);
  // Existing saved boat jobs advance their finite timetable at most once; no new job is generated
  // and blocked cargo stays aboard for exact native recovery.
  advanceOfflineHarbourShuttles(island.save.settlement.naval?.fleet?.shuttles, island.save.settlement,
    island.seconds);
  // A computer economy's people are frozen offline (v1, EAI1a F4): only the player's island grows.
  advancePopulation({ ...island.save, player }, island.seconds,
    new Set(island.computers.map(({ economy }) => economy.owner)));
  recoverOfflineMilitary(island.save.settlement, island.seconds);
  island.save.settlement.gameTick = (island.save.settlement.gameTick ?? 0) +
    Math.floor(island.seconds / TICK_SECONDS + 1e-6);
  advanceBuildingCycles(island, island.rates, completedCycles);
  for (const { economy } of island.computers) advanceBuildingCycles(island, economy.rates, completedCycles);
};

/** Metrics home stock excludes internal site tokens; ship-site consumption and transfers stay internal. */
const offlineProductionMetrics = (result: ReturnType<typeof runOfflineEconomyEvents>, islands: LoadedIsland[]) => {
  const internalFor = new Map(islands.map(island => [island.id, island.ships.internal]));
  return result.islands.slice(0, islands.length).map(ledger => {
    const consumed = { ...ledger.consumed }, sent = { ...ledger.sent };
    for (const entry of internalFor.get(ledger.islandId) ?? []) {
      const site = result.islands.find(island => island.islandId === entry.accountId);
      if (!site) continue;
      for (const [ware, count] of Object.entries(site.consumed)) add(consumed, ware, count);
      for (const [ware, count] of Object.entries(site.received)) add(sent, ware, -count);
    }
    return { ...ledger, consumed: physical(consumed), produced: physical(ledger.produced),
      sent: physical(sent), stock: physical(ledger.stock) };
  });
};

/** Unfinished flax/ship receipts stay at their building instead of returning to free storage. */
const offlinePrivateRefunds = (result: ReturnType<typeof runOfflineEconomyEvents>,
  jobs: OfflineEconomyJob[], islands: LoadedIsland[]) => {
  const jobByUid = new Map(jobs.map(job => [job.uid, job]));
  const privateRefunds = new Map<string, { building: SettlementBuilding; goods: Goods }>();
  for (const work of result.inProgress) {
    const ledger = result.islands.find(island => island.islandId === work.islandId)!;
    const definition = jobByUid.get(work.uid);
    for (const [ware, count] of Object.entries(work.inputs)) {
      if (definition?.privateRefundBuilding !== undefined && !ware.startsWith("~")) {
        const island = islands.find(entry => entry.id === definition.islandId)!;
        const building = island.save.settlement.buildings.find(entry => entry.uid === definition.privateRefundBuilding);
        if (!building) throw new Error("Offline private refund building unavailable");
        const key = `${island.id}:${building.uid}`;
        const refund = privateRefunds.get(key) ?? { building, goods: {} };
        add(refund.goods, ware, count);
        privateRefunds.set(key, refund);
      } else add(ledger.stock, ware, count);
      add(work.kind === "transfer" ? ledger.sent : ledger.consumed, ware, -count);
    }
  }
  return privateRefunds;
};

/**
 * Bounded approximate recovery. Ordinary loading opts into this explicitly; exact replay remains
 * available as the reference. All mutations are detached until encoding every island succeeds.
 * Original worker/ship work remains owned and resumes normally. Newly modeled unfinished cycles
 * are cancelled/refunded at cutoff, so no new paid-work continuation format is required.
 */
export const advanceOfflineEconomyGame = async (
  source: GameSaveV1, now: number, report: (progress: OfflineProgress) => void,
  options: OfflineReplayOptions
): Promise<GameSaveV1> => {
  const started = performance.now(), originalAway = offlineSeconds(source.savedAt, now);
  if (originalAway < .05) return source;
  const totalProductionSeconds = Math.min(originalAway, OFFLINE_CATCH_UP_CAP_SECONDS);
  const archived = source.archipelago, activeId = archived?.active ?? null;
  const islandCount = 1 + Number(activeId !== null && !!archived?.home) +
    (archived?.colonies.filter(colony => colony.save && colony.expeditionId !== activeId).length ?? 0) +
    (archived?.adventures?.filter(adventure => adventure.save && adventure.expeditionId !== activeId).length ?? 0);
  const episodeTotal = totalProductionSeconds * islandCount;
  const emit = (completedSeconds: number) => report({ completedSeconds, totalSeconds: episodeTotal });
  const initialTicks = new Map<string, number>([[String(activeId ?? "home"), source.settlement.gameTick ?? 0]]);
  if (activeId !== null && archived?.home) initialTicks.set("home", archived.home.settlement.gameTick ?? 0);
  for (const record of [...(archived?.colonies ?? []), ...(archived?.adventures ?? [])])
    if (record.save && record.expeditionId !== activeId)
      initialTicks.set(String(record.expeditionId), record.save.settlement.gameTick ?? 0);
  const calibrationLimit = options.economyCalibrationSeconds ?? 0;
  if (!Number.isFinite(calibrationLimit) || calibrationLimit < 0 || calibrationLimit > 300)
    throw new Error("Offline economy calibration must be between 0 and 300 seconds");
  let calibrationSeconds = Math.min(
    totalProductionSeconds, Math.floor(calibrationLimit / TICK_SECONDS) * TICK_SECONDS
  );
  const observations = new Map<string, ReturnType<typeof createEconomyCycleObservation>>();
  const nativeOptions: OfflineReplayOptions = {
      exact: true, eventCore: false,
      onIslandMetrics: options.onIslandMetrics,
      onProduced: options.onProduced,
      onProductionCycle: (islandId, building, consumed, output, tick) => {
        options.onProductionCycle?.(islandId, building, consumed, output, tick);
        const key = `${islandId === null ? "home" : islandId}:building:${building.uid}`;
        let record = observations.get(key);
        if (!record) observations.set(key, record = createEconomyCycleObservation());
        if (output) {
          record.ticks.push(tick); record.outputs.add(output);
          record.waitAtOutputs.push(record.inputWaitSeconds + record.outputWaitSeconds);
        }
      },
      onProductionWait: (islandId, building, seconds, tick, reason) => {
        options.onProductionWait?.(islandId, building, seconds, tick, reason);
        const id = String(islandId ?? "home"), key = `${id}:building:${building.uid}`;
        let record = observations.get(key);
        if (!record) observations.set(key, record = createEconomyCycleObservation());
        if (reason === "inputs") record.inputWaitSeconds += seconds;
        else record.outputWaitSeconds += seconds;
        if (tick <= (initialTicks.get(id) ?? 0) + 120 * TICK_HZ) record.initialWaitSeconds += seconds;
      }
  };
  if (calibrationSeconds > 0) {
    source = await advanceOfflineGame(source, source.savedAt + calibrationSeconds * 1000,
      progress => emit(progress.completedSeconds), nativeOptions);
    if (calibrationSeconds >= totalProductionSeconds) return source;
  }
  // Production startup never runs a hidden native prefix. Original owned shipwright work stays
  // on its saved site for normal resume; only an explicit calibrated diagnostic settles it here.
  if (calibrationLimit > 0) {
    const shipwrights = await settleOriginalShipwrights(source,
      Math.min(totalProductionSeconds - calibrationSeconds, Math.max(0, 300 - calibrationSeconds)),
      nativeOptions, progress => emit(calibrationSeconds * islandCount + progress.completedSeconds));
    source = shipwrights.save;
    calibrationSeconds += shipwrights.seconds;
  }
  if (calibrationSeconds >= totalProductionSeconds) return source;
  const away = offlineSeconds(source.savedAt, now), seconds = totalProductionSeconds - calibrationSeconds;
  const clone = structuredClone(source);
  const group = clone.archipelago, active = group?.active ?? null;
  const entries: { id: string; save: GameSaveV1; colony?: ColonyRecord }[] = [];
  if (active === null) entries.push({ id: "home", save: clone });
  else if (group?.home) entries.push({ id: "home", save: group.home });
  if (active !== null) entries.push({ id: String(active), save: clone,
    colony: group?.colonies.find(colony => colony.expeditionId === active) });
  for (const colony of group?.colonies ?? []) if (colony.save && colony.expeditionId !== active)
    entries.push({ id: String(colony.expeditionId), save: colony.save, colony });
  for (const adventure of group?.adventures ?? []) if (adventure.save && adventure.expeditionId !== active)
    entries.push({ id: String(adventure.expeditionId), save: adventure.save });
  const totalSeconds = seconds * entries.length;
  const islands: LoadedIsland[] = [];
  for (const entry of entries) {
    const start = entry.save.savedAt;
    const expiry = entry.colony?.conqueredAt === undefined ? Infinity :
      (entry.colony.conqueredAt + COLONY_LIFETIME_MS - start) / 1000;
    const islandSeconds = Math.max(0, Math.min(
      islandCatchUpSeconds(start, now, OFFLINE_CATCH_UP_CAP_SECONDS - calibrationSeconds), expiry));
    // Raiders standing among civilians: the estimated losses happen before the window is modeled.
    applyOfflineCivilianRaid(entry.save.settlement, islandSeconds);
    // The archipelago is validated once at the top level; filed worlds have no nested group.
    const loaded = await stageGameSession(entry.save);
    const rates = estimateOfflineEconomyRates({ ...entry.save, player: clone.player }, loaded.map.world);
    for (const rate of rates.buildings) {
      const observation = observations.get(`${entry.id}:${rate.jobUid}`);
      const job = rates.jobs.find(job => job.uid === rate.jobUid)!;
      const outputWares = Object.keys(job.outputs);
      if (observation) rate.observedWaitSeconds = {
        inputs: observation.inputWaitSeconds, output: observation.outputWaitSeconds
      };
      // A full pair of completions measures work, actual source walking, handling and contention.
      // Sparse/unknown chains retain the conservative geometric fallback; no guessed zero rate.
      const building = entry.save.settlement.buildings.find(building => building.uid === rate.uid)!;
      // A native handcart already owns this yard's output. Its pickup/return interval includes the
      // stock waits that the cartless event path would otherwise subtract and then under-charge.
      const handcartReserved = entry.save.settlement.actors.some(actor =>
        actor.handcart?.trip?.source === rate.uid);
      const handcartGaps = observation?.ticks.slice(1).map((tick, index) =>
        (tick - observation!.ticks[index]!) * .05) ?? [];
      const handcartCycle = handcartGaps.length && handcartGaps.every(gap => gap > 0)
        ? handcartGaps.reduce((sum, gap) => sum + gap, 0) / handcartGaps.length : undefined;
      if (handcartReserved && handcartCycle !== undefined && handcartCycle >= rate.workSeconds) {
        rate.cycleSeconds = handcartCycle;
        rate.reason = `${rate.reason ?? ""}; native handcart receipt interval including stock waits`;
        job.cycleTicks = Math.ceil(rate.cycleSeconds * TPS);
        job.workOverlapsCycle = true;
        continue;
      }
      if (observation && building.status !== "Waiting for inputs" && ![5, 27, 37, 60].includes(building.typeId) &&
        observation.ticks.length >= 2 && outputWares.length === 1 &&
        job.outputs[outputWares[0]!] === 1 && observation.outputs.has(outputWares[0]!)) {
        const measured = extendedCalibratedEconomyCycle(observation.ticks,
          initialTicks.get(entry.id) ?? 0, entry.save.settlement.gameTick ?? 0, rate.workSeconds, {
            atOutputs: observation.waitAtOutputs, atEnd: observation.inputWaitSeconds + observation.outputWaitSeconds,
            atInitialEnd: observation.initialWaitSeconds
          });
        if (measured !== undefined) {
          rate.cycleSeconds = measured;
          rate.reason = `${rate.reason ?? ""}; native cycle excluding separately modeled input/output waits`;
          job.cycleTicks = Math.ceil(rate.cycleSeconds * TPS);
          job.workOverlapsCycle = true;
        }
      }
    }
    const flax = prepareOfflineEconomyFlax(entry.save, loaded.map.world, entry.id);
    const ships = prepareOfflineEconomyFastShips(entry.save, loaded.map.world, islandSeconds, entry.id);
    // Explicit flax plots replace the amortized farm cycle; a paused/unstaffed farm never produces.
    for (const job of rates.jobs) {
      if (!job.uid.startsWith("building:")) continue;
      const building = entry.save.settlement.buildings.find(candidate =>
        `building:${candidate.uid}` === job.uid);
      if (building?.typeId === 60) job.endTick = 0;
    }
    if (ships.handled.length) rates.unsupported = rates.unsupported.filter(row => !ships.handled.includes(row.uid));
    for (const row of ships.unsupported) if (!rates.unsupported.some(entry => entry.uid === row.uid))
      rates.unsupported.push(row);
    const productionJobs = [...rates.jobs, ...flax.jobs, ...ships.jobs];
    const computers = estimateOfflineComputerEconomies(entry.save, loaded.map.world);
    // Every economy's producers draw on the island's one set of finite sources (trees, ore, stone).
    const sources = prepareOfflineEconomySources(entry.save, loaded.map.world,
      [...rates.jobs, ...computerEconomyJobs(computers)], islandSeconds);
    const logistics = prepareOfflineEconomyLogistics(entry.save, entry.id, islandSeconds, loaded.map.world,
      productionJobs, rates.storageUids);
    flax.attachOutputAccounts(logistics.outputAccounts);
    const arrivals = prepareOfflineEconomyArrivals(entry.save, entry.id, islandSeconds);
    const outputs = prepareOfflineEconomyOutputs(entry.save, entry.id, islandSeconds, loaded.map.world, rates.storageUids,
      logistics.coveredOutputUids);
    const deliveries = prepareOfflineEconomyDeliveries(entry.save, entry.id, islandSeconds, loaded.map.world,
      productionJobs, rates.storageUids, logistics.outputAccounts);
    const handcarts = prepareOfflineEconomyHandcartReceipts(entry.save, entry.id, islandSeconds,
      loaded.map.world, productionJobs, rates.storageUids, logistics.outputAccounts);
    const inputs = prepareOfflineEconomyInputs(entry.save, entry.id, productionJobs);
    islands.push({ ...entry, loaded, rates, sources, arrivals, outputs, deliveries, handcarts, inputs, logistics,
      flax, ships, storage: offlineEconomyStorage(entry.save, rates.storageUids), seconds: islandSeconds, start,
      computers: computers.map(economy => ({ economy,
        storage: offlineEconomyStorage(entry.save, economy.rates.storageUids, economy.owner) })) });
    emit(calibrationSeconds * islandCount + Math.min(totalSeconds * .1, islands.length * seconds * .1));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const { economyIslands, jobs } = assembleOfflineEconomy(islands, clone.player);
  // An archived island filed earlier than the island on screen models its own longer window.
  const horizonSeconds = Math.max(seconds, ...islands.map(island => island.seconds));
  const execute = (onCompleted?: Parameters<typeof runOfflineEconomyEvents>[0]["onCompleted"]) => {
    for (const island of islands) island.sources.resetCompleted();
    return runOfflineEconomyEvents({ horizonTicks: Math.floor(horizonSeconds * TPS), jobs,
      // Pickup now releases a shelf separately from arrival. Budget both physical boundaries
      // while retaining a deterministic group ceiling and transactional failure.
      maxEvents: Math.min(3_000_000, 600_000 * islands.length), islands: economyIslands,
      onCompleted: (job, tick, inputs, outputs, startTick) => {
        islands.find(island => island.id === job.islandId)?.sources.onCompleted(job, tick, inputs, outputs, startTick);
        onCompleted?.(job, tick, inputs, outputs, startTick);
      } });
  };
  const treeFellings: { islandId: string; seconds: number; treeId: number }[] = [];
  const harvestCursors = new Map<string, number>();
  // Plan animal habitat from the same economic queue, without repeating exact calibration or
  // mutating a save. A second causal pass admits the resulting finite hunting deliveries.
  const firstPass = execute((job, tick, inputs, _outputs, startTick) => {
    const island = islands.find(island => island.id === job.islandId);
    if (!island) return;
    const rate = island.rates.buildings.find(rate => `${island.id}:${rate.jobUid}` === job.uid);
    if (job.sourceChoices) {
      for (const [token, units] of Object.entries(inputs)) {
        const treeId = island.sources.treeIdsByToken[token];
        if (units > 0 && treeId !== undefined) treeFellings.push({ islandId: island.id, treeId,
          seconds: Math.max(startTick / TPS, tick / TPS - (rate?.workerTravelSeconds ?? 0) / 2) });
      }
      return;
    }
    for (const [key, units] of Object.entries(inputs)) if (key.startsWith("~tree:")) {
      const cursorKey = `${island.id}:${key}`, cursor = harvestCursors.get(cursorKey) ?? 0;
      for (let unit = 0; unit < units; unit++) {
        const treeId = island.sources.treeHarvestOrder[key]?.[cursor + unit];
        if (treeId !== undefined && treeId !== null) treeFellings.push({ islandId: island.id, treeId,
          seconds: Math.max(startTick / TPS, tick / TPS - (rate?.workerTravelSeconds ?? 0) / 2) });
      }
      harvestCursors.set(cursorKey, cursor + units);
    }
  });
  let hasWildlife = false;
  for (const island of islands) {
    if (!island.rates.buildings.some(rate => island.save.settlement.buildings
      .some(building => building.uid === rate.uid && building.typeId === 22))) continue;
    const wildlife = prepareOfflineEconomyWildlife(island.save, island.loaded.map.world, island.seconds,
      { islandId: island.id, treeFellings: treeFellings.filter(event => event.islandId === island.id) });
    if (!wildlife.animals) continue;
    island.wildlife = wildlife; hasWildlife = true;
    const hunters = new Map(island.save.settlement.buildings.filter(building => building.typeId === 22)
      .map(building => [building.uid, island.rates.jobs.find(job => job.uid === `building:${building.uid}`)]));
    for (let index = jobs.length - 1; index >= 0; index--) {
      if (jobs[index]!.islandId === island.id && [...hunters].some(([uid]) => jobs[index]!.uid === `${island.id}:building:${uid}`))
        jobs.splice(index, 1);
    }
    for (let index = 0; index < wildlife.jobs.length; index++) {
      const job = wildlife.jobs[index]!, account = hunters.get(wildlife.hunts[index]!.hunterUid)?.outputAccountId;
      jobs.push({ ...job, ...(account ? { outputAccountId: account } : {}) });
    }
    Object.assign(economyIslands.find(entry => entry.islandId === island.id)!.stock, wildlife.stock);
  }
  const result = hasWildlife ? execute() : firstPass;
  // Temporary input buffers preserve delivery priority, but do not add a new saved owner. Their
  // reserved warehouse slots stay occupied throughout replay, so returning them cannot overfill.
  for (const buffer of result.buffers) {
    const ledger = result.islands.find(island => island.islandId === buffer.islandId)!;
    for (const [ware, count] of Object.entries(buffer.stock)) add(ledger.stock, ware, count);
  }
  // Fast delivery/cart completion can move a carrier out of the stock-court phase saved in the
  // source. Capture the starting phases before applying receipts so stale court entries are pruned.
  const initialActorPhases = new Map(islands.map(island => [island.id,
    new Map(island.save.settlement.actors.map(actor => [actor.uid, actor.phase]))]));
  // Cancel only NEW unfinished work. Original saved work/cargo has never entered this ledger.
  const privateRefunds = offlinePrivateRefunds(result, jobs, islands);
  for (let index = 0; index < islands.length; index++) {
    islands[index]!.inputs.apply(result.buffers);
    for (const [key, refund] of privateRefunds) {
      if (!key.startsWith(`${islands[index]!.id}:`)) continue;
      for (const [ware, count] of Object.entries(refund.goods)) add(refund.building.input, ware, count);
    }
    islands[index]!.flax.apply(result, Math.floor(islands[index]!.seconds * TPS));
    islands[index]!.ships.apply(result, Math.floor(islands[index]!.seconds * TPS));
    islands[index]!.arrivals.apply(result.completedCycles, result.islands[index]!);
    islands[index]!.outputs.apply(result.completedCycles, result.islands[index]!);
    islands[index]!.logistics.apply(result);
    islands[index]!.deliveries.apply(result.completedCycles, result.islands[index]!, result.buffers);
    islands[index]!.handcarts.apply(result.completedCycles, result.islands[index]!, result.buffers);
  }
  let player = clone.player ?? createPlayerProgress(islands[0]!.loaded.map.world.seed);
  const homeIsland = islands.find(island => island.id === "home");
  // The home island's material tier cap filters the quest pool as online (MAP BUILDING AVAILABILITY).
  const homeRules = homeIsland && (homeIsland.save.settlement.homeBuildingRules ??
    homeIsland.loaded.map.world.scenario?.availability);
  player = refreshQuests(player, questDayKey(now), TOOL_WARES, source.settlement.playerNation, {
    reliefAvailable: islands.some(island => island.save.settlement.buildings.some(building =>
      building.typeId === 39 && building.construction === 1 && isOwnBuilding(building))),
    ...(homeRules?.tier === undefined ? {} : { tierCap: homeRules.tier })
  });
  const homeShips = islands.find(island => island.id === "home")?.ships.built() ?? 0;
  if (homeShips && player.questBook)
    player = { ...player, questBook: recordHomeQuestEvent(player.questBook, "ship", homeShips) };
  for (let index = 0; index < islands.length; index++) {
    const island = islands[index]!, ledger = result.islands[index]!;
    commitIslandLedger(island, ledger, result.completedCycles, player);
    for (const [ware, count] of Object.entries(physical(ledger.produced))) {
      // The normal boat path deposits directly and has no onProduced bookkeeping callback.
      if (ware === "boat") continue;
      player = recordProduction(player, ware, count);
      if (island.id === "home" && player.questBook) {
        player = { ...player, questBook: recordHomeQuestEvent(player.questBook, `produce:${ware}`, count) };
        if ((TOOL_WARES as ReadonlySet<string>).has(ware))
          player = { ...player, questBook: recordHomeQuestEvent(player.questBook!, "tools", count) };
      }
    }
    pruneStaleStockTraffic(island.save, initialActorPhases.get(island.id)!);
    const { map } = island.loaded;
    advanceOfflineTradeCalendar({ ...island.save, player }, map.world, now);
    const encoded = await createGameSave(map.world, island.save.settlement, { ...map.meta,
      animals: map.animals, terrain: map.terrain, savedAt: now }, island.save.runtime);
    Object.assign(island.save, encoded);
    emit(calibrationSeconds * islandCount + totalSeconds * (.8 + .2 * (index + 1) / islands.length));
  }
  /** Where a colony's modeled window ended: its own save time plus its capped catch-up. */
  const modeledUntil = (expeditionId: number) => {
    const island = islands.find(entry => entry.id === String(expeditionId));
    const start = island?.start ?? source.savedAt;
    return start + islandCatchUpSeconds(start, now, OFFLINE_CATCH_UP_CAP_SECONDS - calibrationSeconds) * 1000;
  };
  if (group) {
    // Missed resource ship deadlines have been serviced by the event ledger; do not replay them again.
    for (const colony of group.colonies) if (colony.nextOreShipAt !== undefined)
      colony.nextOreShipAt = Math.max(colony.nextOreShipAt, modeledUntil(colony.expeditionId) +
        colonyOreShipMs(talentModifiers(clone.player?.talents).colonyShipIntervalReduction));
  }
  const capped = group && away > seconds ? deferOreShips(group, Math.round((away - seconds) * 1000)) : group;
  const expired = capped ? expireColonies(capped, clone, active, now) : { current: clone, group: capped };
  const productionMetrics = offlineProductionMetrics(result, islands);
  options.onEconomyMetrics?.({ mode: "economy", gameSeconds: totalProductionSeconds, calibrationSeconds, islands: islands.length,
    modeledSeconds: seconds, productionScope: "event-remainder",
    events: result.events, wallMs: performance.now() - started,
    production: productionMetrics,
    estimates: islands.map(island => ({ islandId: island.id, rates: island.rates })), treeFellings,
    buildingProduction: islands.flatMap(island => island.rates.jobs.map(job => {
      const building = island.save.settlement.buildings.find(building => job.uid === `building:${building.uid}`)!;
      return { islandId: island.id, uid: building.uid, typeId: building.typeId,
        produced: completedEconomyJobOutput(job, result.completedCycles[`${island.id}:${job.uid}`] ?? 0) };
    })),
    approximations: [...ECONOMY_APPROXIMATIONS,
      ...islands.flatMap(island => [...island.sources.notes, ...island.arrivals.notes, ...island.outputs.notes,
        ...island.deliveries.notes, ...island.handcarts.notes, ...island.inputs.notes, ...island.logistics.notes,
        ...island.flax.notes, ...island.ships.notes,
        ...island.wildlife?.notes ?? []].map(note => `${island.id}: ${note}`))] });
  emit(episodeTotal);
  return { ...expired.current, archipelago: expired.group, player: applyReturnedColonyRelief(player, "returnedRelief" in expired ? expired.returnedRelief : []) };
};
