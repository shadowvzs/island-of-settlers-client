import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { MILITARY_AI_MODES, type MilitaryAiMode } from "../../src/shared/settlement/military-ai-mode";
import { type MotionMetrics, runMotionScenario } from "./military-motion-metrics";
import { crossingScenario, fieldBattleScenario, gateScenario, siegeScenario } from "./military-motion-scenarios";
import { resourcesPath } from "./resources-path";

/**
 * Benchmark of the military AI modes (docs/archive/dated/military-motion-2026-10-13.md section 8): the same four
 * scenarios per mode (64 vs 64 field battle, siege queue, gate march, crossing columns).
 * Run: `npx tsx tools/bench/military-mode-benchmark.ts` (`MODES=current,formations` and
 * `ONLY=field,gate` limit it). Writes a new current-build report beneath resources/project-reviews.
 * The historical in-game benchmark archive is immutable. This measures synthetic headless fixtures,
 * not browser, rendering or ordinary player acceptance. OUTPUT can select a different report path.
 */
const SCENARIOS = {
  crossing: () => crossingScenario(),
  field: () => fieldBattleScenario(64, 90),
  gate: () => gateScenario(),
  siege: () => siegeScenario()
} as const;

export interface ModeBenchmarkRow {
  mode: MilitaryAiMode;
  scenario: string;
  tick: string;
  collisions: number;
  stuckSeconds: number;
  pathRatio: number;
  /** Seconds to win (battles) or to arrive (marches); null: not within the run. */
  outcomeSeconds: number | null;
  losses: string;
}

const rowOf = (mode: MilitaryAiMode, scenario: string, metrics: MotionMetrics): ModeBenchmarkRow => ({
  collisions: metrics.contactsPerSecond, losses: metrics.losses, mode,
  outcomeSeconds: metrics.decidedSeconds ?? metrics.arrivalSeconds, pathRatio: metrics.pathRatio, scenario,
  stuckSeconds: metrics.stuckSeconds, tick: `${metrics.tickP50} / ${metrics.tickP95} / ${metrics.tickMax}`
});

const requestedModes = process.env.MODES?.split(",").map(value => value.trim());
const modes = MILITARY_AI_MODES.map(mode => mode.value).filter(mode => !requestedModes || requestedModes.includes(mode));
const only = process.env.ONLY?.split(",").map(value => value.trim());
if (!modes.length || requestedModes?.some(mode => !MILITARY_AI_MODES.some(entry => entry.value === mode)))
  throw new Error(`MODES must name ${MILITARY_AI_MODES.map(mode => mode.value).join(",")}`);
if (only?.some(name => !(name in SCENARIOS))) throw new Error("ONLY must name crossing,field,gate,siege");
const measured = new Date().toISOString();
const output = resolve(process.env.OUTPUT ?? resourcesPath("project-reviews", "military-ai-modes",
  `headless-${measured.replace(/[:.]/g, "-")}.json`));
if (output === resolve("src/app/settlement/military-mode-benchmark.json"))
  throw new Error("The historical benchmark archive must not be overwritten");
const rows: ModeBenchmarkRow[] = [];
console.log("| Mode | Scenario | Tick p50 / p95 / max ms | Contacts/s | Stuck s | Path ratio | Win / arrival s | Losses |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const mode of modes) for (const [key, create] of Object.entries(SCENARIOS)) {
  if (only && !only.includes(key)) continue;
  const scenario = create();
  if (!scenario.simulation.setMilitaryAiMode(mode) || scenario.simulation.militaryAiMode() !== mode)
    throw new Error(`Military mode ${mode} was not accepted`);
  const row = rowOf(mode, scenario.name, runMotionScenario(scenario).metrics);
  rows.push(row);
  console.log(`| ${mode} | ${row.scenario} | ${row.tick} | ${row.collisions} | ${row.stuckSeconds} | ` +
    `${row.pathRatio} | ${row.outcomeSeconds ?? "-"} | ${row.losses} |`);
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ measured, rows,
  scope: "Synthetic headless military scenarios; not browser or ordinary-user gameplay acceptance",
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingTreeDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
  node: process.version, platform: process.platform, modes, scenarios: only ?? Object.keys(SCENARIOS)
}, null, 2)}\n`);
console.log(`Saved current-run measurements: ${output}`);
