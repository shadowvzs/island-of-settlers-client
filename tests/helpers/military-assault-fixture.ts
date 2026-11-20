import { expect } from "vitest";

import type { MapScript } from "../../../island-of-settlers-shared/src/script/types/script";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { militaryHealth, type MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";

/** Flat 64² world with a road-connected, finished player military building (CAT-CAPTURE, MIL-ASSAULT). */
export type AssaultSimulation = ReturnType<typeof createSettlementSimulation>;
const SIZE = 64;
export const ENEMY = 1;

/** `script`: an optional map script the island runs (TRG3a event tests). */
const flatWorld = (script?: MapScript) => ({ seed: 9, ...(script ? { script } : {}), cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 16.5, z: 14.5 },
  heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
  walkCost: new Uint8Array(SIZE ** 2).fill(10), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
  oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
  props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(),
    z: new Float32Array() }
}) as unknown as WorldData;

export const troops = (type: MilitaryTroopType, count: number) =>
  Array.from({ length: count }, () => ({ hp: militaryHealth(type, 0), rank: 0, type }));

/** A road-connected, finished player building of `typeId`, manned from the headquarters' reserves. */
export const mannedFixture = (typeId: number, script?: MapScript) => {
  const world = flatWorld(script);
  let simulation: AssaultSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  const sim = createSettlementSimulation({ canWorkerEnterPlot: () => true, initialSettlers: 10,
    initialStock: { planks: 80, stone: 80 }, roads, world });
  simulation = sim;
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  const placed = sim.placeBuilding(typeId, 26 + width % 2 / 2, 24 + depth % 2 / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  const site = placed.building;
  site.construction = 1; site.required = {};
  roads.addRoad(sim.headquarters.access, site.access);
  sim.receiveTroops([...troops("heavy", 2), ...troops("shield", 6)]);
  return { sim, site };
};

/**
 * A small village under construction: a Woodcutter's plot joined to the headquarters by road, so
 * the builder and the carriers bringing its materials walk outside (MIL-ASSAULT civilian raids).
 */
export const villageFixture = (script?: MapScript) => {
  const world = flatWorld(script);
  let simulation: AssaultSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  const sim = createSettlementSimulation({ canWorkerEnterPlot: () => true, initialSettlers: 12,
    initialStock: { axe: 4, hammer: 4, planks: 80, stone: 80 }, roads, world });
  simulation = sim;
  const [width, depth] = getBuildingDefinition(17).gridFootprint;
  const placed = sim.placeBuilding(17, 34 + width % 2 / 2, 14 + depth % 2 / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  roads.addRoad(sim.headquarters.access, placed.building.access);
  return { sim, site: placed.building };
};

export const advance = (sim: AssaultSimulation, seconds: number) => {
  for (let tick = 0; tick < seconds * 20; tick++) sim.update(.05);
};
export const crew = (sim: AssaultSimulation, uid: number) =>
  sim.militarySoldiers().filter(soldier => soldier.building === uid && soldier.stationed);
export const playerSoldiers = (sim: AssaultSimulation) =>
  sim.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) === 0).length;
export const enemies = (sim: AssaultSimulation) =>
  sim.militarySoldiers().filter(soldier => soldier.combat?.faction === ENEMY);
export const siteDoor = (sim: AssaultSimulation, uid: number) =>
  sim.militaryDoors().find(door => door.building === uid);
export const standing = (sim: AssaultSimulation, uid: number) =>
  sim.buildings().some(building => building.uid === uid);

/** `count` axemen of `rank` attack-moving from the open field onto the building's access. */
export const sendAttackGroup = (sim: AssaultSimulation, access: { x: number; z: number }, count = 6, rank = 1) => {
  const ids = Array.from({ length: count }, (_, index) =>
    sim.spawnMilitaryOpponent({ x: 40 + index % 3, z: 40 + Math.floor(index / 3) }, "heavy", rank, ENEMY));
  expect(ids.every(id => id !== null)).toBe(true);
  expect(sim.commandMilitaryOpponent(ids as number[], access, ENEMY)).toBe(true);
  return ids as number[];
};
