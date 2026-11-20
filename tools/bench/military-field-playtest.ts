import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { FORCES, runFieldBattle, terrains } from "./military-playtest-scenarios";
import { resourcesPath } from "./resources-path";

const seeds = (process.env.SEEDS ?? "7,19").split(",").map(Number);
const output = resourcesPath("settlement-previews", "playtest-2026-10-13", "military");
mkdirSync(output, { recursive: true });
const report: { battles: ReturnType<typeof runFieldBattle>[] } = { battles: [] };
const persist = () => writeFileSync(resolve(output, "simulation.json"), JSON.stringify(report, null, 2));
for (const terrain of terrains.filter(terrain => !process.env.TERRAINS || process.env.TERRAINS.split(",").includes(terrain)))
  for (const composition of (Object.keys(FORCES) as (keyof typeof FORCES)[])
    .filter(composition => !process.env.FORCES || process.env.FORCES.split(",").includes(composition)))
  for (const seed of seeds) {
    const result = runFieldBattle(terrain, composition, seed); report.battles.push(result); persist();
    console.log(JSON.stringify(result));
  }
