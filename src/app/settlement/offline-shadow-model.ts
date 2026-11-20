import { HUNTER_FISHER_TYPES, type TalentModifiers } from "@shared/catalog/balance";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { CARRIER_WALK_SPEED, WARE_TRANSFER_SECONDS, WORKER_REST_SECONDS } from "../../shared/balance/economy";
import { OFFLINE_CATCH_UP_CAP_SECONDS } from "../../shared/balance/offline";
import { talentModifiers } from "../../shared/progression/talents";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { addGood, getBuildingProductionRule, STORAGE_IDS } from "../../shared/settlement/production-rules";
import { effectiveProductionSeconds } from "../../shared/settlement/production-timing";
import { createRoadNetwork } from "../../shared/settlement/road-network";
import { type RoadRouteMetrics, snapRoadPoint } from "../../shared/settlement/road-types";
import { isBoatFishing } from "../../shared/settlement/settlement-fisher-boat-mode";
import { isHomeBuilding, isOwnBuilding } from "../../shared/settlement/settlement-home";
import { ownerOf } from "../../shared/settlement/settlement-ownership";
import { isMineType } from "../../shared/settlement/settlement-placement";
import type {
  Goods, ProductionRule, SettlementActor, SettlementBuilding, SettlementContext
} from "../../shared/settlement/settlement-types";
import { isSharedStorageWare, reconcileStorageAccess } from "../../shared/settlement/shared-storage";
import { islandStorageCapacity } from "../../shared/settlement/storage-capacity";
import { workshopCycleFactor } from "../../shared/settlement/workshop-upgrades";
import type { WorldData } from "../../shared/world/world-data";

/** Shadow model cap: the same 24 h offline production window the live catch-up uses. */
const MAX_MODEL_SECONDS = OFFLINE_CATCH_UP_CAP_SECONDS;
/** Building types whose cycle depends on animal state, not just ware stocks. */
const ANIMAL_BUILDINGS = new Set([3, 21, 28, 38]);
/** Field / plantation cycles depend on plot state and crop growth, not only ware stocks. */
const FIELD_BUILDINGS = new Set([5, 27, 37, 60]);
const ARMORY_TYPE_ID = 24;
const SAWMILL_TYPE_ID = 33;
const MAX_ALLOCATION_PASSES = 256;

export interface OfflineShadowOptions {
  /**
   * Items one carrier takes in one trip. Omitted: the best saved hand-cart manifest capacity, or 1
   * when the save has no hand-cart manifest.
   */
  carrierCapacity?: number;
  /**
   * Carriers assumed to serve one building at once. Omitted: saved carriers divided by completed
   * non-storage buildings, at least one.
   */
  carrierConcurrency?: number;
  /**
   * Treat input-free outdoor producers (woodcutter, fisher, quarry and specialist variants) as
   * working an endless raw source. Default true: the experiment explicitly assumes that supply.
   */
  includeEndlessRawProducers?: boolean;
  /** Hard cap; never above the live 24 h offline cap. Defaults to that cap. */
  maxSeconds?: number;
  /** Player nation for production rules; defaults to the save's nation. */
  nation?: WorkerNation;
  /** Talent modifiers; defaults to the save player's applied talents (neutral when absent). */
  talents?: Readonly<TalentModifiers>;
  /** One stock hand-off animation in authored seconds; defaults to the live `WARE_TRANSFER_SECONDS`. */
  workerHandlingSeconds?: number;
  /** Worker rest between cycles in authored seconds; defaults to the live `WORKER_REST_SECONDS`. */
  workerRestSeconds?: number;
  /** Static occupancy revision for route-cache keys; the shadow never changes occupancy. */
  occupancyRevision?: number;
}

export interface ShadowRouteCost {
  /** Completed storage the route ends at. */
  storageUid: number;
  /** Free-flow route length in cells. */
  distance: number;
  /** Road-tier weighted cost (seconds at walk speed 1). */
  weightedCost: number;
  /** One-way carrier seconds at the saved road tiers. */
  oneWaySeconds: number;
  /** Storage -> building -> storage at free-flow speed; no traffic or collision delays. */
  roundTripSeconds: number;
  /** Static cache key (endpoints plus road/occupancy/terrain/build revisions). */
  cacheKey: string;
}

