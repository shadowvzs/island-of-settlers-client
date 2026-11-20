import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

import { FORMATS, isCurrentFormat } from "../../../island-of-settlers-shared/src/formats";
import {
  type HeadlessReplayMode, type HeadlessReplayOptions, type HeadlessReplayResult, type ReplayHashCheckpoint,
  runHeadlessReplay
} from "../../src/app/settlement/headless-replay";
import type { BugReplayReport } from "../../src/shared/settlement/bug-replay";
import { isSafeTree, SAVE_TREE_DEPTH } from "../../src/shared/settlement/save-validation";
import { type BrowserEngine, launchEngine, startDevServer } from "../bench/browser";

/**
 * BACKEND-03 determinism proof: replays one bug-replay recording headless in Node and in a browser
 * (the same module served by Vite: Chrome by default, or Firefox / WebKit, D4.6) and compares the state hash
 * sequences.
 *
 *   npx tsx tools/analysis/replay-hash-compare.ts recording.json [--every 200] [--mode runtime|scene]
 *     [--engine chromium|firefox|webkit]
 */
type HashSummary = Pick<HeadlessReplayResult, "checkpoints" | "elapsed" | "finalHash" | "ticks">;

const HEADLESS_REPLAY_MODULE = "/src/app/settlement/headless-replay.ts";

const argument = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
};

const readRecording = (file: string) => {
  assert(statSync(file).size <= 64 * 1024 * 1024, "Recording exceeds 64 MiB");
  const text = readFileSync(file, "utf8");
  const report = JSON.parse(text) as BugReplayReport;
  assert(isSafeTree(report, SAVE_TREE_DEPTH.bugReplay), "Invalid recording values");
  assert(isCurrentFormat(report, FORMATS.bugReplay), "Unsupported recording");
  return { report, text };
};

const summarize = ({ checkpoints, elapsed, finalHash, ticks }: HeadlessReplayResult): HashSummary =>
  ({ checkpoints, elapsed, finalHash, ticks });

const runInNode = async (report: BugReplayReport, options: HeadlessReplayOptions) => {
  const started = performance.now();
  const summary = summarize(await runHeadlessReplay(report, options));
  return { milliseconds: performance.now() - started, summary };
};

/** The page imports the same source module through Vite: the browser's engine runs it, not Node's. */
const runInBrowser = async (text: string, options: HeadlessReplayOptions, engine: BrowserEngine) => {
  const { server, url } = await startDevServer({ unlockAll: false });
  const browser = await launchEngine(engine);
  try {
    const page = await browser.newPage();
    // Any served URL gives the page the dev server's origin without booting the game.
    await page.goto(new URL("@vite/client", url).href);
    return await page.evaluate(async ({ modulePath, options, text }) => {
      type Module = typeof import("../../src/app/settlement/headless-replay");
      const module = await import(/* @vite-ignore */ modulePath) as Module;
      const started = performance.now();
      const { checkpoints, elapsed, finalHash, ticks } = await module.runHeadlessReplay(JSON.parse(text), options);
      return { milliseconds: performance.now() - started, summary: { checkpoints, elapsed, finalHash, ticks } };
    }, { modulePath: HEADLESS_REPLAY_MODULE, options, text });
  } finally {
    await browser.close();
    await server.close();
  }
};

const firstDivergence = (node: readonly ReplayHashCheckpoint[], browser: readonly ReplayHashCheckpoint[]) => {
  const length = Math.max(node.length, browser.length);
  for (let index = 0; index < length; index++) {
    const nodeCheckpoint = node[index], browserCheckpoint = browser[index];
    if (nodeCheckpoint?.tick === browserCheckpoint?.tick && nodeCheckpoint?.hash === browserCheckpoint?.hash) continue;
    return { browser: browserCheckpoint, index, node: nodeCheckpoint };
  }
  return null;
};

/** The live browser's end state (recorded) against the headless one: wildlife/clock inputs differ. */
const recordedEndpointMatches = async (report: BugReplayReport, mode: HeadlessReplayMode) => {
  const replay = await runHeadlessReplay(report, { hashEveryTicks: 0, mode });
  return JSON.stringify(replay.settlement) === JSON.stringify(report.finalSettlement);
};

const file = process.argv[2];
assert(file, "Usage: npx tsx tools/analysis/replay-hash-compare.ts recording.json [--every N] [--mode runtime|scene]");
const mode = argument("--mode", "runtime") as HeadlessReplayMode;
assert(mode === "runtime" || mode === "scene", "--mode is runtime or scene");
const options: HeadlessReplayOptions = { hashEveryTicks: Number(argument("--every", "200")), mode };
assert(Number.isSafeInteger(options.hashEveryTicks) && options.hashEveryTicks > 0, "--every is a positive tick count");
const engine = argument("--engine", "chromium") as BrowserEngine;
assert(["chromium", "firefox", "webkit"].includes(engine), "--engine is chromium, firefox or webkit");
const { report, text } = readRecording(file);
const node = await runInNode(report, options);
const repeat = await runInNode(report, options);
const browser = await runInBrowser(text, options, engine);
const divergence = firstDivergence(node.summary.checkpoints, browser.summary.checkpoints);
const nodeRepeatable = JSON.stringify(node.summary) === JSON.stringify(repeat.summary);
console.log(JSON.stringify({
  browserMs: Math.round(browser.milliseconds), checkpoints: node.summary.checkpoints.length, engine,
  divergence, finalHashes: { browser: browser.summary.finalHash, node: node.summary.finalHash },
  match: !divergence &&
    node.summary.finalHash === browser.summary.finalHash, mode, nodeMs: Math.round(node.milliseconds),
  nodeRepeatable, recordedEndpointMatches: await recordedEndpointMatches(report, mode), ticks: node.summary.ticks
}, null, 2));
