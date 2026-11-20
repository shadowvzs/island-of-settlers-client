import { writeFileSync } from "node:fs";

import { MILITARY_PROFILES } from "../../src/shared/balance/military";
import type { MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";
import { battleWinner } from "./helpers";

const session = (seed: number) => {
  const size = 48;
  const world = { seed, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  return createSettlementSimulation({ world, roads: createRoadNetwork(world), initialStock: {}, initialSettlers: 0 });
};
if (process.env.MIL_ARCHER_DAMAGE) MILITARY_PROFILES.archer.damage = Number(process.env.MIL_ARCHER_DAMAGE);
if (process.env.MIL_HEAVY_SPEED) MILITARY_PROFILES.heavy.speed = Number(process.env.MIL_HEAVY_SPEED);
if (process.env.MIL_ARCHER_INTERVAL) MILITARY_PROFILES.archer.interval = Number(process.env.MIL_ARCHER_INTERVAL);
const seeds = Number(process.env.BALANCE_SEEDS ?? 16);
const fight = (left: MilitaryTroopType[], right: MilitaryTroopType[], rank: number, range: number, seed: number) => {
  const simulation = session(seed);
  for (const [index, type] of left.entries())
    simulation.spawnMilitaryOpponent({ x: type === "archer" && left.length > 1 ? 18.5 : 20,
      z: 20 + (index % 4 - 1.5) * .65 }, type, rank, 1);
  for (const [index, type] of right.entries())
    simulation.spawnMilitaryOpponent({ x: 20 + range + Math.floor(index / 4) * .6, z: 20 + (index % 4 - 1.5) * .65 }, type, rank, 2);
  let leftCount = left.length, rightCount = right.length, tick = 0;
  while (tick++ < 2400 && leftCount && rightCount) {
    simulation.update(.05);
    const soldiers = simulation.militarySoldiers();
    leftCount = soldiers.filter(soldier => soldier.combat?.faction === 1).length;
    rightCount = soldiers.filter(soldier => soldier.combat?.faction === 2).length;
  }
  return { winner: battleWinner(leftCount, rightCount, "draw"),
    seconds: tick * .05, leftSurvivors: leftCount, rightSurvivors: rightCount };
};
const rows = [];
for (const rank of [0, 1, 2]) for (const range of [2, 6, 8])
  for (const [left, right] of [["shield", "heavy"], ["shield", "archer"], ["heavy", "archer"]] as const) {
    const outcomes = Array.from({length:seeds}, (_, seed) => fight([left], [right], rank, range, seed + 1));
    rows.push({ left, right, rank:rank+1, range, seeds,
      leftWins:outcomes.filter(outcome=>outcome.winner==="left").length,
      rightWins:outcomes.filter(outcome=>outcome.winner==="right").length,
      draws:outcomes.filter(outcome=>outcome.winner==="draw").length });
  }
const formations = [];
for (const rank of [0, 1, 2]) {
  const outcomes = Array.from({length:seeds}, (_, seed) =>
    fight(["shield","shield","shield","shield","archer","archer","archer","archer"],
      Array<MilitaryTroopType>(8).fill("heavy"), rank, 8, seed + 1));
  formations.push({left:"4 shield + 4 archer",right:"8 heavy",rank:rank+1,seeds,
    leftWins:outcomes.filter(outcome=>outcome.winner==="left").length,
    rightWins:outcomes.filter(outcome=>outcome.winner==="right").length,
    draws:outcomes.filter(outcome=>outcome.winner==="draw").length});
}
const report = { profiles:MILITARY_PROFILES, timestep:.05, timeoutSeconds:120,
  mounted:"held; no cavalry live results", rows, formations };
writeFileSync(process.env.MIL_BALANCE_OUTPUT ?? "../docs/archive/dated/military-live-balance-results-2026-10-11.json", JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
