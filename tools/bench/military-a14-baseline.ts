import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  type A14Baseline, type A14Metrics, type A14SeedMedians, runA14Fixture, seedMediansOf
} from "./military-a14-metrics";
import { A14_FIXTURES, A14_SEED_OFFSETS, type A14FixtureKey } from "./military-a14-scenarios";

/**
 * A14 fixture baseline runner (plan §10.2). Runs every A14 battle fixture headless and writes one JSON receipt;
 * with a baseline it prints lane vs baseline for the gated metrics.
 *   record:  npx tsx tools/bench/military-a14-baseline.ts --out ../docs/plans/a14-baselines/master-2026-11-13.json
 *   compare: npx tsx tools/bench/military-a14-baseline.ts --compare ../docs/plans/a14-baselines/master-2026-11-13.json
 * Every fixture also runs at each seed offset (`A14_SEED_OFFSETS`) for the stuck and churn medians; `SEEDS=0`
 * runs offset 0 only. `ONLY=field64,flank` limits the fixtures. Tick times are wall clock (state the machine load); every other
 * number is deterministic and must reproduce exactly on the same commit.
 */

/** Gated metrics compared lane vs baseline (plan §11 gates). */
const COMPARED: readonly (keyof A14Metrics)[] = ["stuckSeconds", "longestStallSeconds", "ordersPerMinutePerSquad",
  "tickP50", "tickP95", "tickMax", "battleSeconds", "probeUnseenReads", "archersBehindFrontShare",
  "overwatchShare", "maxFactionsPerTick"];

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};

const commitOf = () => {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
};

const selected = () => {
  const only = process.env.ONLY?.split(",").map(value => value.trim());
  const keys = Object.keys(A14_FIXTURES) as A14FixtureKey[];
  const unknown = only?.filter(key => !keys.includes(key as A14FixtureKey)) ?? [];
  if (unknown.length) throw new Error(`Unknown fixtures ${unknown.join(",")}; known: ${keys.join(",")}`);
  return keys.filter(key => !only || only.includes(key));
};

const runAll = () => {
  const fixtures: Record<string, A14Metrics> = {}, medians: Record<string, A14SeedMedians> = {};
  const offsets = process.env.SEEDS === "0" ? [0] : A14_SEED_OFFSETS;
  for (const key of selected()) {
    const started = Date.now();
    const runs = offsets.map(offset => runA14Fixture(A14_FIXTURES[key](offset)));
    const metrics = fixtures[key] = runs[0]!;
    medians[key] = seedMediansOf(runs);
    console.log(`${key}: ${((Date.now() - started) / 1000).toFixed(1)} s wall, stuck ${metrics.stuckSeconds} s ` +
      `(median ${medians[key].stuckSeconds}), tick ${metrics.tickP50}/${metrics.tickP95}/${metrics.tickMax} ms, ` +
      `losses ${metrics.losses}, unseen ${metrics.probeUnseenReads}, churn ${metrics.ordersPerMinutePerSquad} ` +
      `(median ${medians[key].ordersPerMinutePerSquad})`);
  }
  return { fixtures, medians };
};

const compare = (
  baseline: A14Baseline, lane: Record<string, A14Metrics>, medians: Record<string, A14SeedMedians>
) => {
  console.log("| Fixture | Metric | Baseline | Lane |");
  console.log("| --- | --- | --- | --- |");
  for (const [key, metrics] of Object.entries(lane)) {
    for (const metric of COMPARED) {
      const before = baseline.fixtures[key]?.[metric], after = metrics[metric];
      if (JSON.stringify(before) !== JSON.stringify(after))
        console.log(`| ${key} | ${metric} | ${JSON.stringify(before)} | ${JSON.stringify(after)} |`);
    }
    const before = baseline.medians?.[key], after = medians[key]!;
    console.log(`| ${key} | median stuck / churn | ${before?.stuckSeconds} / ${before?.ordersPerMinutePerSquad} | ` +
      `${after.stuckSeconds} / ${after.ordersPerMinutePerSquad} |`);
  }
};

const out = argument("--out"), against = argument("--compare");
if (!out && !against) throw new Error("Usage: military-a14-baseline.ts --out <file.json> | --compare <file.json>");
const { fixtures, medians } = runAll();
const receipt: A14Baseline = { commit: commitOf(), fixtures, measured: new Date().toISOString(), medians,
  node: process.version };
if (out) writeFileSync(resolve(out), `${JSON.stringify(receipt, null, 2)}\n`);
if (against) compare(JSON.parse(readFileSync(resolve(against), "utf8")) as A14Baseline, fixtures, medians);
