import {
  hostileSoldiers, islandHoldings, islandStructure, storedGoods
} from "../../shared/settlement/settlement-offline-ledger";
import type { Goods } from "../../shared/settlement/settlement-types";
import { measuredFlowModel } from "./offline-chain-recipes";
import { createOfflineCycleLog, eventRate } from "./offline-cycle-log";
import { createJumpRunner, type JumpPlan, type JumpRunnerOptions } from "./offline-jump-runner";
import type { Counts } from "./offline-ledger-flow";

/** Real ticks between structure checks. */
export const OFFLINE_JUMP_WINDOW_SECONDS = 60;
/** Steady real ticking measured before a jump: enough cycles for rates within a few percent. */
const MEASURE_SECONDS = 900;
/** A jump stops this long before an outside event, which then happens in real ticks. */
const HORIZON_MARGIN_SECONDS = 5;
/** Home stock changes up to this many units over a measurement are counting noise. */
const NOISE_UNITS = 3;
/** Exact forward window used to validate a measured plan before a long jump. */
const RECONCILE_SECONDS = 120;
/** A plan is rejected when a reconciled ware misses its predicted change by more than this share. */
const RECONCILE_TOLERANCE = 0.08;
/** After this many failed validations, keep the island in exact ticks for the rest of the replay. */
const MAX_RECONCILE_FAILURES = 2;
const MAX_JUMP_SECONDS = 900;
const POST_JUMP_SECONDS = 60;

export interface OfflineChainJumpOptions extends JumpRunnerOptions {
  /** Old rule: any hostile soldier on the island, even in an idle camp, keeps the replay in real ticks. */
  enemyCampsBlockJumps: boolean;
  /** Game seconds until an outside event (colony expiry, ore ship) needs real ticks. */
  horizon: () => number;
}

interface IslandSample {
  animals: number;
  births: number;
  holdings: Goods;
  home: Goods;
  hostile: number;
  ore: number;
  people: number;
  structure: string;
}

const difference = (from: Counts, to: Counts, base: Counts = {}) => {
  const change: Counts = { ...base };
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)]))
    change[key] = (change[key] ?? 0) + (to[key] ?? 0) - (from[key] ?? 0);
  return change;
};

/** The colony's steady draw on (or gift to) the home stock per second, beyond the counting noise. */
const homeDraw = (from: Counts, to: Counts, seconds: number) => Object.fromEntries(Object.entries(difference(from, to))
  .filter(([, change]) => Math.abs(change) > NOISE_UNITS).map(([ware, change]) => [ware, change / seconds]));

/**
 * Event-driven offline catch-up: a stretch of real fixed ticks measures every working building's
 * chain (cycle rate, inputs, products); the rest is integrated analytically between events (stocks
 * running out, storages filling, mines worked out, the population limit), where only the bounded
 * chains change. Structure changes and fights are real ticked and measured again; an outside event
 * (an ore ship) is real ticked, after which the same measurement carries on. Actors keep their last
 * real-ticked state: at their buildings, in storage or on a valid route.
 */
