import { readFileSync } from "node:fs";

import { TICK_SECONDS } from "../../../island-of-settlers-shared/src/time/constants";
import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { navigationJournalWork } from "../../src/shared/settlement/navigation-change-journal";
import { clearNavigationProfile, readNavigationProfile } from "../../src/shared/settlement/navigation-profile";
import { hashSettlementState } from "../../src/shared/settlement/settlement-state-hash";
import { trafficWork } from "../../src/shared/settlement/settlement-traffic-counters";
import {
  createTickPhaseTotals, groupTickPhases, setTickPhaseRecorder, type TickPhaseRecorder, type TickPhaseStats
} from "../../src/shared/settlement/tick-phase-profile";
import { applyMixedFixture, tickFixtureOf, tickFixtureSave } from "./settlement-tick-fixtures";

/**
 * A02: headless, deterministic attribution of the simulation tick (no renderer, no browser).
 * Wall ms per tick phase (military, 0.5 s scheduler, actor loop per occupation, idle, door, ...),
 * deterministic work counters, and a state-hash proof that profiling only observes: the same
 * run without any recorder must end on the identical hash.
 *
 * Usage: npx tsx tools/bench/settlement-tick-attribution.ts <save.json> [seconds=60] [owner|mixed|scaled]
 * [diagnostics]
 * `mixed` (S3+S4): the save's live economy plus every free soldier marching to a banner inside the
 * town and computer foes spawned beside it, so the battle runs next to the economy.
 * `scaled` (A10, D-AI6 target of 500–600 people): the save plus `SCALED_EXTRA_CARRIERS` carriers
 * standing on the town's road nodes, each walking home; the economy reuses them for deliveries.
 * `diagnostics` (A16): the profiled run additionally asks every actor's read-only decision reason
 * each tick, so `hashIdentical` proves the diagnostics never touch simulation state.
 */
const DIAGNOSTIC_LABEL_LIMIT = 48;
const DIAGNOSTIC_ACTOR_STRIDE = 16;

type Island = Awaited<ReturnType<typeof createHeadlessIsland>>;
type Simulation = Island["simulation"];

const [file, secondsArgument, fixtureArgument, diagnosticsArgument] = process.argv.slice(2);
if (!file) throw new Error("Usage: settlement-tick-attribution.ts <save.json> [seconds] [owner|mixed|scaled] [diagnostics]");
const seconds = Number(secondsArgument ?? 60);
const fixture = tickFixtureOf(fixtureArgument);
const diagnosticsRequested = diagnosticsArgument === "diagnostics";
const save = JSON.parse(readFileSync(file, "utf8")) as GameSaveV1;

const snapshot = <T extends Record<string, number>>(counters: T) => ({ ...counters });
const difference = (after: Record<string, number>, before: Record<string, number>) =>
  Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value - (before[key] ?? 0)])
    .filter(([, value]) => value !== 0));

const hashOf = (island: Island) => hashSettlementState({ runtime: island.runtimeState(),
  settlement: island.simulation.saveState(), world: island.world });

