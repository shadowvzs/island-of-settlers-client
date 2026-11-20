import { expect, it } from "vitest";

import {
  COLONY_POPULATION_BASE_LIMIT, POPULATION_BASE_LIMIT, POPULATION_GROWTH_SECONDS, RESIDENCE_POPULATION,
  START_SETTLERS
} from "../src/shared/balance/population";
import { workshopUpgradeLevels } from "../src/shared/settlement/building-level-benefits";
import { residenceGrowthSeconds, residenceLimitBonus } from "../src/shared/settlement/residences";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createNavalPassengers } from "../src/shared/settlement/settlement-naval-passengers";
import { createActor } from "../src/shared/settlement/settlement-paths";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import {
  addIdleSettlers, compactRetiredSettlers, countOnDutyPeople, createIslandPopulation, islandPeople,
  populationLimit, updatePopulationGrowth
} from "../src/shared/settlement/settlement-population";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const SIZE = 64;
const flatWorld = () => ({
  seed: 77, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 8.5, z: 8.5 },
  heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
  walkCost: new Uint8Array(SIZE ** 2).fill(10), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
  oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
}) as unknown as WorldData;

/** A flat home island plus a finished storehouse and harbour sharing its building list. */
const fixture = (initialSettlers?: number) => {
  const world = flatWorld(), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads, initialSettlers });
  const context = {
    options: { world, roads }, buildings: simulation.buildings(), actors: simulation.frames(),
    settlers: simulation.availableSettlers(), population: createIslandPopulation(), nextBuilding: 1, nextActor: 0,
    occupied: new Uint8Array(SIZE ** 2), reservations: new Set(), resourceAmounts: new Map(),
    accumulator: 0, scheduling: 0, transfers: []
  } as SettlementContext;
  const store = makeBuilding(context, 29, 25, 16);
  const harbour = makeBuilding(context, 39, 42.5, 30);
  for (const storage of [store, harbour]) Object.assign(storage, { construction: 1, required: {} });
  context.buildings.push(store, harbour);
  return { context, harbour, simulation, store };
};
type Simulation = ReturnType<typeof createSettlementSimulation>;
const advance = (simulation: Simulation, seconds: number) => {
  for (let tick = 0; tick < Math.round(seconds * 20); tick++) simulation.update(0.05);
};
const people = (simulation: Simulation) => simulation.population().people;
/** Growth runs on the half-second schedule, so a birth may land one step after its exact second. */
const STEP = 0.5;

it("starts a new home island with its settlers in the headquarters and the home limit", () => {
  const { simulation } = fixture();
  expect(START_SETTLERS).toBe(50);
  expect(simulation.availableSettlers(0)).toBe(START_SETTLERS);
  expect(simulation.population()).toEqual({ limit: POPULATION_BASE_LIMIT, people: START_SETTLERS });
});

it("grows one settler per minute in the headquarters only; storehouses and harbours grow none", () => {
  const { harbour, simulation, store } = fixture();
  advance(simulation, POPULATION_GROWTH_SECONDS - STEP);
  expect(people(simulation)).toBe(START_SETTLERS);
  advance(simulation, 2 * STEP);
  expect(simulation.availableSettlers(0)).toBe(START_SETTLERS + 1);
  expect([simulation.availableSettlers(store.uid), simulation.availableSettlers(harbour.uid)]).toEqual([0, 0]);
  advance(simulation, POPULATION_GROWTH_SECONDS * 3);
  expect(simulation.settlerBirths()).toBe(4);
  expect(people(simulation)).toBe(START_SETTLERS + 4);
});

it("stops at the limit and pauses above it without losing anybody", () => {
  const { simulation } = fixture(POPULATION_BASE_LIMIT - 1);
  advance(simulation, POPULATION_GROWTH_SECONDS + STEP);
  expect(people(simulation)).toBe(POPULATION_BASE_LIMIT);
  advance(simulation, POPULATION_GROWTH_SECONDS * 3);
  expect(people(simulation)).toBe(POPULATION_BASE_LIMIT);
  simulation.receiveTroops([{ hp: 100, rank: 0, type: "shield" }, { hp: 100, rank: 0, type: "archer" }]);
  expect(people(simulation)).toBe(POPULATION_BASE_LIMIT + 2);
  advance(simulation, POPULATION_GROWTH_SECONDS * 2);
  expect(people(simulation)).toBe(POPULATION_BASE_LIMIT + 2);
  expect(simulation.settlerBirths()).toBe(1);
});

it("counts soldiers and on-duty workers but not mounts, and keeps the count incremental", () => {
  const { context, simulation } = fixture(10);
  const worker = createActor(context, "Carrier", 0);
  expect(islandPeople(context)).toBe(10);
  simulation.receiveTroops([{ hp: 105, rank: 0, type: "cavalry" }]);
  expect(simulation.frames().some(actor => actor.job === "Mount")).toBe(true);
  expect(people(simulation)).toBe(11);
  expect(countOnDutyPeople(context)).toBe(2);
  worker.phase = "retired";
  expect(countOnDutyPeople(context)).toBe(1);
});

