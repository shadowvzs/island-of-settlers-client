import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractRun } from "./ab-extract";
import { type AbOptions, parseOptions, USAGE } from "./ab-options";
import { type AbResult, compareRuns, markdownReport, type RunRecord, type SideInfo } from "./ab-report";
import { type RunSide, runOrder } from "./ab-stats";
import {
  type BaseCheckout,
  branchOf,
  commitOf,
  hasLocalChanges,
  LARGE_DRIVE_WORKTREES,
  prepareBase,
  removeBaseWorktree,
  repositoryRoot
} from "./ab-worktree";

/**
 * TOOL-4 A/B perf runner. Runs one headless (or browser-slot) bench alternately on a base checkout and on the lane,
 * extracts metrics by regex or from `BENCH_JSON` lines, and writes the medians, noise bands, deltas and determinism
 * checks as JSON plus a markdown table for the lane receipt. Why and usage: tools/README.md, section TOOL-4.
 *   npx tsx tools/bench/ab-runner.ts --base master --rounds 3 --env PHASES=1 \
 *     --metric 'tick=/\| flat \|[^|]*\|[^|]*\|[^|]*\|[^|]*\| (?<value>[\d.]+)/' -- tools/bench/military-battle-tick.ts
 */

const CLIENT = "island-of-settlers-client";
const BROWSER_SLOT = join(LARGE_DRIVE_WORKTREES, "captures", "browser-slot.sh");

let activeChild: ChildProcess | null = null;
let interrupted = false;

/** `nice -n N [browser-slot.sh] (npx tsx <bench.ts> | <program>) args`: the program is always `nice`. */
const niceArguments = (options: AbOptions) => {
  const [bench = "", ...rest] = options.command;
  const runner = /\.m?tsx?$/.test(bench) ? ["npx", "tsx", bench] : [bench];
  const wrapped = options.browserSlot ? [BROWSER_SLOT, ...runner, ...rest] : [...runner, ...rest];
  return ["-n", String(options.nice), ...wrapped];
};

const runOnce = (options: AbOptions, root: string) => new Promise<{ code: number | null; output: string }>(done => {
  const child = spawn("nice", niceArguments(options), {
    cwd: join(root, CLIENT),
    env: { ...process.env, ...options.env, BENCH_JSON: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  activeChild = child;
  const chunks: string[] = [];
  child.stdout.on("data", chunk => chunks.push(String(chunk)));
  child.stderr.on("data", chunk => chunks.push(String(chunk)));
  const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutSeconds * 1000);
  child.on("close", code => {
    clearTimeout(timer);
    activeChild = null;
    done({ code, output: chunks.join("") });
  });
});

const roots = (laneRoot: string, base: BaseCheckout): Record<RunSide, string> => ({ base: base.root, lane: laneRoot });

const measure = async (options: AbOptions, sideRoots: Record<RunSide, string>, logs: string) => {
  const warmups = Array.from({ length: options.warmup }, (): RunSide[] => ["base", "lane"]).flat();
  const measured = runOrder(options.rounds, options.order);
  const runs: RunRecord[] = [];
  const rounds: Record<RunSide, number> = { base: 0, lane: 0 };
  for (const [index, side] of [...warmups, ...measured].entries()) {
    if (interrupted) break;
    const warm = index < warmups.length;
    const started = performance.now();
    const { code, output } = await runOnce(options, sideRoots[side]);
    const wallSeconds = (performance.now() - started) / 1000;
    const tag = warm ? "warmup" : `round ${rounds[side]}`;
    console.log(`${side} ${tag}: exit ${code}, ${wallSeconds.toFixed(1)} s`);
    const logName = `${String(index).padStart(2, "0")}-${side}-${warm ? "warmup" : "run"}.log`;
    writeFileSync(join(logs, logName), output);
    if (warm) continue;
    runs.push({ ...extractRun(output, options.metrics, options.hashes), exitCode: code, round: rounds[side]++, side,
      wallSeconds });
    if (code !== 0) console.log(output.split("\n").slice(-15).join("\n"));
  }
  return runs;
};

const sideInfo = (root: string, label: string): SideInfo =>
  ({ commit: commitOf(root), label: hasLocalChanges(root) ? `${label} (+uncommitted)` : label, root });

const buildResult = (options: AbOptions, runs: RunRecord[], base: SideInfo, lane: SideInfo): AbResult => {
  const metricNames = [...options.metrics.map(metric => metric.name), "wallSeconds"];
  const withWall = runs.map(run => ({ ...run, numbers: { ...run.numbers, wallSeconds: run.wallSeconds } }));
  const { determinism, metrics } = compareRuns(withWall, metricNames, options.hashes.map(hash => hash.name));
  return {
    base, command: options.command, createdAt: new Date().toISOString(), determinism, env: options.env,
    failedRuns: runs.filter(run => run.exitCode !== 0).length, lane, metrics, nice: options.nice,
    order: options.order, rounds: options.rounds, runs, warmup: options.warmup
  };
};

const writeOutputs = (out: string, result: AbResult, markdown: string) => {
  writeFileSync(join(out, "ab-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(out, "ab-result.md"), markdown);
  console.log(`\nWrote ${join(out, "ab-result.json")} and ab-result.md`);
};

const reportMissing = (runs: readonly RunRecord[]) => {
  const missing = [...new Set(runs.flatMap(run => run.missing))];
  if (missing.length) console.warn(`Extractors without a value in some runs: ${missing.join(", ")}`);
};

const main = async () => {
  const options = parseOptions(process.argv.slice(2));
  if (!options) { console.log(USAGE); return; }
  const laneRoot = repositoryRoot(options.lane);
  const out = options.out ?? join(tmpdir(), `ab-runner-${Date.now()}`);
  const logs = join(out, "logs");
  mkdirSync(logs, { recursive: true });
  const base = prepareBase(laneRoot, options.base, options.worktreeRoot);
  process.on("SIGINT", () => { interrupted = true; activeChild?.kill("SIGTERM"); });
  try {
    console.log(`base ${base.commit.slice(0, 9)} at ${base.root}; lane at ${laneRoot}`);
    const runs = await measure(options, roots(laneRoot, base), logs);
    reportMissing(runs);
    const laneInfo = sideInfo(laneRoot, branchOf(laneRoot));
    const result = buildResult(options, runs, sideInfo(base.root, options.base), laneInfo);
    const markdown = markdownReport(result);
    console.log(`\n${markdown}`);
    writeOutputs(out, result, markdown);
  } finally {
    if (!options.keepWorktree) {
      const removal = removeBaseWorktree(laneRoot, base);
      if (base.owned && !removal.removed) console.warn(`Base worktree kept at ${base.root}: ${removal.reason}`);
    }
  }
};

main().catch(error => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