export const createOfflineChainJumps = (options: OfflineChainJumpOptions) => {
  const { simulation } = options;
  const nation = simulation.playerNation(), log = createOfflineCycleLog(nation), runJump = createJumpRunner(options);
  let births = simulation.settlerBirths(), measureStart = 0, outsideEventAt = Infinity;
  let first: IslandSample, plan: JumpPlan | undefined, stocked = new Map<number, Goods>();
  type Watch = { at: number; baseline: IslandSample; births: number; plan: JumpPlan; predicted: Counts;
    seconds: number };
  let candidate: Watch | undefined, post: Watch | undefined;
  let failures = 0, disabled = false, jumpCap = MAX_JUMP_SECONDS;

  const sample = (): IslandSample => {
    const state = simulation.saveState(), home = options.homeBuildings();
    const ore = options.world.oreAmount.reduce((sum, amount) => sum + amount, 0);
    return { animals: options.livingAnimals(), births: state.settlerBirths,
      holdings: islandHoldings(state), home: home ? storedGoods(home) : {},
      hostile: hostileSoldiers(state), ore, people: simulation.population().people,
      structure: islandStructure(state) };
  };

  /** Starts a new measurement at `elapsed`; `eventAt` is when the next outside event is due. */
  const restart = (elapsed: number, eventAt = elapsed + options.horizon()) => {
    log.reset(); measureStart = elapsed; first = sample(); births = simulation.settlerBirths();
    stocked = new Map(simulation.buildings().map(building => [building.uid, { ...building.input }]));
    outsideEventAt = eventAt;
    candidate = undefined; post = undefined;
  };

  /** Goods carried into a building's input stock while measuring: used, plus what the stock grew. */
  const delivered = (uid: number) => {
    const building = simulation.buildings().find(entry => entry.uid === uid);
    return difference(stocked.get(uid) ?? {}, building?.input ?? {}, log.records().get(uid)?.inputs ?? {});
  };

  const measuredPlan = (now: IslandSample, seconds: number): JumpPlan => ({
    births: eventRate(log.births(), seconds), homeDraw: homeDraw(first.home, now.home, seconds),
    model: measuredFlowModel({ animals: now.animals - first.animals, delivered,
      holdings: difference(first.holdings, now.holdings), records: log.records(), seconds,
      waited: log.waited }, simulation.buildings(), nation),
    people: (first.people + now.people) / 2 });

  /** No ore ship (the outside event) is at the island: supply ships are part of the steady flows. */
  const calm = () => !simulation.ships().some(ship => ship.visitorRole === "ore");

  /** The measured plan, kept until the island's structure changes. */
  const nextPlan = (now: IslandSample, elapsed: number) => {
    if (plan) return plan;
    const measured = elapsed - measureStart;
    return measured >= MEASURE_SECONDS ? measuredPlan(now, measured) : undefined;
  };

  const startPost = (active: JumpPlan, elapsed: number, remaining: number) => {
    const preview = runJump.preview(active, Math.min(POST_JUMP_SECONDS, remaining));
    if (!preview || preview.seconds < 10) { post = undefined; return; }
    post = { at: elapsed, baseline: sample(), births: preview.births, plan: active,
      predicted: preview.net, seconds: preview.seconds };
  };
  const runSegment = (active: JumpPlan, elapsed: number, remaining: number) => {
    const { grown, seconds: jumped } = runJump.run(active, Math.min(remaining, jumpCap));
    if (grown) { plan = undefined; post = undefined; if (jumped) restart(elapsed + jumped); return jumped; }
    if (jumped) startPost(active, elapsed + jumped, remaining - jumped);
    return jumped;
  };
  const near = (actual: number, predicted: number) =>
    Math.abs(actual - predicted) <= Math.max(2, RECONCILE_TOLERANCE * Math.max(1, Math.abs(actual)));
  const agrees = (baseline: IslandSample, now: IslandSample, predicted: Counts, predictedBirths: number,
    plan: JumpPlan, seconds: number) => {
    const actual = difference(baseline.holdings, now.holdings);
    for (const [key, value] of Object.entries(predicted))
      if (!key.startsWith("~") && !near(actual[key] ?? 0, value)) return false;
    if (!near(now.births - baseline.births, predictedBirths)) return false;
    const predictedOre = Object.entries(predicted)
      .filter(([key]) => key.startsWith("~ore:"))
      .reduce((sum, [, value]) => sum + value, 0);
    if (!near(now.ore - baseline.ore, predictedOre)) return false;
    const actualHome = difference(baseline.home, now.home);
    for (const ware of new Set([...Object.keys(actualHome), ...Object.keys(plan.homeDraw)]))
      if (!near(actualHome[ware] ?? 0, (plan.homeDraw[ware] ?? 0) * seconds)) return false;
    return true;
  };
  const settle = (watch: Watch, now: IslandSample, elapsed: number, remaining: number) => {
    if (now.structure !== first.structure) {
      candidate = undefined; post = undefined; plan = undefined; restart(elapsed);
      return 0;
    }
    if (agrees(watch.baseline, now, watch.predicted, watch.births, watch.plan, watch.seconds)) {
      const active = watch.plan;
      candidate = undefined; post = undefined;
      return runSegment(active, elapsed, remaining);
    }
    candidate = undefined; post = undefined; failures++;
    jumpCap = Math.max(300, Math.floor(jumpCap / 2));
    if (failures >= MAX_RECONCILE_FAILURES) { disabled = true; plan = undefined; }
    return 0;
  };

  return {
    /** Records a finished production cycle (the simulation's hook). */
    cycle: log.cycle,
    /** Starts measuring when the replay starts. */
    start: () => restart(0),
    /** After every real tick: the measurement clock, waiting workers and births. */
    ticked: (elapsed: number, step: number) => {
      log.setClock(elapsed - measureStart);
      log.observe(simulation.buildings(), step);
      const born = simulation.settlerBirths();
      if (born > births) log.born(born - births);
      births = born;
    },
    /** Closes a structure window; returns the game seconds jumped (0: keep ticking). */
    windowEnd: (elapsed: number, remaining: number) => {
      const now = sample();
      if (disabled) return 0;
      if (post) return elapsed - post.at < post.seconds ? 0 : settle(post, now, elapsed, remaining);
      if (candidate)
        return elapsed - candidate.at < candidate.seconds ? 0 : settle(candidate, now, elapsed, remaining);
      const changed = now.structure !== first.structure || (options.enemyCampsBlockJumps && now.hostile > 0);
      if (changed) plan = undefined;
      if (changed || elapsed >= outsideEventAt) { restart(elapsed); return 0; }
      plan = nextPlan(now, elapsed);
      if (!plan || !calm()) return 0;
      const limit = Math.min(remaining, options.horizon() - HORIZON_MARGIN_SECONDS, RECONCILE_SECONDS);
      const preview = runJump.preview(plan, limit);
      if (!preview) return 0;
      if (preview.seconds < 10) return runSegment(plan, elapsed, remaining);
      candidate = { at: elapsed, baseline: now, births: preview.births, plan,
        predicted: preview.net, seconds: preview.seconds };
      return 0;
    }
  };
};