it("bears a colony's settlers in its harbour under the colony limit", () => {
  const { context, harbour, store } = fixture(0);
  context.buildings.splice(0, context.buildings.length, store, harbour);
  harbour.colonyHome = true;
  context.settlers = 0;
  expect(populationLimit(context)).toBe(COLONY_POPULATION_BASE_LIMIT);
  for (let step = 0; step < POPULATION_GROWTH_SECONDS * 2; step++) updatePopulationGrowth(context, 0.5);
  expect([harbour.idleSettlers, store.idleSettlers ?? 0]).toEqual([1, 0]);
  addIdleSettlers(context, harbour, COLONY_POPULATION_BASE_LIMIT - 1);
  for (let step = 0; step < POPULATION_GROWTH_SECONDS * 4; step++) updatePopulationGrowth(context, 0.5);
  expect(islandPeople(context)).toBe(COLONY_POPULATION_BASE_LIMIT);
});

it("has no limit or growth without a home building", () => {
  const { context, store } = fixture(0);
  context.buildings.splice(0, context.buildings.length, store);
  expect(populationLimit(context)).toBeUndefined();
  updatePopulationGrowth(context, POPULATION_GROWTH_SECONDS);
  expect(islandPeople(context)).toBe(0);
});

it("saves the island growth timer and births, recounts people on load and rejects old saves", () => {
  const { simulation } = fixture(20);
  advance(simulation, POPULATION_GROWTH_SECONDS + 22.5);
  simulation.receiveTroops([{ hp: 100, rank: 0, type: "shield" }]);
  const saved = simulation.saveState();
  saved.nextBuilding = 3; // adopt the fixture's synthetic storages
  expect(saved.settlerBirths).toBe(1);
  expect(Math.abs(saved.settlerGrowthTime - 22.5)).toBeLessThanOrEqual(STEP);
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(people(simulation)).toBe(22);
  advance(simulation, 37.5 + STEP);
  expect(simulation.settlerBirths()).toBe(2);
  const old = simulation.saveState() as Partial<typeof saved>;
  delete old.settlerGrowthTime;
  expect(simulation.loadState(old)).toEqual({ ok: false, reason: "Invalid population or simulation timing" });
  const corrupt = simulation.saveState();
  corrupt.buildings[0]!.idleSettlers!--;
  expect(simulation.loadState(corrupt)).toEqual({ ok: false, reason: "Inconsistent storage population" });
});

it("reservations use the source harbour pool and release exactly there while preserving held people", () => {
  const { context, harbour, simulation, store } = fixture(100);
  const passengers = createNavalPassengers(context);
  expect(passengers.reserve(harbour, 1, 0)).toBeNull();
  addIdleSettlers(context, harbour, 3);
  const ids = passengers.reserve(harbour, 3, 0)!;
  expect(ids).toHaveLength(3);
  expect(harbour.idleSettlers).toBe(0);
  expect(islandPeople(context)).toBe(103);
  passengers.embark(ids);
  compactRetiredSettlers(context);
  expect(context.actors).toHaveLength(3);
  expect(simulation.headquarters.idleSettlers).toBe(100);
  passengers.release(ids, store);
  passengers.release(ids, store);
  expect(store.idleSettlers).toBe(3);
  expect([context.settlers, islandPeople(context)]).toEqual([103, 103]);
  compactRetiredSettlers(context);
  expect(context.actors).toHaveLength(0);
});

it("keeps referenced soldiers, assigned workers and unpaid/carrying shells when compacting", () => {
  const { context, simulation } = fixture(10);
  const civilian = createActor(context, "Settler", 0);
  civilian.phase = "retired";
  addIdleSettlers(context, simulation.headquarters);
  const soldier = createActor(context, "Soldier", 0);
  soldier.phase = "retired";
  const carrying = createActor(context, "Carrier", 0);
  carrying.phase = "retired";
  carrying.ware = "planks";
  const assigned = createActor(context, "Builder", 0);
  simulation.headquarters.worker = assigned.uid;
  compactRetiredSettlers(context);
  expect(context.actors.map((actor) => actor.uid)).toEqual([soldier.uid, carrying.uid, assigned.uid]);
});

it("demolishing a storage moves its idle settlers to the headquarters", () => {
  // `simulation.buildings()` is a filtered copy (verge shells, 978864014): place the store in the simulation itself.
  const { simulation } = fixture(30);
  const placed = simulation.placeBuilding(29, 25.5, 16.5);
  expect(placed.ok).toBe(true);
  const store = simulation.buildings().find(building => building.uid === placed.building!.uid)!;
  Object.assign(store, { construction: 1, idleSettlers: 4, required: {} });
  simulation.headquarters.idleSettlers! -= 4;
  expect(simulation.demolishBuilding(store.uid).ok).toBe(true);
  expect(simulation.availableSettlers(0)).toBe(30);
  expect(simulation.availableSettlers(store.uid)).toBe(0);
});

