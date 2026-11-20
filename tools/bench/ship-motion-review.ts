import { mkdirSync, writeFileSync } from "node:fs";

import {
  measureShipScenario, SHIP_SCENARIOS, type ShipMotionMetrics
} from "../../tests/helpers/ship-motion-scenarios";
import { resourcesPath } from "./resources-path";

/**
 * Ship-motion receipt: every shared ship scenario with slip, turn rate, overlaps, shore contact,
 * blocked time, path ratio and CPU.
 * Usage: npx tsx tools/bench/ship-motion-review.ts [label]
 */
const label = process.argv[2] ?? new Date().toISOString().slice(0, 10);

const SCENARIOS = SHIP_SCENARIOS;
const round = (value: number, digits = 2) => +value.toFixed(digits);
const columns: Array<[string, (metrics: ShipMotionMetrics) => number | string]> = [
  ["done", metrics => metrics.completed ? `${round(metrics.seconds, 0)} s` : "NO"],
  ["max slip °", metrics => round(metrics.maxSlipDeg, 1)],
  ["slip %", metrics => round(metrics.slipRatio * 100)],
  ["max turn rad/s", metrics => round(metrics.maxTurnRate)],
  ["min radius", metrics => round(metrics.minTurnRadius, 1)],
  ["max accel", metrics => round(metrics.maxAcceleration, 1)],
  ["pivot s", metrics => round(metrics.inPlaceTurnSeconds, 1)],
  ["hull contact ticks", metrics => metrics.hullContactTicks],
  ["envelope ticks", metrics => metrics.envelopeTicks],
  ["shore ticks", metrics => metrics.shoreTicks],
  ["blocked s", metrics => round(metrics.blockedSeconds, 1)],
  ["stranded s", metrics => round(metrics.strandedSeconds, 1)],
  ["path ratio", metrics => round(metrics.pathRatio)],
  ["CPU ms/tick (max)", metrics => `${round(metrics.cpuMeanMs, 3)} (${round(metrics.cpuMaxMs, 1)})`]
];

const results = SCENARIOS.map(([name, build]) => ({ metrics: measureShipScenario(build()), name }));
const header = `| scenario | ${columns.map(([title]) => title).join(" | ")} |`;
const divider = `|${" --- |".repeat(columns.length + 1)}`;
const rows = results.map(({ metrics, name }) =>
  `| ${name} | ${columns.map(([, value]) => value(metrics)).join(" | ")} |`);
console.log([header, divider, ...rows].join("\n"));
const folder = resourcesPath("ship-motion");
mkdirSync(folder, { recursive: true });
writeFileSync(`${folder}/metrics-${label}.json`, JSON.stringify(results, null, 2));