export interface ShadowBuildingEstimate {
  uid: number;
  typeId: number;
  /** `supported`: cycles modeled; `unsupported`: recipe/building not modeled; `skipped`: no cycle. */
  status: "supported" | "unsupported" | "skipped";
  reason?: string;
  outputWare?: string;
  inputsPerCycle: Goods;
  outputsPerCycle: Goods;
  /** Real seconds of in-place work per cycle (level/tier/production speed applied). */
  workSeconds: number;
  /** In-place rest and ware hand-offs at the building. */
  workerOverheadSeconds: number;
  /** Carrier movement per cycle, from the route's road-tier cost. */
  logisticsSeconds: number;
  /** Steady-state bottleneck: in-place work versus carrier movement. */
  cycleSeconds: number;
  /** One storage -> building -> storage trip at free-flow speed. */
  carrierRoundTripSeconds: number;
  carrierTripsPerCycle: number;
  /** Saved hand-cart capacity or the single-item fallback used for this estimate. */
  carrierCapacity: number;
  /** Carriers assumed to overlap this building's logistics. */
  carrierConcurrency: number;
  /** Current saved worker-cycle progress credited before the first predicted cycle. */
  workerProgressSeconds: number;
  /** Seconds until the first predicted cycle; steady-state cycles follow at `cycleSeconds`. */
  firstCycleSeconds: number;
  route?: ShadowRouteCost;
  /** Cycles the window allows if inputs and storage room were unlimited. */
  timeCycles: number;
  /** Cycles actually predicted and applied to the clone. */
  cycles: number;
  /** Remaining potential cycles the model could not allocate (input/room limited). */
  unfulfilledCycles: number;
  limitedBy: "time" | "input" | "storage" | "none";
  consumed: Goods;
  produced: Goods;
  /** The clone's building.cycle before and after the prediction. */
  cyclesBefore: number;
  cyclesAfter: number;
}

export interface OfflineShadowReport {
  assumptions: {
    traffic: "ignored";
    collisions: "ignored";
    deposits: "unchanged";
    animalRespawn: "unchanged";
    rawSupply: "endless";
    buildingScope: "completed-buildings-only";
    actors: "not-moved";
    unmodeledFields: "copied-unchanged";
  };
  flags: {
    noTraffic: true;
    noCollisions: true;
    noDepositDepletion: true;
    noAnimalRespawn: true;
    unlimitedRawSupply: boolean;
    actorsMoved: false;
    depositsSpent: false;
    animalsChanged: false;
    unsupportedFieldsPreserved: true;
  };
  requestedSeconds: number;
  modeledSeconds: number;
  cappedAt24h: boolean;
  startSavedAt: number;
  endSavedAt: number;
  buildings: ShadowBuildingEstimate[];
  unsupported: Array<{ uid: number; typeId: number; reason: string }>;
  skipped: Array<{ uid: number; typeId: number; reason: string }>;
  goodsDelta: Goods;
  predictedGoods: Goods;
  /** Read-only saved carrier/fleet facts; actors are still not moved. */
  carriers: {
    actors: number;
    capacity: number;
    capacitySource: "default" | "option" | "saved";
    concurrency: number;
    concurrencySource: "default" | "option";
    handcarts: number;
  };
  /** In-flight actor and hand-cart cargo, reported but not moved or delivered. */
  inFlight: {
    actors: number;
    goods: Goods;
    handcartCargo: Goods;
  };
  /** Buildings plus unchanged in-flight cargo; compares with the exact snapshot's holdings. */
  totalGoods: Goods;
  totalGoodsDelta: Goods;
  totals: {
    buildings: number;
    completed: number;
    supported: number;
    unsupported: number;
    skipped: number;
    cycles: number;
    allocationPasses: number;
    passLimitReached: boolean;
  };
  routes: {
    cache: { calls: number; hits: number; misses: number; entries: number };
    roadCache: { calls: number; hits: number; misses: number };
    revisions: { road: number; occupancy: number; terrain: number; build: number };
  };
  storage: { capacity: number; stored: Goods; reserved: Goods };
  notes: string[];
  exactComparison: { status: "not-run"; by: "shadow-model" };
}

export interface OfflineShadowResult {
  /** Deep clone of the source save; only predicted goods fields and `savedAt` differ. */
  save: GameSaveV1;
  report: OfflineShadowReport;
}

const finitePositive = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;

const addCounts = (target: Goods, source: Readonly<Goods>) => {
  for (const [ware, count] of Object.entries(source)) if (count) target[ware] = (target[ware] ?? 0) + count;
};

