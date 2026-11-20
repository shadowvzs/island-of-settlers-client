export type Counts = Record<string, number>;

/** The island's ledger at one moment of an offline replay. */
export interface LedgerSample {
  animals: number;
  births: number;
  /** Finished cycles of each mixed-product workshop. */
  cycles: Counts;
  elapsed: number;
  /** Every ware held anywhere on the island (stocks, loads, paid inputs, cargo). */
  holdings: Counts;
  /** Stored goods of the archived home island a colony takes supplies from. */
  home: Counts;
  /** Goods in any building: storages and workshop buffers. */
  inBuildings: Counts;
  /** Ore left per mine uid. */
  ore: Counts;
  /** Finished products so far (player statistics). */
  produced: Counts;
  /** Units worked from finite sources (fishing sites), per kind. */
  resources: Counts;
  /** Units left in each started finite source. */
  sources: Counts;
  /** Goods in the island's storages. */
  stored: Counts;
  structure: string;
  trees: number;
}

/** What changed between two samples over `seconds` of real ticks. */
export interface LedgerFlow {
  animals: number;
  births: number;
  cycles: Counts;
  holdings: Counts;
  home: Counts;
  ore: Counts;
  produced: Counts;
  resources: Counts;
  seconds: number;
  stored: Counts;
  trees: number;
}

export interface SkipRoom {
  /** Wares of mixed-product workshops: their skipped products follow each workshop's own sequence. */
  mixedWares: ReadonlySet<string>;
  /** People the population limit still allows. */
  peopleRoom: number;
  /** Mature trees the woodcutters could still fell. */
  treeRoom: number;
  /** Free storage capacity for a ware. */
  storageRoom: (ware: string) => number;
  /** Real-tick window: a skip keeps one window's flow in reserve before any stock or source ends. */
  window: number;
}

const COUNT_KEYS = ["cycles", "holdings", "home", "ore", "produced", "resources", "stored"] as const;
/** Finished cycles blur a measurement by a few units (a pass-through ware moves between 0 and 3). */
const NOISE_UNITS = 3;

/** A net change larger than the counting noise. */
export const isSignificant = (count: number) => Math.abs(count) > NOISE_UNITS;

/** Trees a steady regime removes per measured stretch beyond what foresters plant (0 when not shrinking). */
export const treeLoss = (flow: LedgerFlow) => isSignificant(flow.trees) && flow.trees < 0 ? -flow.trees : 0;

/** Hunting faster than the wildlife recovers is never extrapolated. */
export const isWildlifeSteady = (flow: LedgerFlow) => flow.animals >= -NOISE_UNITS;

const countDifference = (from: Counts, to: Counts) => {
  const change: Counts = {};
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const delta = (to[key] ?? 0) - (from[key] ?? 0);
    if (delta) change[key] = delta;
  }
  return change;
};

const countSum = (first: Counts, second: Counts) => {
  const sum: Counts = { ...first };
  for (const [key, count] of Object.entries(second)) sum[key] = (sum[key] ?? 0) + count;
  return sum;
};

export const flowDifference = (from: LedgerSample, to: LedgerSample): LedgerFlow => ({
  animals: to.animals - from.animals, births: to.births - from.births, cycles: countDifference(from.cycles, to.cycles),
  holdings: countDifference(from.holdings, to.holdings), home: countDifference(from.home, to.home),
  ore: countDifference(from.ore, to.ore), produced: countDifference(from.produced, to.produced),
  resources: countDifference(from.resources, to.resources), seconds: to.elapsed - from.elapsed,
  stored: countDifference(from.stored, to.stored), trees: to.trees - from.trees
});

export const addFlow = (first: LedgerFlow, second: LedgerFlow): LedgerFlow => ({
  animals: first.animals + second.animals, births: first.births + second.births,
  cycles: countSum(first.cycles, second.cycles), holdings: countSum(first.holdings, second.holdings),
  home: countSum(first.home, second.home),
  ore: countSum(first.ore, second.ore), produced: countSum(first.produced, second.produced),
  resources: countSum(first.resources, second.resources), seconds: first.seconds + second.seconds,
  stored: countSum(first.stored, second.stored), trees: first.trees + second.trees
});

