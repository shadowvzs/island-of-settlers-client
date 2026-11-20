import { expect, it } from "vitest";

import { GARRISON_CAPACITIES } from "../src/shared/balance/military";
import { POPULATION_GROWTH_SECONDS } from "../src/shared/balance/population";
import { STORAGE_IDS } from "../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { nearestStorage } from "../src/shared/settlement/settlement-logistics";
import { addIdleSettlers, createIslandPopulation } from "../src/shared/settlement/settlement-population";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { SETTLER_RELOCATE_PHASE } from "../src/shared/settlement/settler-relocation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const SIZE = 64;
const flatWorld = () => ({
  seed: 77, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 8.5, z: 8.5 },
  heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
  walkCost: new Uint8Array(SIZE ** 2).fill(10), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
  oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
}) as unknown as WorldData;

/** A home island with a finished, road-connected storehouse and no idle settler in it. */
const island = (initialSettlers = 10) => {
  const world = flatWorld(), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ initialSettlers, roads, world });
  expect(simulation.debugRaiseBuilding(29).ok).toBe(true);
  const store = simulation.buildings().find(building => building.typeId === 29)!;
  return { roads, simulation, store, world };
};
type Simulation = ReturnType<typeof createSettlementSimulation>;
const advance = (simulation: Simulation, seconds: number) => {
  for (let tick = 0; tick < Math.round(seconds * 20); tick++) simulation.update(0.05);
};
const people = (simulation: Simulation) => simulation.population().people;

it("walks a newborn from the HQ to a storage whose dispatch found nobody, where it rests", () => {
  const { simulation, store } = island();
  expect(simulation.recruitStoredMilitary(store.uid, "shield")).toBeNull();
  advance(simulation, POPULATION_GROWTH_SECONDS + 0.5);
  const walker = simulation.frames().find(actor => actor.phase === SETTLER_RELOCATE_PHASE)!;
  expect(walker).toBeDefined();
  expect(people(simulation)).toBe(11);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  advance(simulation, 40);
  expect(simulation.availableSettlers(store.uid)).toBe(1);
  expect(simulation.availableSettlers(0)).toBe(10);
  expect(people(simulation)).toBe(11);
  // It rests where it last entered: the storehouse is now its home.
  expect(simulation.frames().find(actor => actor.uid === walker.uid)?.home ?? store.uid).toBe(store.uid);
});

it("keeps newborns in the HQ when no storage needs people", () => {
  const { simulation, store } = island();
  advance(simulation, POPULATION_GROWTH_SECONDS + 0.5);
  expect(simulation.frames().some(actor => actor.phase === SETTLER_RELOCATE_PHASE)).toBe(false);
  expect([simulation.availableSettlers(0), simulation.availableSettlers(store.uid)]).toEqual([11, 0]);
});

it("walks a newborn into a coastal harbour and preserves its local idle pool across reload", () => {
  const world = flatWorld();
  world.start = { x: 25, z: 20 };
  for (let z = 0; z <= SIZE; z++)
    for (let x = 50; x <= SIZE; x++) world.heights[z * (SIZE + 1) + x] = -2;
  for (let z = 0; z < SIZE; z++)
    for (let x = 50; x < SIZE; x++) {
      const cell = z * SIZE + x;
      world.blocking[cell] = 1;
      world.walkCost[cell] = 0;
      world.buildClass[cell] = 0;
    }
  let simulation: Simulation;
  const roads = createRoadNetwork(world, {
    isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false
  });
  simulation = createSettlementSimulation({ initialSettlers: 10, roads, world });
  const placed = simulation.placeBuilding(39, 44, 39);
  expect(placed.ok, placed.reason).toBe(true);
  // Authored completed-storage fixture; movement and door admission run through actual ticks.
  const harbour = placed.building!;
  harbour.construction = 1;
  harbour.required = {};
  expect(simulation.connectRoads(simulation.headquarters.access, harbour.access)).toBe(true);
  expect(simulation.recruitStoredMilitary(harbour.uid, "shield")).toBeNull();
  advance(simulation, POPULATION_GROWTH_SECONDS + 0.5);
  expect(simulation.frames().some(actor => actor.phase === SETTLER_RELOCATE_PHASE)).toBe(true);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  advance(simulation, 50);
  expect(simulation.availableSettlers(harbour.uid)).toBe(1);
  expect(simulation.availableSettlers(simulation.headquarters.uid)).toBe(10);
  expect(people(simulation)).toBe(11);
  expect(simulation.frames().filter(actor => actor.job === "Settler" && actor.visible)).toEqual([]);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  expect(simulation.availableSettlers(harbour.uid)).toBe(1);
  expect(people(simulation)).toBe(11);
});

it("dispatches from the nearest storage with an idle settler and notes demand at an empty nearer one", () => {
  const { roads, simulation, store, world } = island();
  const context = { actors: simulation.frames(), buildings: simulation.buildings(), options: { roads, world },
    population: createIslandPopulation(), settlers: simulation.availableSettlers() } as unknown as SettlementContext;
  expect(nearestStorage(context, store, undefined, undefined, true)?.building).toBe(simulation.headquarters);
  expect([...context.population!.demand]).toEqual([store.uid]);
  addIdleSettlers(context, store);
  expect(nearestStorage(context, store, undefined, undefined, true)?.building).toBe(store);
  expect(nearestStorage(context, simulation.headquarters, undefined, undefined, true)?.building)
    .toBe(simulation.headquarters);
});

it("never loses idle settlers of a removed storage; combat cannot besiege or capture storages", () => {
  const { simulation, store } = island();
  simulation.headquarters.idleSettlers! -= 3;
  store.idleSettlers = 3;
  expect(simulation.demolishBuilding(store.uid).ok).toBe(true);
  expect([simulation.availableSettlers(0), people(simulation)]).toEqual([10, 10]);
  for (const storage of STORAGE_IDS) expect(GARRISON_CAPACITIES[storage]).toBeUndefined();
});
