import { expect } from "vitest";

import { ARCHER_SCAFFOLD_SITE, placedBanditCamp } from "../../src/render-common/buildings/bandit-camp-plan";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { OPEN_SCAFFOLD_STRUCTURE_HP } from "../../src/shared/balance/military";
import { militaryHealth, type MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";

import { editSavedOccupancy } from "./saved-occupancy";

export interface ArcherScaffoldOptions {
  /** Player soldiers, called out to `rally` before the scaffold is built. */
  attackers: readonly { rank: number; type: MilitaryTroopType }[];
  /** Scaffold archers (rank each). */
  archers?: readonly number[];
  rally?: { x: number; z: number };
  structureHp?: number;
}

const flatWorld = (size: number) => ({
  seed: 9,
  cellsX: size,
  cellsZ: size,
  seaLevel: -1,
  start: { x: 5.5, z: 5.5 },
  heights: new Float32Array((size + 1) ** 2),
  blocking: new Uint8Array(size ** 2),
  walkCost: new Uint8Array(size ** 2).fill(10),
  buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
  oreAmount: new Uint8Array(size ** 2),
  mineZone: new Uint16Array(size ** 2),
  mineZones: [],
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
}) as unknown as WorldData;

/** A flat island with player soldiers in the field and a hostile open archer scaffold at (20, 20). */
export const createArcherScaffoldFixture = ({
  archers = [0], attackers, rally = { x: 20, z: 30 }, structureHp = OPEN_SCAFFOLD_STRUCTURE_HP
}: ArcherScaffoldOptions) => {
  const world = flatWorld(40);
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({
    world, roads, initialSettlers: 20, initialStock: { planks: 80, stone: 80 }, canWorkerEnterPlot: () => true
  });
  simulation.receiveTroops(attackers.map(({ rank, type }) => ({ type, rank, hp: militaryHealth(type, rank) })));
  simulation.callOutMilitary([...new Set(attackers.map(({ type }) => type))], rally);
  for (let second = 0; second < 90; second++) simulation.update(1);
  const [width, depth] = getBuildingDefinition(4).gridFootprint;
  const placed = simulation.placeBuilding(4, 20 + (width % 2) / 2, 20 + (depth % 2) / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const saved = simulation.saveState(), site = saved.buildings.find(building => building.uid === placed.building!.uid)!;
  Object.assign(site, { x: 20, z: 20, bandit: ARCHER_SCAFFOLD_SITE, militaryFaction: 1, construction: 1, required: {},
    hasDoor: false }, placedBanditCamp(ARCHER_SCAFFOLD_SITE, 20, 20));
  // The watchtower placed above claimed a larger plot: the scaffold holds only its own cells.
  editSavedOccupancy(saved, grid => {
    for (let z = 14; z < 26; z++) for (let x = 14; x < 26; x++)
      grid[z * 40 + x] = Math.abs(x + .5 - site.x) < site.width / 2 &&
        Math.abs(z + .5 - site.z) < site.depth / 2 ? 1 : 0;
  });
  const structure = { hp: structureHp, maximum: structureHp };
  saved.military!.combat!.doors.push({ building: site.uid, faction: 1, hp: 200, maximum: 200, structure });
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  const guards = archers.map((rank, index) => simulation.spawnMilitaryOpponent({ x: 17 - index * .6, z: 20 },
    "archer", rank)!);
  expect(simulation.registerMilitaryGarrison(site.uid, guards, 1, 200, structure)).toBe(true);
  const players = simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === 0)
    .map(soldier => soldier.actor);
  return { guards, players, simulation, site };
};

export type ArcherScaffoldFixture = ReturnType<typeof createArcherScaffoldFixture>;

export const soldierOf = ({ simulation }: Pick<ArcherScaffoldFixture, "simulation">, actor: number) =>
  simulation.militarySoldiers().find(soldier => soldier.actor === actor);

export const scaffoldStructure = ({ simulation, site }: Pick<ArcherScaffoldFixture, "simulation" | "site">) =>
  simulation.militaryDoors().find(door => door.building === site.uid)?.structure;