const goodsTotal = (buildings: readonly SettlementBuilding[],
  pools?: GameSaveV1["settlement"]["storagePools"]) => {
  const total: Goods = {};
  for (const building of buildings) {
    // Shared ordinary wares live once in the landmass pool; local depot inventory is equipment.
    for (const [ware, count] of Object.entries(building.inventory))
      if (!pools || !isSharedStorageWare(ware)) addCounts(total, { [ware]: count });
    addCounts(total, building.input);
    addCounts(total, building.output);
  }
  for (const pool of pools?.pools ?? []) addCounts(total, pool.available);
  return total;
};

const difference = (after: Readonly<Goods>, before: Readonly<Goods>) => {
  const delta: Goods = {};
  for (const ware of new Set([...Object.keys(after), ...Object.keys(before)])) {
    const value = (after[ware] ?? 0) - (before[ware] ?? 0);
    if (value) delta[ware] = value;
  }
  return delta;
};

/** Actor-held goods, mirroring the island ledger: a load, or inputs paid into a product in progress. */
const actorGoodsTotal = (actors: readonly SettlementActor[]) => {
  const total: Goods = {};
  for (const actor of actors) {
    if (actor.ware) addCounts(total, { [actor.ware]: actor.wareUnits ?? 1 });
    else if (actor.productionOutput) addCounts(total, actor.consumed ?? {});
  }
  return total;
};

const handcartCargo = (actors: readonly SettlementActor[]) => {
  const total: Goods = {};
  for (const actor of actors) {
    const trip = actor.handcart?.trip;
    if (!trip?.ware || !actor.handcart?.cargo) continue;
    addCounts(total, { [trip.ware]: actor.handcart.cargo });
  }
  return total;
};

/** Saved fleet facts; these are read-only and never move an actor. */
const carrierFacts = (
  actors: readonly SettlementActor[], buildings: readonly SettlementBuilding[], capacityOption?: number,
  concurrencyOption?: number
) => {
  const carriers = actors.filter(actor => actor.job === "Carrier");
  const savedCapacity = Math.max(1, ...carriers.map(actor =>
    actor.workerMovementPlan?.manifest?.capacity ?? actor.handcart?.trip?.capacity ?? 1));
  const workingBuildings = buildings.filter(building => building.construction === 1 &&
    !STORAGE_IDS.has(building.typeId)).length;
  const savedConcurrency = Math.max(1, Math.floor(carriers.length / Math.max(1, workingBuildings)));
  const capacity = finitePositive(capacityOption, savedCapacity);
  const concurrency = finitePositive(concurrencyOption, savedConcurrency);
  let capacitySource: "default" | "option" | "saved" = "default";
  if (capacityOption !== undefined) capacitySource = "option";
  else if (savedCapacity > 1) capacitySource = "saved";
  return {
    actors: carriers.length,
    capacity,
    capacitySource,
    concurrency,
    concurrencySource: concurrencyOption !== undefined ? "option" as const : "default" as const,
    handcarts: buildings.reduce((sum, building) => sum + (building.handcarts ?? 0), 0) +
      carriers.filter(actor => actor.handcart).length
  };
};

/**
 * How much of the worker's current in-place cycle is already done. The simulation stores
 * `productionSeconds` as the full work time and `timer` as the remaining time; well/pig progress
 * is mirrored in `building.workTime`. This is a read-only estimate, not a tick.
 */
const workerProgressSeconds = (building: SettlementBuilding, actors: readonly SettlementActor[], workSeconds: number) => {
  const actor = actors.find(candidate => candidate.uid === building.worker);
  if (!actor) return 0;
  if (actor.phase === "work" && actor.productionSeconds !== undefined &&
    Number.isFinite(actor.productionSeconds) && actor.productionSeconds > 0 &&
    Number.isFinite(actor.timer) && actor.timer >= 0) {
    const share = Math.max(0, Math.min(1, 1 - actor.timer / actor.productionSeconds));
    return share * workSeconds;
  }
  if (actor.phase === "work" && building.workTime !== undefined && Number.isFinite(building.workTime))
    return Math.max(0, Math.min(workSeconds, building.workTime));
  return 0;
};

/**
 * Static route-cost memo. The road network already memoizes A* searches under the road,
 * occupancy, terrain and build revisions; this smaller table makes the shadow model's endpoint
 * lookup and diagnostics explicit. Only static route metrics are cached; cycle durations and
 * per-building estimates are always recomputed from the supplied state.
 */
