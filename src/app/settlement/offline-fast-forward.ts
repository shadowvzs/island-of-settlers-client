import { addToHome, takeFromStorages } from "../../shared/settlement/colony-economy";
import { digMineOre, mineOreLeft } from "../../shared/settlement/settlement-mine-ore";
import {
  hostileSoldiers, islandHoldings, islandStructure, savedBuildingGoods, savedStoredGoods, standingTrees, storedGoods,
  takeFromBuildings, workedResources
} from "../../shared/settlement/settlement-offline-ledger";
import { isMineType } from "../../shared/settlement/settlement-placement";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { Goods, SettlementBuilding } from "../../shared/settlement/settlement-types";
import { islandStorageCapacity, storageRoom } from "../../shared/settlement/storage-capacity";
import type { WorldData } from "../../shared/world/world-data";
import {
  addFlow, type Counts, cutAfterEvents, flowDifference, isIdleFlow, isSignificant, isWildlifeSteady,
  type LedgerFlow, type LedgerSample, mixedChange, skipLimit, type SkipRoom, sourceUse, steadyWindows, treeLoss
} from "./offline-ledger-flow";
import { mixedProducerCycles, mixedProducerWares, runMixedCycles } from "./offline-mixed-output";
import { fellableTrees, hasOnlyPlainWoodcutters } from "./offline-tree-harvest";

/** Real ticks between ledger samples: one measurement window. */
export const OFFLINE_WINDOW_SECONDS = 120;
/** A regime is only extrapolated after this much steady real ticking. */
const MIN_REGIME_SECONDS = 5 * OFFLINE_WINDOW_SECONDS;
/** Skipped time per measured second while the real-tick budget lasts. */
const BASE_SKIP_RATIO = 3;
/** A skipped regime is accepted when the next exact window is this close to its prediction. */
const VERIFY_TOLERANCE = .08;
const VERIFY_UNITS = 2;
const near = (actual: number, predicted: number) =>
  Math.abs(actual - predicted) <= Math.max(VERIFY_UNITS, VERIFY_TOLERANCE * Math.max(1, Math.abs(actual)));

export interface OfflineFastForwardOptions {
  canHarvestTree: (id: number) => boolean;
  /** Old rule: any hostile soldier on the island, even in an idle camp, keeps the replay in real ticks. */
  enemyCampsBlockJumps: boolean;
  /** Real ticked game seconds the replay aims to spend on this island; more is skipped once it is used. */
  exactBudgetSeconds: number;
  fellTrees: (ids: readonly number[]) => void;
  /** The archived home island's buildings a colony replay takes supplies from. */
  homeBuildings: () => SettlementBuilding[] | undefined;
  /** Game seconds until an outside event (colony expiry, ore ship) needs real ticks. */
  horizon: () => number;
  livingAnimals: () => number;
  onOreChanged?: (cell: number) => void;
  produced: (ware: string) => void;
  simulation: SettlementSimulation;
  world: WorldData;
}

const minesOf = (world: WorldData, buildings: readonly SettlementBuilding[]): Counts => {
  const ore: Counts = {};
  for (const building of buildings)
    if (building.construction === 1 && isMineType(building.typeId)) ore[building.uid] = mineOreLeft(world, building);
  return ore;
};

const goodsMoves = (flow: Counts, times: number, skipped: ReadonlySet<string>) => {
  const added: Goods = {}, taken: Goods = {};
  for (const [ware, count] of Object.entries(flow)) {
    if (skipped.has(ware)) continue;
    if (count > 0) added[ware] = count * times;
    else taken[ware] = -count * times;
  }
  return { added, taken };
};

/** Repeats every measured net change: used goods leave storages, then buffers; products are stored. */
const moveGoods = (
  buildings: readonly SettlementBuilding[], flow: Counts, times: number, skipped: ReadonlySet<string> = new Set()
) => {
  const { added, taken } = goodsMoves(flow, times, skipped);
  takeFromBuildings(buildings, taken);
  addToHome(buildings, added);
};

/** Mixed-product wares used up meanwhile (new workers' tools), taken from the largest stocks first. */
const mixedUse = (wares: ReadonlySet<string>, stored: Counts, units: number) => {
  const taken: Goods = {};
  let remaining = units;
  for (const ware of [...wares].sort((a, b) => (stored[b] ?? 0) - (stored[a] ?? 0) || a.localeCompare(b))) {
    if (remaining <= 0) break;
    taken[ware] = Math.min(remaining, stored[ware] ?? 0);
    remaining -= taken[ware]!;
  }
  return taken;
};

