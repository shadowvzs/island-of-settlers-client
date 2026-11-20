import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  type A14Baseline, type A14Metrics, type A14SeedMedians, runA14Fixture, seedMediansOf
} from "../../tools/bench/military-a14-metrics";
import { A14_FIXTURES, A14_SEED_OFFSETS, type A14FixtureKey } from "../../tools/bench/military-a14-scenarios";

/**
 * Shared A14 gate helpers (docs/plans/a14-fx-2026-11-13.md): each fixture runs once per test file, and the
 * deterministic metrics are compared with the recorded master baseline. Wall-clock tick times are not gated
 * here (compare them with `tools/bench/military-a14-baseline.ts --compare`).
 */
export const A14_BASELINE_FILE = resolve(__dirname, "../../../docs/plans/a14-baselines/master-2026-11-13f.json");

const runs = new Map<string, A14Metrics>();

/** One fixture run at a seed offset (0: the recorded single run), memoised per test file. */
export const a14Run = (key: A14FixtureKey, seedOffset = 0) => {
  const id = `${key}:${seedOffset}`;
  let metrics = runs.get(id);
  if (!metrics) runs.set(id, metrics = runA14Fixture(A14_FIXTURES[key](seedOffset)));
  return metrics;
};

/** The stuck and churn medians of a fixture over `A14_SEED_OFFSETS` (the no-regression gates). */
export const a14Medians = (key: A14FixtureKey): A14SeedMedians =>
  seedMediansOf(A14_SEED_OFFSETS.map(offset => a14Run(key, offset)));

let baseline: A14Baseline | undefined;
export const a14Baseline = (key: A14FixtureKey) => {
  baseline ??= JSON.parse(readFileSync(A14_BASELINE_FILE, "utf8")) as A14Baseline;
  const metrics = baseline.fixtures[key];
  if (!metrics) throw new Error(`No baseline for ${key}; record it with military-a14-baseline.ts --out`);
  return metrics;
};

/** The baseline's seed medians of a fixture. */
export const a14BaselineMedians = (key: A14FixtureKey) => {
  a14Baseline(key);
  const medians = baseline!.medians?.[key];
  if (!medians) throw new Error(`No seed medians for ${key}; record them with military-a14-baseline.ts --out`);
  return medians;
};

/**
 * Plan §11 A14-1 gate: stuck seconds at most master + 5 % (a 0.5 s floor keeps a quiet fixture's noise out),
 * compared as medians over the seed offsets (main session 2026-11-13: one battle is too chaotic).
 */
export const STUCK_MARGIN = 1.05;
export const STUCK_FLOOR_SECONDS = .5;
/** Plan §11 A14-1 gate: commander orders per minute per squad at most master × 1.5. */
export const CHURN_MARGIN = 1.5;

export const A14_ALL_FIXTURES = Object.keys(A14_FIXTURES) as A14FixtureKey[];

/** Fixtures younger than the master baseline (A14-5): no master metric exists, their own lane's gates apply. */
const WITHOUT_MASTER_BASELINE: readonly A14FixtureKey[] = ["defendPost", "siteRaid"];
export const A14_BASELINED_FIXTURES = A14_ALL_FIXTURES.filter(key => !WITHOUT_MASTER_BASELINE.includes(key));

/**
 * A14 lanes whose gates are switched on. A lane that lands its feature adds its name here (and drops the
 * fixture's `pendingHooks` entry); its gate tests then run. Order: A14-0, A14-1, A14-2, A14-3, A14-4a/b/c, A14-5.
 */
export const A14_LANES_ON: readonly string[] = [
  "A14-0", "A14-1", "A14-2", "A14-3", "A14-4a", "A14-4b", "A14-4c", "A14-5"
];

/** A gate of `lane` is skipped (`it.skipIf(a14Off(lane))`) until the lane is switched on in `A14_LANES_ON`. */
export const a14Off = (lane: string) => !A14_LANES_ON.includes(lane);

/** Every lane after A14-0 changes behaviour on purpose: master's state hashes no longer apply. */
export const a14BehaviourChanged = () => A14_LANES_ON.some(lane => lane !== "A14-0");
