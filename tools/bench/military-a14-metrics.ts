import { performance } from "node:perf_hooks";

import { MORALE_BROKEN } from "../../src/shared/balance/morale";
import {
  type RetreatRouteTraceRecord, setRetreatRouteTraceSink
} from "../../src/shared/settlement/commander/retreat-route-trace";
import { setVisionProbe, visionProbeReport } from "../../src/shared/settlement/faction-vision-probe";
import type { SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../../src/shared/settlement/settlement-state-hash";
import { setTickPhaseRecorder, type TickPhaseRecorder } from "../../src/shared/settlement/tick-phase-profile";
import { type BattleMetrics, createBattleSampler } from "./military-a14-battle-sampler";
import { createDecisionTrace, type DecisionMetrics } from "./military-a14-decisions";
import { createDirectorLog, type DirectorMetrics } from "./military-a14-director";
import { createMoraleLog, type MoraleMetrics } from "./military-a14-morale";
import type { A14Scenario } from "./military-a14-scenarios";
import { createMotionRecorder } from "./military-motion-metrics";

/**
 * A14 per-fixture receipt (plan §10.2): motion (stuck seconds, tick p50/p95/max), the AI phase p95s, the
 * battle outcome, the commander's decision trace and the A13 illegal-read probe. Morale and retreat metrics
 * are null until A14-2/A14-3 add the features (their hooks below). The probe and the phase recorder read no
 * simulation state, so the final state hash equals an unmeasured run's.
 */
export interface A14Metrics extends BattleMetrics, DecisionMetrics, DirectorMetrics, MoraleMetrics {
  fixture: string;
  seconds: number;
  stuckSeconds: number;
  longestStallSeconds: number;
  /** Most melee attackers on one target at any tick (the claim cap under focus fire, A14-2). */
  attackersMax: number;
  tickP50: number;
  tickP95: number;
  tickMax: number;
  /** p95/max ms per tick of every AI phase present (commander, director, morale; A14-0 adds them). */
  aiPhases: Record<string, { p95: number; max: number; ticks: number }>;
  /** Seconds until only one side has soldiers left (null: undecided); the run length otherwise. */
  battleSeconds: number | null;
  losses: string;
  survivors: string;
  /**
   * A14-3: enemy influence summed along every covered retreat route over the same along the straight cell lines
   * to the routes' ends (< 1: the routes avoid the enemy; null: no route crossed enemy influence).
   */
  retreatPathExposure: number | null;
  /** A14-3: covered retreat routes handed out (routs and commander squad retreats). */
  retreatRoutes: number;
  /** A14-3: the longest single stall (seconds) of a soldier while it routs (broken). */
  routedStallSeconds: number;
  /** A13 probe: enemy reads by AI sites, and the illegal (unseen) ones (gate 0). */
  probeReads: number;
  probeAlertedReads: number;
  probeUnseenReads: number;
  probeUnseenSites: string[];
  /** Features the fixture still waits for (`<lane>:<hook>`). */
  pendingHooks: readonly string[];
  stateHash: string;
}

/** The seed-median gate metrics of one fixture (each list in `A14_SEED_OFFSETS` order). */
export interface A14SeedMedians {
  stuckSeconds: number;
  ordersPerMinutePerSquad: number | null;
  runs: { stuckSeconds: number; ordersPerMinutePerSquad: number | null }[];
}

/** The JSON receipt of `military-a14-baseline.ts` (one per recorded commit). */
export interface A14Baseline {
  commit: string;
  measured: string;
  node: string;
  /** Seed offset 0 of every fixture. */
  fixtures: Record<string, A14Metrics>;
  /** Stuck and churn medians over the seed offsets (the no-regression gates). */
  medians?: Record<string, A14SeedMedians>;
}

/** The middle value (the upper one of an even count); null when every value is null. */
export const medianOf = (values: readonly (number | null)[]) => {
  const present = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  return present.length ? present[Math.floor(present.length / 2)]! : null;
};

/** The stuck and churn medians of `runs` (one fixture run per seed offset). */
export const seedMediansOf = (runs: readonly A14Metrics[]): A14SeedMedians => ({
  ordersPerMinutePerSquad: medianOf(runs.map(run => run.ordersPerMinutePerSquad)),
  runs: runs.map(({ ordersPerMinutePerSquad, stuckSeconds }) => ({ ordersPerMinutePerSquad, stuckSeconds })),
  stuckSeconds: medianOf(runs.map(run => run.stuckSeconds)) ?? 0
});

/**
 * AI phases of the tick profile: A14-0 adds the AI commander's phase, A14-2 morale and A14-4 the director.
 * `military.commander` is the player's hero roster (not the AI) and is left out.
 */
const AI_PHASE = /commander|director|morale/i;
const HERO_PHASE = "military.commander";

const percentile = (values: readonly number[], share: number) => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]!;
};
const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Per tick ms of every AI phase (a phase may open several times in one tick). */
const createAiPhaseRecorder = () => {
  const samples = new Map<string, number[]>(), tick = new Map<string, number>();
  let open: string | null = null, openedAt = 0;
  const close = (at: number) => {
    if (open !== null) tick.set(open, (tick.get(open) ?? 0) + at - openedAt);
    open = null;
  };
  const recorder: TickPhaseRecorder = {
    endTick: () => {
      close(performance.now());
      for (const [phase, ms] of tick) {
        let list = samples.get(phase);
        if (!list) samples.set(phase, list = []);
        list.push(ms);
      }
      tick.clear();
    },
    mark: (phase, detail) => {
      const at = performance.now();
      close(at);
      const key = detail === undefined ? phase : `${phase}:${detail}`;
      if (key !== HERO_PHASE && AI_PHASE.test(key)) { open = key; openedAt = at; }
    }
  };
  const report = () => Object.fromEntries([...samples].sort(([a], [b]) => a.localeCompare(b))
    .map(([phase, list]) => [phase, { max: round(Math.max(...list)), p95: round(percentile(list, .95)),
      ticks: list.length }]));
  return { recorder, report };
};