const createRouteTable = (world: WorldData, roads: ReturnType<typeof createRoadNetwork>, occupancy: number) => {
  const cache = new Map<string, { metrics: RoadRouteMetrics; key: string }>();
  const stats = { calls: 0, hits: 0, misses: 0 };
  const revisions = () => `road=${roads.revision};occ=${occupancy};terrain=${world.terrainRevision ?? 0};build=${world.buildRevision ?? 0}`;
  const metrics = (from: { x: number; z: number }, to: { x: number; z: number }) => {
    stats.calls++;
    const start = snapRoadPoint(from), end = snapRoadPoint(to);
    const key = `${revisions()}|${start.x},${start.z}>${end.x},${end.z}`;
    const stored = cache.get(key);
    if (stored) { stats.hits++; return stored; }
    stats.misses++;
    const entry = { metrics: roads.routeMetrics(start, end), key };
    cache.set(key, entry);
    return entry;
  };
  return { metrics, stats: () => ({ ...stats, entries: cache.size }) };
};

const routeCost = (
  storage: SettlementBuilding, entry: { metrics: RoadRouteMetrics; key: string }, carrierSpeed: number
): ShadowRouteCost | undefined => {
  const route = entry.metrics.route;
  if (!route) return undefined;
  const oneWaySeconds = route.cost / carrierSpeed;
  return {
    storageUid: storage.uid,
    distance: route.length,
    weightedCost: route.cost,
    oneWaySeconds,
    roundTripSeconds: oneWaySeconds * 2,
    cacheKey: entry.key
  };
};

/** What one cycle takes; miners may eat any one of their foods, not all of them. */
const cycleInputs = (building: SettlementBuilding, rule: ProductionRule, reachable: readonly SettlementBuilding[]) => {
  const counts: Goods = {};
  if (rule.alternativeFood) {
    const ware = rule.inputs.find(candidate => (building.input[candidate] ?? 0) + reachable.reduce(
      (sum, storage) => sum + (storage.inventory[candidate] ?? 0), 0) > 0) ?? rule.inputs[0];
    if (ware) counts[ware] = 1;
    return counts;
  }
  for (const ware of rule.inputs) counts[ware] = (counts[ware] ?? 0) + 1;
  return counts;
};

const inputCycles = (building: SettlementBuilding, inputs: Goods, reachable: readonly SettlementBuilding[]) => {
  let cycles = Infinity;
  for (const [ware, need] of Object.entries(inputs)) {
    if (need <= 0) continue;
    const available = (building.input[ware] ?? 0) + reachable.reduce(
      (sum, storage) => sum + (storage.inventory[ware] ?? 0), 0);
    cycles = Math.min(cycles, Math.floor(available / need));
  }
  return cycles;
};

const outputCycles = (
  outputs: Goods, capacity: number, stored: Goods, reserved: Goods, destinations: readonly SettlementBuilding[]
) => {
  let cycles = Infinity;
  for (const [ware, amount] of Object.entries(outputs)) {
    if (amount <= 0) continue;
    if (!destinations.some(storage => storage.accepts[ware] !== false)) return 0;
    const room = Math.max(0, capacity - (stored[ware] ?? 0) - (reserved[ware] ?? 0));
    cycles = Math.min(cycles, Math.floor(room / amount));
  }
  return cycles;
};

const productionTalentBonus = (building: SettlementBuilding, talents: Readonly<TalentModifiers>, colony: boolean) =>
  talents.productionSpeed + (colony ? talents.colonyProductionSpeed : 0) +
  (HUNTER_FISHER_TYPES.includes(building.typeId) ? talents.hunterFisherSpeed : 0);

type Candidate = {
  building: SettlementBuilding;
  rule: ProductionRule;
  outputWare: string;
  estimate: ShadowBuildingEstimate;
  reachable: Array<{ storage: SettlementBuilding; entry: { metrics: RoadRouteMetrics; key: string } }>;
};