/**
 * Event-driven offline catch-up: real fixed ticks measure the island's steady flows (finished goods,
 * births, worked ore, sources and trees) over windows; while its shape stays the same and the flows
 * grow at one rate, whole multiples of the measured ticks are skipped by applying the same flows.
 * Actors, crops, resting stones and timers keep their phase, so the skipped stretch repeats the
 * measured ones. A skip never passes a stock running out, a full storage, the population limit, a
 * worked out source or mine, an outside event or the end: those happen in real ticks.
 */
export const createOfflineFastForward = (options: OfflineFastForwardOptions) => {
  const { simulation, world } = options;
  const produced: Counts = {};
  let exactSeconds = 0, previous: LedgerSample | undefined, windows: LedgerFlow[] = [];
  /** The regime applied by the last skip: the next exact window must still follow it. */
  let verification: LedgerFlow | undefined;
  let measuredSkips = 0, verifiedSkips = 0, failedVerifications = 0, diverged = false;
  /** The first difference that rejected a post-jump verification, for the metrics report. */
  let lastFailure: Record<string, { actual: number; predicted: number }> | undefined;
  let state = simulation.saveState();

  const nation = simulation.playerNation();

  const sample = (elapsed: number): LedgerSample => {
    state = simulation.saveState();
    const home = options.homeBuildings(), resources = workedResources(state);
    return { animals: options.livingAnimals(), births: state.settlerBirths,
      cycles: mixedProducerCycles(state.buildings, nation), elapsed,
      holdings: islandHoldings(state), home: home ? storedGoods(home) : {},
      inBuildings: savedBuildingGoods(state),
      ore: minesOf(world, state.buildings), produced: { ...produced }, resources: resources.used,
      sources: resources.left, stored: savedStoredGoods(state), structure: islandStructure(state),
      trees: standingTrees(world) };
  };

  const fellable = () => fellableTrees(world, state.buildings, state.actors, options.canHarvestTree);

  /**
   * Repeats grow with the measured time (a short measurement extrapolates only a little) and beyond
   * the base ratio as far as the real-tick budget needs to cover the rest.
   */
  const skipRatio = (measured: number, remaining: number) => Math.min(
    Math.floor(BASE_SKIP_RATIO * measured / MIN_REGIME_SECONDS),
    Math.max(BASE_SKIP_RATIO, Math.ceil(remaining / Math.max(OFFLINE_WINDOW_SECONDS,
      options.exactBudgetSeconds - exactSeconds)) - 1));

  /** What the island has room for now: storage, people and fellable trees (counted only when needed). */
  const currentRoom = (): SkipRoom => {
    const { limit, people } = simulation.population();
    const capacity = islandStorageCapacity(simulation.buildings(), simulation.talentModifiers().storageCapacity);
    let trees: number | undefined;
    return { mixedWares: mixedProducerWares(simulation.buildings(), nation),
      peopleRoom: limit === undefined ? Infinity : limit - people, storageRoom: ware => storageRoom(capacity, ware),
      get treeRoom() {
        trees ??= hasOnlyPlainWoodcutters(state.buildings) ? fellable().length : 0;
        return trees;
      }, window: OFFLINE_WINDOW_SECONDS };
  };

  const planSkip = (flow: LedgerFlow, now: LedgerSample, room: SkipRoom, remaining: number) => {
    const reachable = Math.min(remaining, options.horizon() - OFFLINE_WINDOW_SECONDS);
    const repeats = Math.floor(reachable / flow.seconds);
    if (isIdleFlow(flow)) return repeats;
    return Math.min(repeats, skipRatio(flow.seconds, remaining), skipLimit(flow, now, room));
  };

  const moveMixedGoods = (flow: LedgerFlow, now: LedgerSample, times: number, wares: ReadonlySet<string>) => {
    const buildings = simulation.buildings();
    const cycles = Object.fromEntries(Object.entries(flow.cycles).map(([uid, count]) => [uid, count * times]));
    addToHome(buildings, runMixedCycles(buildings, nation, cycles));
    const used = Object.values(flow.cycles).reduce((sum, count) => sum + count, 0) - mixedChange(flow, wares);
    if (used > 0 && isSignificant(used)) takeFromStorages(buildings, mixedUse(wares, now.stored, used * times));
  };

  const applySkip = (flow: LedgerFlow, now: LedgerSample, times: number) => {
    const mixed = mixedProducerWares(simulation.buildings(), nation);
    moveGoods(simulation.buildings(), flow.holdings, times, mixed);
    moveMixedGoods(flow, now, times, mixed);
    const home = options.homeBuildings();
    if (home) moveGoods(home, flow.home, times);
    for (const building of simulation.buildings()) {
      const dug = -(flow.ore[building.uid] ?? 0) * times;
      if (dug > 0) for (const cell of digMineOre(world, building, dug)) options.onOreChanged?.(cell);
    }
    for (const [ware, count] of Object.entries(flow.produced))
      for (let index = count * times; index > 0; index--) options.produced(ware);
    const resources: Counts = {};
    for (const [kind, used] of Object.entries(flow.resources))
      if (used > 0) Object.assign(resources, sourceUse(now.sources, kind, used * times));
    const felled = treeLoss(flow) * times;
    if (felled) options.fellTrees(fellable().slice(0, felled));
    simulation.fastForward({ births: flow.births * times, recoverySeconds: flow.seconds * times, resources });
  };

  /**
   * The exact window after a skip must follow the regime that was repeated. Goods, births and the
   * finite sources are compared with the same 8 %/two-unit tolerance the analytic lane uses. A
   * structural change is a new regime (re-measured), not evidence that the last skip was wrong.
   */
  const disagreements = (flow: LedgerFlow, window: LedgerFlow) => {
    const scale = window.seconds / flow.seconds;
    const result: Record<string, { actual: number; predicted: number }> = {};
    const check = (key: string, actual: number, predicted: number) => {
      if (!near(actual, predicted)) result[key] = { actual, predicted };
    };
    check("births", window.births, flow.births * scale);
    check("trees", window.trees, flow.trees * scale);
    check("animals", window.animals, flow.animals * scale);
    const counts = (prefix: string, predicted: Counts, actual: Counts) => {
      for (const key of new Set([...Object.keys(predicted), ...Object.keys(actual)]))
        check(`${prefix}.${key}`, actual[key] ?? 0, (predicted[key] ?? 0) * scale);
    };
    counts("holdings", flow.holdings, window.holdings);
    counts("home", flow.home, window.home);
    counts("ore", flow.ore, window.ore);
    counts("resources", flow.resources, window.resources);
    return result;
  };

  /** Closes a measurement window; returns the game seconds skipped (0: keep ticking). */
  const windowEnd = (elapsed: number, remaining: number) => {
    const now = sample(elapsed), last = previous!;
    previous = now;
    const window = flowDifference(last, now);
    exactSeconds += window.seconds;
    const structureChanged = now.structure !== last.structure;
    if (verification && !structureChanged) {
      const errors = disagreements(verification, window);
      if (Object.keys(errors).length) {
        failedVerifications++; diverged = true; verification = undefined; windows = [];
        lastFailure = errors;
        return 0;
      }
      verifiedSkips++; verification = undefined;
    }
    if (diverged) return 0;
    if (structureChanged || (options.enemyCampsBlockJumps && hostileSoldiers(state))) {
      verification = undefined; windows = []; return 0;
    }
    const room = currentRoom();
    windows = cutAfterEvents(steadyWindows([...windows, window]), now, room);
    if (!windows.length) return 0;
    const regime = windows.reduce(addFlow);
    if (regime.seconds < MIN_REGIME_SECONDS || !isWildlifeSteady(regime)) return 0;
    const times = planSkip(regime, now, room, remaining);
    if (!(times >= 1)) return 0;
    applySkip(regime, now, times);
    measuredSkips++;
    verification = regime;
    previous = sample(elapsed + regime.seconds * times);
    return regime.seconds * times;
  };

  return {
    /** Counts finished products; the skip replays them for the player's statistics. */
    countProduced: (ware: string) => { produced[ware] = (produced[ware] ?? 0) + 1; },
    /** Set once a skip failed its post-jump verification: the island stays in exact ticks. */
    fallbackReason: () => diverged ? "measured-divergence" as const : undefined,
    /** Post-jump verification counters and the first rejected difference, for diagnostics. */
    metrics: () => ({ failed: failedVerifications, lastFailure, skips: measuredSkips, verified: verifiedSkips }),
    /** Takes the first sample when the replay starts. */
    start: () => { previous = sample(0); },
    windowEnd
  };
};