const hasChanges = (counts: Counts) => Object.values(counts).some(count => count !== 0);

/** Nothing was produced, consumed, born or worked: only the clock moves. */
export const isIdleFlow = (flow: LedgerFlow) => !flow.births && !COUNT_KEYS.some(key => hasChanges(flow[key]));

const SCALAR_KEYS = ["animals", "births", "trees"] as const;
const MEASURED_KEYS = ["cycles", "holdings", "home", "ore", "resources"] as const;

/** Whether `part` of a total lies on the straight line to `whole`, judged by the smaller side's noise. */
const splitsEvenly = (part: number, whole: number, share: number) => {
  const expected = whole * share;
  return Math.abs(part - expected) <= 2 + 2 * Math.sqrt(Math.min(Math.abs(expected), Math.abs(whole - expected)));
};

/** Whether the running total `part` (after `part.seconds`) lies on the straight line to `whole`. */
const onTrend = (part: LedgerFlow, whole: LedgerFlow) => {
  const share = part.seconds / whole.seconds;
  return SCALAR_KEYS.every(key => splitsEvenly(part[key], whole[key], share)) && MEASURED_KEYS.every(key =>
    [...new Set([...Object.keys(part[key]), ...Object.keys(whole[key])])]
      .every(name => splitsEvenly(part[key][name] ?? 0, whole[key][name] ?? 0, share)));
};

const isLinear = (windows: readonly LedgerFlow[]) => {
  const whole = windows.reduce(addFlow);
  let part: LedgerFlow | undefined;
  for (const window of windows.slice(0, -1)) {
    part = part ? addFlow(part, window) : window;
    if (!onTrend(part, whole)) return false;
  }
  return true;
};

/**
 * The longest run of latest windows whose flows grow at one steady rate: a stock that ran out, a
 * felled forest or a filled store earlier in the run drops those older windows from the regime.
 */
export const steadyWindows = (windows: readonly LedgerFlow[]) => {
  for (let first = 0; first < windows.length; first++)
    if (isLinear(windows.slice(first))) return windows.slice(first);
  return [];
};

/** Index after the last window `changed` matches (0 when none does). */
const after = (windows: readonly LedgerFlow[], changed: (window: LedgerFlow) => boolean) =>
  windows.findLastIndex(changed) + 1;

const wareEventCut = (windows: readonly LedgerFlow[], regime: LedgerFlow, now: LedgerSample, room: SkipRoom) => {
  let first = 0;
  for (const [ware, change] of Object.entries(regime.holdings)) {
    if (!isSignificant(change)) continue;
    const usedUp = change < 0 && (now.holdings[ware] ?? 0) <= NOISE_UNITS;
    const filled = change > 0 && room.storageRoom(ware) <= NOISE_UNITS;
    if (usedUp || filled) first = Math.max(first, after(windows, window => (window.holdings[ware] ?? 0) * change > 0));
  }
  return first;
};

/**
 * Bounds the island reached are events, not rates: a ware used up or filling its storage, the
 * population limit, a worked out mine or a felled forest. The regime restarts after the last window
 * that still moved toward such a bound.
 */
export const cutAfterEvents = (windows: readonly LedgerFlow[], now: LedgerSample, room: SkipRoom) => {
  if (!windows.length) return [];
  const regime = windows.reduce(addFlow);
  let first = wareEventCut(windows, regime, now, room);
  if (regime.births > 0 && room.peopleRoom <= 0) first = Math.max(first, after(windows, window => window.births > 0));
  if (treeLoss(regime) && room.treeRoom <= 0) first = Math.max(first, after(windows, window => window.trees < 0));
  for (const [uid, change] of Object.entries(regime.ore))
    if (change < 0 && (now.ore[uid] ?? 0) <= 0)
      first = Math.max(first, after(windows, window => (window.ore[uid] ?? 0) < 0));
  return windows.slice(first);
};