const classify = (
  buildings: readonly SettlementBuilding[],
  storages: readonly SettlementBuilding[],
  actors: readonly SettlementActor[],
  options: Required<Pick<OfflineShadowOptions, "includeEndlessRawProducers" | "carrierCapacity" |
    "carrierConcurrency">> & {
    nation: WorkerNation; talents: Readonly<TalentModifiers>; workerHandlingSeconds: number;
    workerRestSeconds: number; windowSeconds: number; carrierSpeed: number;
  },
  routes: ReturnType<typeof createRouteTable>
) => {
  const candidates: Candidate[] = [];
  const unsupported: OfflineShadowReport["unsupported"] = [];
  const skipped: OfflineShadowReport["skipped"] = [];
  const colony = buildings.some(building => building.typeId === 39 && isHomeBuilding(building));
  for (const building of buildings) {
    if (building.construction < 1) { skipped.push({ uid: building.uid, typeId: building.typeId, reason: "under-construction" }); continue; }
    if (ownerOf(building) > 0) { skipped.push({ uid: building.uid, typeId: building.typeId, reason: "not-player-owned" }); continue; }
    if (STORAGE_IDS.has(building.typeId)) continue;
    const rule = getBuildingProductionRule(building, options.nation);
    const unsupportedReason = (() => {
      if (!rule) return "no production rule";
      if (rule.service) return "service building (no ware cycle)";
      if (building.typeId === ARMORY_TYPE_ID) return "armory production orders";
      if (building.typeId === SAWMILL_TYPE_ID && building.handcartMode) return "hand-cart production mode";
      if (isBoatFishing(building)) return "boat fishing trips";
      if (!rule.outputs.length) return "no ware output";
      if (ANIMAL_BUILDINGS.has(building.typeId) || rule.animal) return "animal state not modeled";
      if (isMineType(building.typeId)) return "deposit-dependent mine";
      if (FIELD_BUILDINGS.has(building.typeId) || rule.outdoor === "field") return "field/plantation cycle";
      if (rule.outdoor === "wildlife") return "wildlife state not modeled";
      if (rule.outdoor === "plant") return "planting has no ware output";
      if (["tree", "fish", "stone"].includes(rule.outdoor ?? "") && !options.includeEndlessRawProducers)
        return "raw resource producer disabled";
      if (rule.outputs.length > 1 && !building.selectedOutput) return "mixed output not modeled";
      if (building.selectedOutput && !rule.outputs.includes(building.selectedOutput))
        return "saved output is not in the rule";
      return undefined;
    })();
    if (unsupportedReason) { unsupported.push({ uid: building.uid, typeId: building.typeId, reason: unsupportedReason }); continue; }
    if (building.productionPaused) { skipped.push({ uid: building.uid, typeId: building.typeId, reason: "production-paused" }); continue; }
    if (building.worker === undefined) { skipped.push({ uid: building.uid, typeId: building.typeId, reason: "unstaffed" }); continue; }
    const outputWare = building.selectedOutput ?? rule!.outputs[0]!;
    const reachable = storages.map(storage => ({
      storage, entry: routes.metrics(building.access, storage.access)
    })).filter(entry => entry.entry.metrics.route).sort((a, b) =>
      a.entry.metrics.route!.length - b.entry.metrics.route!.length ||
      a.entry.metrics.route!.cost - b.entry.metrics.route!.cost ||
      a.storage.uid - b.storage.uid);
    if (!reachable.length) {
      unsupported.push({ uid: building.uid, typeId: building.typeId, reason: "no road-connected completed storage" });
      continue;
    }
    const nearest = reachable[0]!;
    const route = routeCost(nearest.storage, nearest.entry, options.carrierSpeed);
    const inputs = cycleInputs(building, rule!, reachable.map(entry => entry.storage));
    const outputs: Goods = { [outputWare]: 1 };
    const cycleFactor = Math.max(1e-9,
      workshopCycleFactor(building, productionTalentBonus(building, options.talents, colony)));
    const workSeconds = effectiveProductionSeconds(rule!.seconds, building.typeId, outputWare) / cycleFactor;
    const inputUnits = Object.values(inputs).reduce((sum, count) => sum + count, 0);
    const outputUnits = Object.values(outputs).reduce((sum, count) => sum + count, 0);
    // Rest and stock hand-offs are in-place phases, so the same production-time and worker-cycle
    // scales apply. The constants come from the live balance module and remain configurable.
    const workerOverheadSeconds = (
      effectiveProductionSeconds(options.workerRestSeconds, building.typeId, outputWare) +
      effectiveProductionSeconds(options.workerHandlingSeconds * (inputUnits + outputUnits),
        building.typeId, outputWare)
    ) / cycleFactor;
    const carrierTripsPerCycle = Math.max(1,
      Math.ceil(inputUnits / options.carrierCapacity), Math.ceil(outputUnits / options.carrierCapacity));
    const carrierRoundTripSeconds = route?.roundTripSeconds ?? 0;
    const logisticsSeconds = carrierRoundTripSeconds * carrierTripsPerCycle /
      Math.max(1, options.carrierConcurrency);
    // In steady state the worker and the carriers overlap: the slower pipeline sets the tempo.
    const cycleSeconds = Math.max(workSeconds + workerOverheadSeconds, logisticsSeconds);
    const progressSeconds = Math.min(cycleSeconds, workerProgressSeconds(building, actors, workSeconds));
    const firstCycleSeconds = Math.max(0, cycleSeconds - progressSeconds);
    let timeCycles = 0;
    if (cycleSeconds > 0 && options.windowSeconds >= firstCycleSeconds) {
      timeCycles = firstCycleSeconds <= 0
        ? Math.floor(options.windowSeconds / cycleSeconds)
        : 1 + Math.floor((options.windowSeconds - firstCycleSeconds) / cycleSeconds);
    }
    const estimate: ShadowBuildingEstimate = {
      uid: building.uid, typeId: building.typeId, status: "supported",
      outputWare, inputsPerCycle: inputs, outputsPerCycle: outputs, workSeconds, workerOverheadSeconds,
      logisticsSeconds, cycleSeconds, carrierRoundTripSeconds, carrierTripsPerCycle,
      carrierCapacity: options.carrierCapacity, carrierConcurrency: options.carrierConcurrency,
      workerProgressSeconds: progressSeconds, firstCycleSeconds, route, timeCycles, cycles: 0,
      unfulfilledCycles: timeCycles, limitedBy: timeCycles > 0 ? "none" : "time", consumed: {},
      produced: {}, cyclesBefore: building.cycle, cyclesAfter: building.cycle
    };
    candidates.push({ building, rule: rule!, outputWare, estimate, reachable });
  }
  return { candidates, unsupported, skipped };
};

