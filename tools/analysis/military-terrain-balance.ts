import { writeFileSync } from "node:fs";

import { MILITARY_PROFILES } from "../../src/shared/balance/military";
import type { MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { BLOCKING, BUILD, type WorldData } from "../../src/shared/world/world-data";
import { battleWinner } from "./helpers";

type Terrain = "open" | "hills" | "choke";
const run = (terrain: Terrain, left: MilitaryTroopType[], right: MilitaryTroopType[], seed: number) => {
  const size = 72;
  const world = { seed, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  if (terrain === "hills") for (let z = 0; z <= size; z++) for (let x = 0; x <= size; x++)
    world.heights[z * (size + 1) + x] = 1.5 * Math.sin(x / 5) * Math.cos(z / 8);
  if (terrain === "choke") for (let z = 12; z < 55; z++) {
    if (z >= 31 && z < 35) continue;
    for (let x = 29; x < 31; x++) {
      world.blocking[z * size + x] = BLOCKING.cliff;
      world.walkCost[z * size + x] = 0;
      for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) world.heights[(z + dz) * (size + 1) + x + dx] = 3;
    }
  }
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialStock: {}, initialSettlers: 0 });
  let spawned = 0;
  for (const [faction, types] of [[1, left], [2, right]] as const) for (const [index, type] of types.entries()) {
    const x = faction === 1 ? 26 - Math.floor(index / 8) * .8 : 34 + Math.floor(index / 8) * .8;
    const id = simulation.spawnMilitaryOpponent({ x, z: 30 + (index % 8 - 3.5) * .8 }, type, index % 3, faction);
    if (id !== null) spawned++;
  }
  if (spawned !== left.length + right.length) throw new Error(`Only ${spawned} soldiers spawned`);
  let leftCount = left.length, rightCount = right.length, tick = 0, arrowsPeak = 0;
  const began = performance.now();
  while (tick++ < 3600 && leftCount && rightCount) {
    simulation.update(.05);
    const soldiers = simulation.militarySoldiers();
    leftCount = soldiers.filter(soldier => soldier.combat?.faction === 1).length;
    rightCount = soldiers.filter(soldier => soldier.combat?.faction === 2).length;
    arrowsPeak = Math.max(arrowsPeak, simulation.militaryArrows().length);
  }
  return { seed, spawned, leftSurvivors: leftCount, rightSurvivors: rightCount,
    winner: battleWinner(leftCount, rightCount, "timeout"),
    seconds: tick * .05, arrowsPeak, cpuMilliseconds: Math.round(performance.now() - began) };
};
if (process.env.MIL_HEAVY_DAMAGE) MILITARY_PROFILES.heavy.damage = Number(process.env.MIL_HEAVY_DAMAGE);
const seeds = Number(process.env.BALANCE_SEEDS ?? 3);
const formations = [
  { left: "shield", right: "heavy", a: Array<MilitaryTroopType>(32).fill("shield"), b: Array<MilitaryTroopType>(32).fill("heavy") },
  { left: "shield", right: "archer", a: Array<MilitaryTroopType>(32).fill("shield"), b: Array<MilitaryTroopType>(32).fill("archer") },
  { left: "heavy", right: "archer", a: Array<MilitaryTroopType>(32).fill("heavy"), b: Array<MilitaryTroopType>(32).fill("archer") },
  { left: "16 shield + 16 archer", right: "heavy", a: Array.from({length:32}, (_, i): MilitaryTroopType => i < 16 ? "shield" : "archer"), b: Array<MilitaryTroopType>(32).fill("heavy") }
];
const rows = [];
for (const terrain of ["open", "hills", "choke"] as const) for (const formation of formations) {
  const outcomes = Array.from({ length: seeds }, (_, seed) => run(terrain, formation.a, formation.b, seed + 1));
  const row = { terrain, left: formation.left, right: formation.right, ranks: "0,1,2 interleaved", outcomes };
  rows.push(row); console.log(JSON.stringify(row));
}
writeFileSync(process.env.MIL_BALANCE_OUTPUT ?? "../docs/archive/dated/military-terrain-balance-results-2026-10-11.json", JSON.stringify({ timestep:.05,
  timeoutSeconds:180, starts: "8 tiles between nearest ranks; 8 columns by 4 rows", profiles:MILITARY_PROFILES,
  mounted:"held; no live cavalry", rows }, null, 2));