/** Whole repeats of `rate` that leave one window's flow (plus a margin) of `available`. */
const repeatsWithin = (available: number, rate: number, flow: LedgerFlow, room: SkipRoom) =>
  Math.floor((available - Math.ceil(rate * room.window / flow.seconds) - 2) / rate);

const holdingRepeats = (flow: LedgerFlow, now: LedgerSample, room: SkipRoom, ware: string, change: number) => {
  if (!change) return Infinity;
  // Products piling up outside the storages (a workshop's output) are about to block it.
  if (isSignificant(change) && change > 0 && (flow.stored[ware] ?? 0) * 2 < change) return 0;
  if (change > 0) return repeatsWithin(room.storageRoom(ware), change, flow, room);
  // Every measured use is repeated (goods stay conserved), from storages and then workshop buffers.
  return repeatsWithin(now.inBuildings[ware] ?? 0, -change, flow, room);
};

const depletionRepeats = (flow: Counts, left: Counts, measured: LedgerFlow, room: SkipRoom) => {
  let repeats = Infinity;
  for (const [key, change] of Object.entries(flow))
    if (change < 0) repeats = Math.min(repeats, repeatsWithin(left[key] ?? 0, -change, measured, room));
  return repeats;
};

/** Net change of all mixed-product wares together. */
export const mixedChange = (flow: LedgerFlow, wares: ReadonlySet<string>) =>
  [...wares].reduce((sum, ware) => sum + (flow.holdings[ware] ?? 0), 0);

const mixedRepeats = (flow: LedgerFlow, now: LedgerSample, room: SkipRoom) => {
  const change = mixedChange(flow, room.mixedWares);
  if (change > 0)
    return repeatsWithin(Math.min(...[...room.mixedWares].map(room.storageRoom)), change, flow, room);
  if (!isSignificant(change)) return Infinity;
  const stored = [...room.mixedWares].reduce((sum, ware) => sum + (now.stored[ware] ?? 0), 0);
  return repeatsWithin(stored, -change, flow, room);
};

const sourcesOf = (sources: Counts, kind: string) =>
  Object.entries(sources).filter(([key, left]) => key.startsWith(`${kind}:`) && left > 1);

/** Units the started sources of a kind can give before any of them is worked out. */
const sourceRoom = (sources: Counts, kind: string) =>
  sourcesOf(sources, kind).reduce((sum, [, left]) => sum + left - 1, 0);

/** Spreads `units` of a kind over its started sources, the most worked first; each keeps one unit. */
export const sourceUse = (sources: Counts, kind: string, units: number) => {
  const use: Counts = {};
  let remaining = units;
  for (const [key, left] of sourcesOf(sources, kind).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))) {
    if (remaining <= 0) break;
    use[key] = Math.min(remaining, left - 1);
    remaining -= use[key];
  }
  return use;
};

/**
 * Whole repeats of a steady flow that keep every stock, storage, population limit and finite source
 * inside its bounds with one window to spare, so each of those events happens in real ticks.
 */
export const skipLimit = (flow: LedgerFlow, now: LedgerSample, room: SkipRoom) => {
  let repeats = flow.births > 0 ? Math.floor(room.peopleRoom / flow.births) : Infinity;
  const felled = treeLoss(flow);
  if (felled) repeats = Math.min(repeats, repeatsWithin(room.treeRoom, felled, flow, room));
  for (const [ware, change] of Object.entries(flow.holdings))
    if (!room.mixedWares.has(ware)) repeats = Math.min(repeats, holdingRepeats(flow, now, room, ware, change));
  repeats = Math.min(repeats, mixedRepeats(flow, now, room));
  for (const [kind, used] of Object.entries(flow.resources))
    if (used > 0) repeats = Math.min(repeats, repeatsWithin(sourceRoom(now.sources, kind), used, flow, room));
  repeats = Math.min(repeats, depletionRepeats(flow.home, now.home, flow, room),
    depletionRepeats(flow.ore, now.ore, flow, room));
  return Math.max(0, repeats);
};