const percentile = (sorted: number[], fraction: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;

/**
 * A16 gate: the bounded snapshot derives a reason for every visible actor; every sixteenth actor
 * also exercises the single-actor API, so both readers stay on the same state-hash proof.
 */
const exerciseUnitDiagnostics = (simulation: Simulation) => {
  const frames = simulation.frames();
  for (let index = 0; index < frames.length; index += DIAGNOSTIC_ACTOR_STRIDE)
    simulation.unitDiagnostics(frames[index]!.uid);
  return simulation.unitDiagnosticsSnapshot(DIAGNOSTIC_LABEL_LIMIT);
};

/** A04: per-pass spans of the 0.5 s scheduler phases, for their p50/p95 (the totals keep only the max). */
const PASS_PHASES = new Set(["schedule.reuse", "schedule.delivery"]);
const trackPassSpans = (inner: TickPhaseRecorder) => {
  const spans = new Map<string, number[]>();
  let open: number[] | null = null, openedAt = 0;
  const close = () => {
    if (open) open.push(performance.now() - openedAt);
    open = null;
  };
  const recorder: TickPhaseRecorder = {
    endTick: () => { close(); inner.endTick(); },
    mark: (phase, detail) => {
      close();
      if (detail === undefined && PASS_PHASES.has(phase)) {
        if (!spans.has(phase)) spans.set(phase, []);
        open = spans.get(phase)!;
        openedAt = performance.now();
      }
      inner.mark(phase, detail);
    }
  };
  return { recorder, spans };
};

/** Index of the slowest entry: tells a cold first pass or tick apart from a steady-state spike. */
const worstIndex = (values: readonly number[]) =>
  values.reduce((worst, value, index) => value > values[worst]! ? index : worst, 0);

const describePasses = (spans: Map<string, number[]>) => Object.fromEntries([...spans].map(([phase, values]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return [phase, { calls: sorted.length, maxMs: Number((sorted.at(-1) ?? 0).toFixed(2)),
    p50Ms: Number(percentile(sorted, .5).toFixed(2)), p95Ms: Number(percentile(sorted, .95).toFixed(2)),
    worstPass: worstIndex(values) }];
}));

/**
 * One run of `seconds`; `profiled` installs the phase recorder and the navigation counters, and
 * (when requested) the A16 read-only unit diagnostics, so the two runs prove on/off parity.
 */
const run = async (profiled: boolean) => {
  const island = await createHeadlessIsland(tickFixtureSave(save, fixture));
  for (const _progress of island.simulation.prewarmCoastalGeometry()) { /* Derived caches only. */ }
  const setup = fixture === "mixed" ? applyMixedFixture(island.simulation) : null;
  const totals = createTickPhaseTotals(() => performance.now());
  const passes = trackPassSpans(totals.recorder);
  const globals = globalThis as { __navigationProfile?: boolean };
  globals.__navigationProfile = profiled;
  clearNavigationProfile();
  setTickPhaseRecorder(profiled ? passes.recorder : null);
  const before = { journal: snapshot(navigationJournalWork), traffic: snapshot(trafficWork) };
  const tickMs: number[] = [];
  const visiblePeople: number[] = [];
  let errors = 0;
  let unitSnapshot: ReturnType<Simulation["unitDiagnosticsSnapshot"]> | undefined;
  try {
    for (let tick = 0; tick < Math.round(seconds / TICK_SECONDS); tick++) {
      const started = performance.now();
      try { island.simulation.update(TICK_SECONDS); } catch { errors++; }
      tickMs.push(performance.now() - started);
      // Outside the measured tick, but every tick: the hash still proves the reads change nothing.
      if (diagnosticsRequested && profiled)
        unitSnapshot = exerciseUnitDiagnostics(island.simulation);
      if (tick % 200 === 0)
        visiblePeople.push(island.simulation.snapshot().actors.filter(actor => actor.visible).length);
    }
  } finally {
    setTickPhaseRecorder(null);
    globals.__navigationProfile = false;
  }
  return { errors, hash: hashOf(island), passes: describePasses(passes.spans), phases: totals.report(), setup, tickMs,
    unitSnapshot, visiblePeople, work: { journal: difference(navigationJournalWork, before.journal),
      navigation: readNavigationProfile().counters, traffic: difference(trafficWork, before.traffic) } };
};

const describePhases = (phases: Record<string, TickPhaseStats>, ticks: number, wallMs: number) =>
  Object.entries(phases).sort(([, a], [, b]) => b.totalMs - a.totalMs).map(([phase, stats]) => ({
    phase,
    msPerTick: Number((stats.totalMs / ticks).toFixed(3)),
    share: `${(100 * stats.totalMs / Math.max(1e-9, wallMs)).toFixed(1)}%`,
    maxMs: Number(stats.maxMs.toFixed(2)),
    calls: stats.calls
  }));

const describeTicks = (tickMs: number[]) => {
  const sorted = [...tickMs].sort((a, b) => a - b);
  const total = tickMs.reduce((sum, value) => sum + value, 0);
  return { maxTickMs: Number(sorted.at(-1)!.toFixed(1)), meanTickMs: Number((total / tickMs.length).toFixed(2)),
    msPerSimulatedSecond: Number((total / seconds).toFixed(1)), p95TickMs: Number(percentile(sorted, .95).toFixed(2)),
    p99TickMs: Number(percentile(sorted, .99).toFixed(2)), worstTick: worstIndex(tickMs) };
};

const plain = await run(false);
const profiled = await run(true);
const { phases, ticks, totalMs } = profiled.phases;
console.log(JSON.stringify({
  fixture,
  setup: profiled.setup,
  simulatedSeconds: seconds,
  unitDiagnosticsSweep: diagnosticsRequested,
  hashUnprofiled: plain.hash,
  hashProfiled: profiled.hash,
  hashIdentical: plain.hash === profiled.hash,
  errors: { plain: plain.errors, profiled: profiled.errors },
  ticksUnprofiled: describeTicks(plain.tickMs),
  ticksProfiled: describeTicks(profiled.tickMs),
  visiblePeopleEvery10s: plain.visiblePeople,
  unitReasons: profiled.unitSnapshot?.counts,
  schedulerPasses: profiled.passes,
  attributedMsPerTick: Number((totalMs / Math.max(1, ticks)).toFixed(3)),
  groups: describePhases(groupTickPhases(groupTickPhases(phases, ":"), "."), ticks, totalMs),
  phases: describePhases(phases, ticks, totalMs).slice(0, 40),
  work: profiled.work
}, null, 2));
