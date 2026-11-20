import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runHeadlessReplay } from "../../src/app/settlement/headless-replay";
import type { BugReplayReport } from "../../src/shared/settlement/bug-replay";
import { resourcesPath } from "../bench/resources-path";

const file = process.argv[2];
assert(file, "Supply the owner reproduction file");
const report = JSON.parse(readFileSync(file, "utf8")) as BugReplayReport;
let maximumStep = 0, maximumCommand = 0;
const commands: { name: string; ms: number }[] = [];
const result = await runHeadlessReplay(report, { hashEveryTicks: 0, mode: "scene", prewarm: true,
  onStep: ms => { maximumStep = Math.max(maximumStep, ms); },
  onCommand: (name, ms) => { commands.push({ name, ms }); maximumCommand = Math.max(maximumCommand, ms); } });
const output = resourcesPath("project-reviews", "follow-ups-2026-10-29");mkdirSync(output, { recursive: true });
const name = file.includes("1793220671198") ? "build-all" : "expedition";
const summary = { file, maximumStep, maximumCommand, commands, ticks: result.ticks,
  outcomeDifferences: result.outcomeDifferences, finalHash: result.finalHash,
  founding: result.settlement.naval.founding, ships: result.settlement.naval.fleet.ships.map(ship =>
    ({ id: ship.id, phase: ship.phase, cargo: ship.cargo })) };
writeFileSync(resolve(output, `${name}-headless.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