/** A finished residence beside the fixture's buildings (no plot needed for population rules). */
const residence = (context: SettlementContext, typeId: number, level: 0 | 1 = 0) => {
  const building = { construction: 1, typeId, uid: 900 + context.buildings.length,
    workshopUpgrade: level ? { level } : undefined } as SettlementBuilding;
  context.buildings.push(building);
  return building;
};
const grow = (context: SettlementContext, seconds: number) => {
  for (let step = 0; step < Math.round(seconds / STEP); step++) updatePopulationGrowth(context, STEP);
};

it("raises the limit per residence and by a rounded-up tenth of its base per upgrade level", () => {
  expect([57, 58, 59].map(type => residenceLimitBonus(type, 0))).toEqual([10, 25, 45]);
  expect([57, 58, 59].map(type => residenceLimitBonus(type, 1))).toEqual([11, 28, 50]);
  const { context } = fixture(10);
  residence(context, 57);
  residence(context, 59, 1);
  const unfinished = residence(context, 58);
  unfinished.construction = 0.5;
  expect(populationLimit(context)).toBe(POPULATION_BASE_LIMIT + 10 + 50);
});

it("bears residence settlers at its own rate into the headquarters; an upgrade does not speed it up", () => {
  expect([57, 58, 59].map(type => residenceGrowthSeconds(type))).toEqual([300, 240, 180]);
  const { context, simulation } = fixture(10);
  const big = residence(context, 59, 1);
  grow(context, RESIDENCE_POPULATION[59]!.growthSeconds - STEP);
  // Two island births (60 s each); the upgraded big residence still needs its full 180 s.
  expect(context.population!.births).toBe(2);
  grow(context, STEP);
  expect(context.population!.births).toBe(4);
  expect(simulation.headquarters.idleSettlers).toBe(14);
  expect(big.settlerGrowthTime).toBeCloseTo(0);
});

it("pauses residence growth at the limit and keeps everybody when a residence is demolished", () => {
  const { context } = fixture(POPULATION_BASE_LIMIT + 9);
  const small = residence(context, 57);
  grow(context, RESIDENCE_POPULATION[57]!.growthSeconds);
  expect(islandPeople(context)).toBe(POPULATION_BASE_LIMIT + 10);
  context.buildings.splice(context.buildings.indexOf(small), 1);
  grow(context, 600);
  expect(islandPeople(context)).toBe(POPULATION_BASE_LIMIT + 10);
});

it("lists only the residence levels' limit benefit, from the balance numbers", () => {
  expect(workshopUpgradeLevels(58)).toEqual([2, 3, 4, 5].map((level, index) =>
    ({ benefits: [`+${3 * (index + 1)} population limit`], level })));
});

it("saves and restores a placed residence's growth timer and rejects a corrupt one", () => {
  const world = flatWorld();
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 10 });
  const raised = simulation.debugRaiseBuilding(57);
  expect(raised.ok, raised.ok ? "" : raised.reason).toBe(true);
  const home = simulation.buildings().find(building => building.typeId === 57)!;
  advance(simulation, 100);
  const saved = simulation.saveState();
  const timer = saved.buildings.find(building => building.typeId === 57)!.settlerGrowthTime!;
  expect(timer).toBeGreaterThan(98);
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.buildings().find(building => building.uid === home.uid)!.settlerGrowthTime).toBe(timer);
  const corrupt = structuredClone(saved);
  corrupt.buildings.find(building => building.typeId === 57)!.settlerGrowthTime = 300;
  expect(simulation.loadState(corrupt)).toEqual({ ok: false, reason: "Invalid residence growth timer" });
  const misplaced = structuredClone(saved);
  misplaced.buildings[0]!.settlerGrowthTime = 1;
  expect(simulation.loadState(misplaced)).toEqual({ ok: false, reason: "Invalid residence growth timer" });
});

it("raises the people limit and speeds every growth timer with the population talents", () => {
  const { simulation } = fixture();
  expect(simulation.setTalentRanks({ populationLimit: 5, settlerGrowth: 5 })).toBe(true);
  expect(simulation.population().limit).toBe(115);
  // +25% growth: one birth every 48 s instead of 60 s.
  advance(simulation, POPULATION_GROWTH_SECONDS / 1.25 - STEP);
  expect(people(simulation)).toBe(START_SETTLERS);
  advance(simulation, STEP * 2);
  expect(people(simulation)).toBe(START_SETTLERS + 1);
  expect(simulation.setTalentRanks({ populationLimit: 9 })).toBe(false);
});
