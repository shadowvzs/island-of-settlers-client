import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

import { MILITARY_PROFILES, MILITARY_RECRUIT_COSTS } from "../../src/shared/balance/military";
import type { MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import { PRODUCTION_RULES } from "../../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";
import { battleWinner } from "./helpers";

type Foot = Exclude<MilitaryTroopType, "cavalry">;
const seeds = Number(process.env.BALANCE_SEEDS ?? 4);
const economy = Object.fromEntries((["shield", "heavy", "archer"] as const).map(type => {
  const weapons = type === "shield" ? 2 : 1;
  return [type, { netRecruitment: MILITARY_RECRUIT_COSTS[type], population: 1,
    rawInputs: { grain: 1, water: 1, ironOre: weapons, coal: weapons * 2 },
    workerSeconds: PRODUCTION_RULES[23]!.seconds + weapons * (PRODUCTION_RULES[26]!.seconds + PRODUCTION_RULES[24]!.seconds),
    veteranCoinsWithoutBatchDiscount: 2 }];
}));
const run = (left: Foot[], right: Foot[], columns: number, veteran: boolean, hills: boolean, seed: number) => {
  const size = 96;
  const world = { seed, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  if (hills) for (let z = 0; z <= size; z++) for (let x = 0; x <= size; x++)
    world.heights[z * (size + 1) + x] = 1.5 * Math.sin(x / 5) * Math.cos(z / 8);
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialStock: {}, initialSettlers: 0 });
  for (const [faction, army] of [[1, left], [2, right]] as const) for (const [index, type] of army.entries()) {
    const point = { x: faction === 1 ? 38 - Math.floor(index / columns) * .8 : 46 + Math.floor(index / columns) * .8,
      z: 48 + (index % columns - (columns - 1) / 2) * .8 };
    assert.notEqual(simulation.spawnMilitaryOpponent(point, type, veteran ? 2 : index % 3, faction), null);
  }
  for (const faction of [1, 2]) {
    const ids = simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === faction).map(soldier => soldier.actor);
    simulation.commandMilitaryOpponent(ids, { x: faction === 1 ? 46 : 38, z: 48 }, faction);
  }
  let a = left.length, b = right.length, ticks = 0;
  const began = performance.now();
  while (a && b && ticks < 4800) {
    simulation.update(.05); ticks++;
    const soldiers = simulation.militarySoldiers();
    a = soldiers.filter(soldier => soldier.combat?.faction === 1).length;
    b = soldiers.filter(soldier => soldier.combat?.faction === 2).length;
  }
  return { seed, leftSurvivors: a, rightSurvivors: b,
    winner: battleWinner(a, b, "timeout"),
    seconds: ticks * .05, cpuMilliseconds: Math.round(performance.now() - began) };
};
const army = (type: Foot, size: number) => Array<Foot>(size).fill(type);
const scenarios = [
  { label: "64 shield vs 64 heavy", a: army("shield", 64), b: army("heavy", 64) },
  { label: "64 heavy vs 64 archer", a: army("heavy", 64), b: army("archer", 64) },
  { label: "64 shield vs 64 archer", a: army("shield", 64), b: army("archer", 64) },
  { label: "32 shield + 32 archer vs 64 heavy", a: [...army("shield", 32), ...army("archer", 32)], b: army("heavy", 64) }
];
const rows = [];
for (const scenario of scenarios) for (const columns of [8, 16]) for (const veteran of [false, true]) {
  const hills = columns === 8;
  const outcomes = Array.from({ length: seeds }, (_, seed) => run(scenario.a, scenario.b, columns, veteran, hills, seed + 1));
  rows.push({ label: scenario.label, columns, terrain: hills ? "hills" : "open", ranks: veteran ? "all tier 3" : "mixed tiers", outcomes });
  console.log(scenario.label, columns, veteran, outcomes.map(outcome => outcome.winner));
}
// Same total production labour, distinct population/ore budgets explicitly recorded.
const labourBudget = 2560;
for (const right of ["heavy", "archer"] as const) {
  const count = Math.floor(labourBudget / economy[right]!.workerSeconds);
  const outcomes = Array.from({ length: seeds }, (_, seed) => run(army("shield", 32), army(right, count), 16, true, false, seed + 1));
  rows.push({ label: `Labour budget: 32 shield vs ${count} ${right}`, columns: 16, terrain: "open", ranks: "all tier 3", outcomes });
  console.log("labour budget", right, count, outcomes.map(outcome => outcome.winner));
}
const report = { profiles: MILITARY_PROFILES, seeds, economy, labourBudget,
  notes: ["Actual simulation, 0.05s steps, 240s timeout, 8-tile initial front separation",
    "Armory outputs consume iron+coal separately; smelting consumes ironOre+coal",
    "Worker seconds are production labour, not elapsed settlement throughput or road travel",
    "Equal labour armies consume different population and ore; this is a sensitivity test, not a universal currency",
    "Coins can promote one soldier per distinct eligible rank per batch; 2 coins per recruit is the homogeneous upper cost"], rows };
writeFileSync("../docs/archive/dated/military-economy-formation-balance-2026-10-11.json", JSON.stringify(report, null, 2));
