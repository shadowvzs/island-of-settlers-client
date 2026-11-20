import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { FORMATS, isCurrentFormat } from "../../../island-of-settlers-shared/src/formats";
import { runHeadlessReplay } from "../../src/app/settlement/headless-replay";
import type { BugReplayReport } from "../../src/shared/settlement/bug-replay";
import { isSafeTree, SAVE_TREE_DEPTH } from "../../src/shared/settlement/save-validation";
import { resourcesPath } from "../bench/resources-path";
import { gameSourceFolders, sourceFingerprints } from "../source-version-plugin";

const file = process.argv[2];
assert(
  file,
  "Usage: npx tsx tools/analysis/replay-bug-report.ts report.json [--allow-version-mismatch]"
);
assert(statSync(file).size <= 64 * 1024 * 1024, "Replay file exceeds 64 MiB");
const report = JSON.parse(readFileSync(file, "utf8")) as BugReplayReport;
assert(isSafeTree(report, SAVE_TREE_DEPTH.bugReplay), "Invalid report values");
assert(
  isCurrentFormat(report, FORMATS.bugReplay),
  "Unsupported report"
);
const root = resolve(import.meta.dirname, "../..");
const workerRoot = resolve(root, process.env.WORKER_REPO ?? "../island-of-settlers-worker-generation");
const { sourceVersion, versions } = sourceFingerprints(gameSourceFolders(root, workerRoot));
assert(
  process.argv.includes("--allow-version-mismatch") || report.sourceVersion === sourceVersion,
  "Code changed since this recording; use --allow-version-mismatch for an intentional comparison"
);
const { elapsed, outcomeDifferences, seed, settlement: result } = await runHeadlessReplay(report,
  { hashEveryTicks: 0, mode: "scene" });
/**
 * `navigationRecovery` is the stalled-walker watchdog cache: a replay may rebuild it with a
 * different elapsed/revision value without changing any actor position, cargo, ownership or
 * production outcome. Compare gameplay state without it; keep the raw mismatch visible.
 */
const comparableSettlement = (value: unknown) => {
  const copy = structuredClone(value) as { actors?: { navigationRecovery?: unknown }[] };
  for (const actor of copy.actors ?? []) delete actor.navigationRecovery;
  return copy;
};
const rawEndpointMatches = JSON.stringify(result) === JSON.stringify(report.finalSettlement);
const endpointMatches =
  JSON.stringify(comparableSettlement(result)) === JSON.stringify(comparableSettlement(report.finalSettlement));
const output = resourcesPath("project-reviews", "replays");
mkdirSync(output, { recursive: true });
writeFileSync(
  resolve(output, `replay-${seed}-${createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 12)}.json`),
  JSON.stringify(
    {
      sourceVersion,
      originalVersion: report.sourceVersion,
      versions,
      versionDifferences: Object.keys(versions).filter(key =>
        report.versions?.[key] !== versions[key as keyof typeof versions]),
      gaps: report.gaps,
      diagnostics: report.diagnostics,
      elapsed,
      commands: report.commands.length,
      limited: report.limited,
      outcomeDifferences,
      endpointMatches,
      rawEndpointMatches,
      ignoredEndpointFields: ["actors[].navigationRecovery"],
      settlement: result
    },
    null,
    2
  )
);
console.log(
  `Replayed ${report.commands.length} settlement commands across ${elapsed.toFixed(2)} seconds.`
);
console.log(
  report.scene ? "Recorded wildlife/resource observations applied. Island/editor boundaries remain explicit in report.gaps." :
    "Legacy report: scene observations were not recorded; wildlife/resource differences may remain."
);

console.log(JSON.stringify({ endpointMatches, rawEndpointMatches, outcomeDifferences: outcomeDifferences.length,
  ignoredEndpointFields: ["actors[].navigationRecovery"], gaps: report.gaps ?? [], limited: report.limited }));
if (sourceVersion === report.sourceVersion && report.scene && !report.limited)
  assert(endpointMatches && !outcomeDifferences.length, "Same-build replay diverged; inspect the saved comparison");