const consumeInputs = (
  building: SettlementBuilding, reachable: Candidate["reachable"], inputs: Goods, cycles: number,
  stored: Goods, estimate: ShadowBuildingEstimate
) => {
  // The building's small input stock is consumed before carriers fetch from storage.
  for (const [ware, need] of Object.entries(inputs)) {
    let remainingNeed = cycles * need;
    const own = Math.min(building.input[ware] ?? 0, remainingNeed);
    if (own) { addGood(building.input, ware, -own); remainingNeed -= own; }
    if (remainingNeed > 0) for (const { storage: source } of reachable) {
      if (remainingNeed <= 0) break;
      const take = Math.min(source.inventory[ware] ?? 0, remainingNeed);
      if (!take) continue;
      addGood(source.inventory, ware, -take);
      stored[ware] = Math.max(0, (stored[ware] ?? 0) - take);
      remainingNeed -= take;
    }
    if (remainingNeed > 0) throw new Error("Shadow model: input stock vanished during allocation");
    estimate.consumed[ware] = (estimate.consumed[ware] ?? 0) + cycles * need;
  }
};

const depositOutputs = (
  reachable: Candidate["reachable"], outputWare: string, cycles: number, stored: Goods,
  estimate: ShadowBuildingEstimate
) => {
  const destination = reachable.find(entry => entry.storage.accepts[outputWare] !== false)?.storage;
  if (!destination) throw new Error("Shadow model: no storage accepts a predicted output");
  const produced = cycles;
  addGood(destination.inventory, outputWare, produced);
  stored[outputWare] = (stored[outputWare] ?? 0) + produced;
  estimate.produced[outputWare] = (estimate.produced[outputWare] ?? 0) + produced;
};

/** Deterministic bounded passes: raw producers first seen in building order feed later consumers. */
const allocateCycles = (
  candidates: readonly Candidate[], capacity: number, stored: Goods, reserved: Goods
) => {
  const remaining = new Map(candidates.map(candidate => [candidate.building.uid, candidate.estimate.timeCycles]));
  const maxPasses = Math.min(MAX_ALLOCATION_PASSES, Math.max(8, candidates.length * 4 + 4));
  let allocationPasses = 0, progressed = true;
  while (progressed && allocationPasses < maxPasses) {
    progressed = false;
    allocationPasses++;
    for (const candidate of candidates) {
      const { building, estimate, outputWare, reachable } = candidate;
      const left = remaining.get(building.uid) ?? 0;
      if (left <= 0) continue;
      const destinations = reachable.map(entry => entry.storage);
      const inputs = cycleInputs(building, candidate.rule, destinations);
      const byInput = inputCycles(building, inputs, destinations);
      const byStorage = outputCycles({ [outputWare]: 1 }, capacity, stored, reserved, destinations);
      const cycles = Math.min(left, byInput, byStorage);
      if (cycles <= 0) {
        if (byInput <= 0) estimate.limitedBy = "input";
        else if (byStorage <= 0) estimate.limitedBy = "storage";
        else estimate.limitedBy = "time";
        continue;
      }
      progressed = true;
      consumeInputs(building, reachable, inputs, cycles, stored, estimate);
      depositOutputs(reachable, outputWare, cycles, stored, estimate);
      building.cycle += cycles;
      const next = left - cycles;
      remaining.set(building.uid, next);
      estimate.cycles += cycles;
      estimate.cyclesAfter = building.cycle;
      estimate.unfulfilledCycles = next;
      if (cycles === left) estimate.limitedBy = "time";
      else if (byInput <= byStorage) estimate.limitedBy = "input";
      else estimate.limitedBy = "storage";
    }
  }
  for (const candidate of candidates) {
    const next = remaining.get(candidate.building.uid) ?? 0;
    candidate.estimate.unfulfilledCycles = next;
    if (candidate.estimate.cycles === 0 && next > 0 && candidate.estimate.limitedBy === "none")
      candidate.estimate.limitedBy = "input";
  }
  return {
    allocationPasses, remaining,
    passLimitReached: progressed && allocationPasses === maxPasses &&
      [...remaining.values()].some(value => value > 0)
  };
};

