import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createHeadlessIsland, runHeadlessReplay } from "../../src/app/settlement/headless-replay";
import { type BugReplayReport, replaySettlementCommands } from "../../src/shared/settlement/bug-replay";
import { clearNavigationProfile, readNavigationProfile } from "../../src/shared/settlement/navigation-profile";
import { hashSettlementState } from "../../src/shared/settlement/settlement-state-hash";
import { trafficWork } from "../../src/shared/settlement/settlement-traffic-counters";
import { resourcesPath } from "../bench/resources-path";

const input = process.argv[2] ?? "/home/shadowvzs/Downloads/settlers-reproduction-375650188-1793807634644.json";
const tag = process.argv[3] ?? "baseline";
const bytes = readFileSync(input), report = JSON.parse(bytes.toString("utf8")) as BugReplayReport;
const output = resourcesPath("project-reviews", "build-all-slowdown-2026-11-04");
mkdirSync(output, { recursive: true });
const profile = process.env.PROFILE_NAV === "1";
Object.assign(globalThis, { __navigationProfile: profile });
clearNavigationProfile();
for (const key of Object.keys(trafficWork) as (keyof typeof trafficWork)[]) trafficWork[key] = 0;
const steps: { milliseconds: number; visits: number; searches: number }[] = [];
const commands: { name: string; milliseconds: number }[] = [];
let lastVisits = 0, lastSearches = 0;
const started = performance.now();
const onStep = (milliseconds: number) => {
    steps.push({ milliseconds, visits: trafficWork.groundVisits - lastVisits,
      searches: trafficWork.groundSearches - lastSearches });
    lastVisits = trafficWork.groundVisits; lastSearches = trafficWork.groundSearches;
    console.log(JSON.stringify({ step: steps.length, ...steps.at(-1) }));
  };
const mode = process.env.REPLAY_MODE ?? "runtime";
const actorProgress: object[] = [];
const runtimeReplay = async () => {
  const session = await createHeadlessIsland(report.baseline, false, true);
  const { simulation } = session, update = simulation.update;
  for (const _progress of simulation.prewarmCoastalGeometry()) { /* Derived caches only. */ }
  simulation.update = dt => {
    const at = performance.now(); update(dt); onStep(performance.now() - at);
    const actor = simulation.frames().find(entry => entry.uid === 11);
    if (actor) actorProgress.push({ x: actor.x, z: actor.z, phase: actor.phase, ware: actor.ware });
  };
  const methods = simulation as unknown as Record<string, unknown>;
  for (const name of new Set(report.commands.map(command => command.name))) {
    const method = methods[name];
    if (typeof method !== "function") continue;
    methods[name] = (...args: unknown[]) => {
      const at = performance.now();
      try { return Reflect.apply(method, simulation, args); }
      finally { commands.push({ name, milliseconds: performance.now() - at }); }
    };
  }
  const outcomeDifferences: { at: number; name: string }[] = [];
  const settlement = replaySettlementCommands(report, simulation, command => {
    outcomeDifferences.push({ at: command.at, name: command.name });
  });
  return { settlement, ticks: simulation.tickCount(), outcomeDifferences,
    finalHash: hashSettlementState({ runtime: session.runtimeState(), settlement, world: session.world }) };
};
const result = mode === "scene" ? await runHeadlessReplay(report, {
  hashEveryTicks: 0, mode: "scene", prewarm: true, onStep,
  onCommand: (name, milliseconds) => { commands.push({ name, milliseconds }); }
}) : await runtimeReplay();
const diffs = (a: any, b: any, path = "", out: string[] = []): string[] => {
  if (out.length >= 32) return out;
  if (a === b) return out;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); return out;
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diffs(a[key], b[key], `${path}/${key}`, out);
  return out;
};
const differencePaths = diffs(result.settlement, report.finalSettlement);
const receipt = { input, inputSha256: createHash("sha256").update(bytes).digest("hex"),
  recordedVersion: report.sourceVersion, mode, profile, wallMs: performance.now() - started,
  nativeMs: steps.reduce((sum, step) => sum + step.milliseconds, 0), steps,
  commandMs: commands.reduce((sum, command) => sum + command.milliseconds, 0), commands,
  actorProgress, ticks: result.ticks, finalHash: result.finalHash, work: { ...trafficWork },
  outcomeDifferences: result.outcomeDifferences.map(row => ({ at: row.at, name: row.name })),
  recordedEndpointMatches: differencePaths.length === 0, differencePaths,
  navigation: readNavigationProfile() };
writeFileSync(resolve(output, `${tag}.json`), JSON.stringify(receipt, null, 2));
writeFileSync(resolve(output, `${tag}-settlement.json`), JSON.stringify(result.settlement));
console.log(JSON.stringify({ ...receipt, navigation: undefined, commands: undefined }));
if (createHash("sha256").update(readFileSync(input)).digest("hex") !== receipt.inputSha256)
  throw new Error("Original owner input changed");
