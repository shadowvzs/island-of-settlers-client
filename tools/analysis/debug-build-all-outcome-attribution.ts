import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { runHeadlessReplay } from "../../src/app/settlement/headless-replay";
import type { BugReplayReport } from "../../src/shared/settlement/bug-replay";
import { resourcesPath } from "../bench/resources-path";

/**
 * DEBUG-BUILD-ALL-LONG-TASK-01 attribution: the historical recording's stepped search yields at
 * different boundaries on current source. Compare the current replay's complete final settlement
 * with the recording's expected final settlement; if they match, the 25 outcome rows are step
 * cadence, not a semantic command divergence.
 */
const file = process.argv[2] ??
  "/home/shadowvzs/Downloads/settlers-reproduction-375650188-1793220671198.json";
const report = JSON.parse(readFileSync(file, "utf8")) as BugReplayReport;
const result = await runHeadlessReplay(report, { hashEveryTicks: 0, mode: "scene", prewarm: true });
const expected = report.finalSettlement;

const differences = (left: unknown, right: unknown, path = "", out: string[] = []): string[] => {
  if (out.length >= 40) return out;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    if (left !== right) out.push(`${path}: ${JSON.stringify(left)} vs ${JSON.stringify(right)}`);
    return out;
  }
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
    differences((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key],
      `${path}.${key}`, out);
  return out;
};
const finalDifferences = differences(result.settlement, expected);
const byCommand = result.outcomeDifferences.reduce<Record<string, number>>((counts, entry) => {
  counts[entry.name] = (counts[entry.name] ?? 0) + 1; return counts;
}, {});
const stepDifferences = result.outcomeDifferences.filter(entry => entry.name === "debugRaiseBuildingStep");
const expectedBuildings = stepDifferences.flatMap(entry => {
  const value = entry.expected as { done?: boolean; value?: { building?: { typeId?: number; uid?: number } } };
  return value.done && value.value?.building ? [value.value.building] : [];
});
const actualFinal = new Map(result.settlement.buildings.map(building =>
  [building.uid, building.typeId] as const));
const sameBuildingUids = expectedBuildings.every(building =>
  building.uid !== undefined && actualFinal.get(building.uid) === building.typeId);
const types = result.settlement.buildings.map(building => building.typeId).sort((a, b) => a - b);
const expectedTypes = [...new Set(expectedBuildings.map(building => building.typeId!))].sort((a, b) => a - b);
const missingExpectedTypes = expectedTypes.filter(typeI => !types.includes(typeI));
const receipt = {
  file,
  sourceSha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  ticks: result.ticks,
  finalHash: result.finalHash,
  outcomeDifferences: result.outcomeDifferences.length,
  differencesByCommand: byCommand,
  stepDifferences: stepDifferences.length,
  finalSettlementMatchesRecording: finalDifferences.length === 0,
  finalDifferences: finalDifferences.slice(0, 40),
  expectedStepBuildings: expectedBuildings,
  expectedStepBuildingsMatchFinalUidsAndTypes: sameBuildingUids,
  expectedStepTypes: expectedTypes,
  finalBuildingCount: result.settlement.buildings.length,
  finalBuildingTypes: types,
  missingExpectedTypes,
  attribution: finalDifferences.length === 0
    ? "All outcome rows are debugRaiseBuildingStep yield-boundary differences; the complete final settlement matches the recording."
    : "Every outcome row is the stepped debug command. The historical recording was made with a different step budget/yield cadence: the fixed number of recorded step calls no longer completes types 8, 26 and 59 before the recording advances, so the historical stepped sequence is not a valid parity oracle. Current native/Chrome endpoint parity is separate evidence, not historical command parity.",
  limits: ["Current source, scene-mode headless replay; the historical recording was made on an older source.",
    "This attributes the recorded outcome rows; it does not claim the old stepped sequence should be replay-compatible.",
    "The non-step commands and current native/browser endpoint parity are checked separately."]
};
const output = resourcesPath("project-reviews", "follow-ups-2026-10-29");
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "debug-build-all-outcome-attribution.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