/**
 * Shadow offline model: predicts a save's goods after `seconds` of completed-building production.
 *
 * It never touches the live simulation. The source save and world are read only; the result's save
 * is a deep clone whose only predicted fields are `savedAt`, `building.cycle`, `building.input`,
 * `building.output` and completed storage `building.inventory`. Actors, deposits, animals, fields,
 * fog, camera, player and archipelago state are copied unchanged.
 *
 * Simplifying assumptions (reported in `report.assumptions`): no traffic or collisions, endless raw
 * supply for input-free outdoor producers, no deposit depletion, no animal respawn/state, and no
 * construction. Cycle timings use the saved recipe, level, road tiers, nearest road-connected
 * storage and stock levels; chain timing is aggregated over the window rather than scheduled.
 */
export const predictOfflineShadow = (
  source: GameSaveV1,
  world: WorldData,
  seconds: number,
  options: OfflineShadowOptions = {}
): OfflineShadowResult => {
  const cap = Math.min(MAX_MODEL_SECONDS, finitePositive(options.maxSeconds, MAX_MODEL_SECONDS));
  const requestedSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const windowSeconds = Math.min(requestedSeconds, cap);
  const predicted = structuredClone(source);
  const settlement = predicted.settlement;
  const buildings = settlement.buildings;
  const actors = settlement.actors;
  const carriers = carrierFacts(actors, buildings, options.carrierCapacity, options.carrierConcurrency);
  const inFlightGoods = actorGoodsTotal(actors);
  const inFlightActors = actors.filter(actor => Boolean(actor.ware) ||
    Boolean(actor.productionOutput && Object.keys(actor.consumed ?? {}).length)).length;
  // Shared storage is authoritative only through its landmass pool. Attach the runtime views to
  // the clone so input/output/stock operations see one balance, never one copy per depot.
  reconcileStorageAccess({
    options: { world }, buildings: settlement.buildings, storagePools: settlement.storagePools
  } as SettlementContext);
  const storages = buildings.filter(building => building.construction === 1 &&
    isOwnBuilding(building) && STORAGE_IDS.has(building.typeId));
  const nation = options.nation ?? settlement.playerNation ?? "roman";
  const talents = options.talents ?? talentModifiers(source.player?.talents);
  const storage = islandStorageCapacity(buildings, talents.storageCapacity);
  const stored: Goods = { ...storage.stored };
  const reserved: Goods = { ...storage.reserved };
  const carrierSpeed = CARRIER_WALK_SPEED * (1 + talents.carrierSpeed);
  const occupancy = options.occupancyRevision ?? 0;
  const roads = createRoadNetwork(world, { occupancyRevision: () => occupancy });
  if (!roads.replaceSegments(settlement.roads)) throw new Error("Shadow model: invalid saved road network");
  const routeTable = createRouteTable(world, roads, occupancy);
  const beforeGoods = goodsTotal(predicted.settlement.buildings, predicted.settlement.storagePools);
  const beforeTotal = { ...beforeGoods };
  addCounts(beforeTotal, inFlightGoods);
  const classified = classify(buildings, storages, actors, {
    includeEndlessRawProducers: options.includeEndlessRawProducers !== false,
    carrierCapacity: carriers.capacity, carrierConcurrency: carriers.concurrency, nation, talents,
    workerHandlingSeconds: finitePositive(options.workerHandlingSeconds, WARE_TRANSFER_SECONDS),
    workerRestSeconds: options.workerRestSeconds !== undefined && Number.isFinite(options.workerRestSeconds) &&
      options.workerRestSeconds >= 0 ? options.workerRestSeconds : WORKER_REST_SECONDS,
    windowSeconds, carrierSpeed
  }, routeTable);
  const { candidates, skipped, unsupported } = classified;
  const { allocationPasses, passLimitReached } = allocateCycles(candidates, storage.capacity, stored, reserved);
  const endSavedAt = source.savedAt + windowSeconds * 1000;
  predicted.savedAt = endSavedAt;
  const predictedGoods = goodsTotal(predicted.settlement.buildings, predicted.settlement.storagePools);
  const totalGoods = { ...predictedGoods };
  addCounts(totalGoods, inFlightGoods);
  const routeStats = routeTable.stats();
  const roadStats = roads.routeStats();
  const cycles = candidates.reduce((sum, candidate) => sum + candidate.estimate.cycles, 0);
  const report: OfflineShadowReport = {
    assumptions: {
      traffic: "ignored", collisions: "ignored", deposits: "unchanged", animalRespawn: "unchanged",
      rawSupply: "endless", buildingScope: "completed-buildings-only", actors: "not-moved",
      unmodeledFields: "copied-unchanged"
    },
    flags: {
      noTraffic: true, noCollisions: true, noDepositDepletion: true, noAnimalRespawn: true,
      unlimitedRawSupply: options.includeEndlessRawProducers !== false, actorsMoved: false,
      depositsSpent: false, animalsChanged: false, unsupportedFieldsPreserved: true
    },
    requestedSeconds, modeledSeconds: windowSeconds, cappedAt24h: requestedSeconds > windowSeconds,
    startSavedAt: source.savedAt, endSavedAt,
    buildings: candidates.map(candidate => candidate.estimate),
    unsupported, skipped,
    goodsDelta: difference(predictedGoods, beforeGoods),
    predictedGoods,
    carriers,
    inFlight: {
      actors: inFlightActors,
      goods: inFlightGoods,
      handcartCargo: handcartCargo(actors)
    },
    totalGoods,
    totalGoodsDelta: difference(totalGoods, beforeTotal),
    totals: {
      buildings: buildings.length, completed: buildings.filter(building => building.construction === 1).length,
      supported: candidates.length, unsupported: unsupported.length, skipped: skipped.length, cycles,
      allocationPasses, passLimitReached
    },
    routes: {
      cache: { calls: routeStats.calls, hits: routeStats.hits, misses: routeStats.misses, entries: routeStats.entries },
      roadCache: { ...roadStats },
      revisions: { road: roads.revision, occupancy, terrain: world.terrainRevision ?? 0, build: world.buildRevision ?? 0 }
    },
    storage: { capacity: storage.capacity, stored, reserved },
    notes: [
      "Shadow model only: the source save and world are never mutated.",
      "No traffic jams or carrier collisions are modeled; routes use free-flow road-tier speed.",
      "Deposits, ore amounts, animals, animal respawns, fields, fog, camera, player and archipelago state are copied unchanged.",
      "Inputs come from building input stock and road-connected storage inventory; predicted output goes to the nearest accepting storage.",
      "Shared ordinary wares use one landmass storage pool; depot inventory views are attached to the clone, never duplicated per warehouse.",
      "Worker rest and stock hand-off timings come from the live balance constants and the same building-level/talent production cycle scale.",
      "Carrier route seconds use the saved road network and the live carrier-speed talent; no live actor is moved.",
      "Input-free outdoor producers are assumed to find an endless source without resource-search travel.",
      `Carrier concurrency ${carriers.concurrency} and capacity ${carriers.capacity} come from saved carrier/hand-cart facts; ${carriers.handcarts} hand carts are counted read-only.`,
      "Current worker-cycle progress is credited before the first predicted cycle; actors and hand carts are not moved.",
      "Chain timing is aggregated over the window; only completed buildings with a staffed worker are modeled.",
      "goodsDelta covers building storage/input/output only; totalGoods/totalGoodsDelta add unchanged actor-held cargo.",
      "Only building goods/cycle fields and savedAt are predicted; settlement game-tick and other clock fields stay unchanged.",
      ...(requestedSeconds > windowSeconds ? [`Requested ${requestedSeconds}s capped at ${windowSeconds}s (24 h maximum).`] : []),
      ...(passLimitReached
        ? ["Allocation pass limit reached; unfulfilled cycles are reported, not silently dropped."] : [])
    ],
    exactComparison: { status: "not-run", by: "shadow-model" }
  };
  return { save: predicted, report };
};
