import { expect } from "vitest";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { COLONY_SUPPLIES } from "../../src/shared/balance/colonies";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";

const SIZE = 64, COAST = 36;
const world = () => {
  const heights = new Float32Array((SIZE + 1) ** 2);
  for (let z = 0; z <= SIZE; z++) for (let x = COAST; x <= SIZE; x++) heights[z * (SIZE + 1) + x] = -2;
  const data = { seed: 4, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 12.5, z: 12.5 }, heights,
    blocking: new Uint8Array(SIZE ** 2), walkCost: new Uint8Array(SIZE ** 2).fill(10),
    buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
    props: {
      count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array()
    }
  } as unknown as WorldData;
  for (let z = 0; z < SIZE; z++) for (let x = COAST; x < SIZE; x++) {
    data.walkCost[z * SIZE + x] = 0; data.blocking[z * SIZE + x] = 1;
  }
  return data;
};

/**
 * A completed harbour, one idle ship and 20 stored troops of each type, without hostile units. Without
 * `connectHarbour` the headquarters (where the troops are stored) has no road to the harbour.
 */
export const expeditionHarbourFixture = ({ connectHarbour = true } = {}) => {
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const data = world();
  const roads = createRoadNetwork(data, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world: data, roads, initialSettlers: 30, canWorkerEnterPlot: () => true,
    initialStock: { planks: 50, stone: 50 } });
  const [width, depth] = getBuildingDefinition(39).gridFootprint;
  const placed = simulation.placeBuilding(39, Math.floor(32 - width / 2) + width / 2,
    Math.floor(20 - depth / 2) + depth / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const harbour = placed.building!;
  Object.assign(harbour, { construction: 1, input: {}, required: {}, worker: undefined });
  if (connectHarbour) expect(simulation.connectRoads(simulation.headquarters.access, harbour.access)).toBe(true);
  expect(simulation.startMilitaryTrainingEncounter().ok).toBe(true);
  const saved = simulation.saveState();
  const hostile = new Set(saved.military!.soldiers.filter(soldier => soldier.combat?.faction).flatMap(soldier =>
    [soldier.actor, soldier.combat?.mount]));
  saved.military!.soldiers = saved.military!.soldiers.filter(soldier => !hostile.has(soldier.actor));
  saved.actors = saved.actors.filter(actor => !hostile.has(actor.uid));
  saved.naval.fleet.ships.push({ id: 1, x: 44.5, y: -1, z: 20.5, yaw: 0, phase: "idle", cargoCount: 0, cargo: {},
    route: [], cursor: 0, timer: 0 });
  saved.naval.fleet.nextShip = 2;
  const loaded = simulation.loadState(saved);
  expect(loaded.ok, loaded.ok ? "" : loaded.reason).toBe(true);
  const home = simulation.buildings().find(building => building.uid === harbour.uid)!;
  home.inventory = { ...home.inventory, ...COLONY_SUPPLIES };
  const advance = (seconds: number) => { for (let second = 0; second < seconds; second++) simulation.update(1); };
  return { advance, harbour: home, simulation };
};
export const islandOf = (simulation: ReturnType<typeof expeditionHarbourFixture>["simulation"], difficulty: string) =>
  simulation.colonyIslands().find(island => island.difficulty === difficulty)!.id;
export const storedCount = (simulation: ReturnType<typeof expeditionHarbourFixture>["simulation"]) =>
  simulation.militaryStoredTroops().reduce((sum, entry) => sum + entry.count, 0);