const probeSimulation = (simulation: SettlementSimulation) => setVisionProbe({
  alerted: (faction, uid) => simulation.factionKnowledge().alerted(faction, uid),
  ruleAllows: faction => simulation.factionKnowledge().omniscient(faction),
  sees: (faction, x, z) => simulation.factionVision().sees(faction, x, z)
});

const probeSummary = () => {
  const report = visionProbeReport();
  const sum = (pick: (site: (typeof report)[number]) => number) =>
    report.reduce((total, site) => total + pick(site), 0);
  return {
    probeAlertedReads: sum(site => site.alerted),
    probeReads: sum(site => site.reads),
    probeUnseenReads: sum(site => site.unseen),
    probeUnseenSites: report.filter(site => site.unseen > 0).map(site => `${site.site}@${site.location}:${site.unseen}`)
  };
};

/** Morale orders per minute: the morale layer's fall-backs and routs plus the commander's morale reserve swaps. */
const withReserveSwaps = (metrics: MoraleMetrics, reserveSwaps: number): MoraleMetrics => ({
  ...metrics,
  moraleOrdersPerMinute: metrics.moraleOrdersPerMinute === null && !reserveSwaps ? null
    : Math.round(((metrics.moraleOrdersPerMinute ?? 0) + reserveSwaps) * 100) / 100
});

export const stateHashOf = (simulation: SettlementSimulation) =>
  hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));

/** The covered routes of a run (route trace) and the longest stall of a routing soldier. */
const createRetreatLog = (simulation: SettlementSimulation) => {
  let exposure = 0, straight = 0, routes = 0, routedStall = 0;
  const record = (route: Readonly<RetreatRouteTraceRecord>) => {
    routes++;
    exposure += route.exposure;
    straight += route.straightExposure;
  };
  const sample = (stallOf: (uid: number) => number) => {
    const morale = (simulation.militaryAiDebug() as { morale?: [number, number][] }).morale ?? [];
    for (const [uid, state] of morale) if (state === MORALE_BROKEN) routedStall = Math.max(routedStall, stallOf(uid));
  };
  return {
    sample,
    start: () => { setRetreatRouteTraceSink(record); },
    stop: () => { setRetreatRouteTraceSink(null); },
    summary: () => ({
      retreatPathExposure: straight > 0 ? round(exposure / straight) : null,
      retreatRoutes: routes,
      routedStallSeconds: round(routedStall, 1)
    })
  };
};

/** Runs one fixture to its end with every A14 measurement installed (and removed afterwards). */
export const runA14Fixture = (scenario: A14Scenario): A14Metrics => {
  const { simulation } = scenario;
  const motion = createMotionRecorder(scenario);
  const decisions = createDecisionTrace(simulation, scenario.computerFactions, scenario.overwatchArea);
  const battle = createBattleSampler(simulation, scenario.computerFactions);
  const phases = createAiPhaseRecorder();
  const morale = createMoraleLog(simulation, scenario.computerFactions);
  const retreat = createRetreatLog(simulation);
  const director = createDirectorLog();
  probeSimulation(simulation);
  setTickPhaseRecorder(phases.recorder);
  let contact = false;
  try {
    director.start(simulation.gameTick());
    scenario.start();
    morale.start();
    retreat.start();
    for (let tick = 0; tick < scenario.seconds * 20; tick++) {
      motion.step();
      retreat.sample(motion.stallOf);
      contact ||= simulation.militarySoldiers().some(soldier => (soldier.combat?.attackTime ?? 0) > 0);
      decisions.sample(contact);
      battle.sample(.05);
    }
    const metrics = motion.summary();
    return {
      ...battle.summary(), ...decisions.summary(), ...director.summary(), ...probeSummary(),
      ...withReserveSwaps(morale.summary(scenario.seconds), decisions.summary().moraleReserveOrdersPerMinute),
      aiPhases: phases.report(), attackersMax: metrics.attackersMax, battleSeconds: metrics.decidedSeconds,
      fixture: scenario.key,
      longestStallSeconds: metrics.longestStallSeconds, losses: metrics.losses, pendingHooks: scenario.pendingHooks,
      ...retreat.summary(), seconds: scenario.seconds, stateHash: stateHashOf(simulation),
      stuckSeconds: metrics.stuckSeconds, survivors: metrics.survivors, tickMax: metrics.tickMax,
      tickP50: metrics.tickP50, tickP95: metrics.tickP95
    };
  } finally {
    director.stop();
    morale.stop();
    retreat.stop();
    setTickPhaseRecorder(null);
    setVisionProbe(null);
  }
};
