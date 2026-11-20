import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { TERRITORY_RADII } from "../src/shared/balance/territory";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const session = () => {
  const size = 180;
  const world = {
    seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 70, z: 70 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20,
    initialStock: { sword: 2, shield: 2, beer: 2, planks: 200, stone: 200 }, canWorkerEnterPlot: () => true });
  const advance = (seconds: number) => { for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05); };
  return { simulation, advance };
};

it("uses the approved territorial radii, restricts whole plots and roads, and caches ownership", () => {
  // CAT7 rules sidecars: the Catapult Tower (16) claims its documented 2-tile radius.
  expect(TERRITORY_RADII).toEqual({ 0: 48, 1: 20, 2: 29, 4: 39, 9: 53, 16: 2 });
  const { simulation } = session();
  const { x, z } = simulation.headquarters;
  const territory = simulation.territory();
  expect(territory.sources).toHaveLength(1);
  expect(simulation.territory()).toBe(territory);
  expect(simulation.ownsTerritory({ x: x + 46, z })).toBe(true);
  expect(simulation.ownsTerritory({ x: x + 50, z })).toBe(false);
  // Centre is owned but part of this storage's footprint extends outside the circle.
  expect(simulation.validatePlacement(29, x + 46.5, z + .5)).toMatch(/territory/);
  expect(simulation.placeBuilding(29, x + 70.5, z + .5).ok).toBe(false);
  const start = { x: x + 10, z: z + 10 }, end = { x: x + 70, z: z + 10 };
  expect(simulation.planRoad(start, end, "dirt")).toBeNull();
  expect(simulation.connectRoads(start, end)).toBe(false);
  expect(simulation.roadSegments()).toHaveLength(0);
});

it("expands only after a soldier enters, survives reload, and removes internal overlap borders", () => {
  const { advance, simulation } = session();
  const { x, z } = simulation.headquarters;
  const neutral = { x: x + 58.5, z: z + .5 };
  const result = simulation.placeBuilding(1, x + 42, z);
  if (!result.ok || !result.building) throw new Error(result.reason);
  const barracks = result.building;
  expect(simulation.ownsTerritory(neutral)).toBe(false);
  barracks.construction = 1; barracks.required = {};
  expect(simulation.connectRoads(simulation.headquarters.access, barracks.access)).toBe(true);
  // Military buildings take stored soldiers only (new ones come from the Tavern).
  for (let index = 0; index < 2; index++) simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield");
  advance(25);
  expect(simulation.militaryBuildings()[0]?.travelling).toBeGreaterThan(0);
  expect(simulation.ownsTerritory(neutral)).toBe(false);
  advance(120);
  expect(simulation.militaryBuildings()[0]?.stationed).toBe(2);
  expect(simulation.ownsTerritory(neutral)).toBe(true);
  expect(simulation.ownsTerritory({ x: x + 63.5, z: z + .5 })).toBe(false);
  expect(simulation.validatePlacement(29, neutral.x, neutral.z)).toBeNull();
  const territory = simulation.territory();
  expect(territory.sources).toHaveLength(2);
  for (const point of territory.borders) {
    const distances = territory.sources.map(source => Math.hypot(point.x - source.x, point.z - source.z));
    expect(territory.sources.every((source, index) => distances[index]! >= source.radius - .001)).toBe(true);
    expect(point.y).toBe(0);
  }
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  expect(simulation.ownsTerritory(neutral)).toBe(true);
  expect(simulation.territory().sources).toEqual(territory.sources);
  const garrison = simulation.militarySoldiers().filter(soldier => soldier.building === barracks.uid);
  expect(simulation.commandMilitary(garrison.map(soldier => soldier.actor), { x: x + 45, z: z + 8 }, "move")).toBe(true);
  expect(simulation.militarySoldiers().filter(soldier => soldier.building === barracks.uid && soldier.stationed)).toHaveLength(1);
  simulation.setMilitaryTarget(barracks.uid, 0);
  advance(120);
  expect(simulation.militaryBuildings()[0]?.stationed).toBe(1);
  expect(simulation.setMilitaryComposition(barracks.uid, { archer: 0, heavy: 0, shield: 0 })).toBe(false);
  expect(simulation.ownsTerritory(neutral)).toBe(true);
  // The persistent claim also survives losing the final defender, until the building is destroyed.
  const emptySave = structuredClone(simulation.saveState());
  const lost = new Set(emptySave.actors.filter(actor => actor.building === barracks.uid).map(actor => actor.uid));
  emptySave.actors = emptySave.actors.filter(actor => !lost.has(actor.uid));
  emptySave.military!.soldiers = emptySave.military!.soldiers.filter(soldier => !lost.has(soldier.actor));
  expect(simulation.loadState(emptySave)).toEqual({ ok: true });
  expect(simulation.ownsTerritory(neutral)).toBe(true);
  expect(simulation.demolishBuilding(barracks.uid).ok).toBe(true);
  expect(simulation.ownsTerritory(neutral)).toBe(false);
});

it("widens an upgraded watchtower's claim once its upgrade completes, never shrinking it while pending", () => {
  const { simulation } = session();
  const { x, z } = simulation.headquarters;
  const [width, depth] = getBuildingDefinition(4).gridFootprint;
  const result = simulation.placeBuilding(4, Math.floor(x) + 40 + width % 2 / 2, Math.floor(z) + depth % 2 / 2);
  if (!result.ok || !result.building) throw new Error(result.reason);
  const tower = result.building;
  Object.assign(tower, { construction: 1, required: {}, territoryClaimed: true });
  const radius = () => simulation.territory().sources.find(source => source.uid === tower.uid)?.radius;
  const edge = { x: tower.x + 41, z: tower.z };
  expect(radius()).toBe(39);
  expect(simulation.ownsTerritory(edge)).toBe(false);
  tower.workshopUpgrade = { level: 0, requested: true, reserved: {}, incoming: {} };
  expect(radius()).toBe(39);
  tower.workshopUpgrade = { level: 1 };
  expect(radius()).toBe(43);
  expect(simulation.ownsTerritory(edge)).toBe(true);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  expect(radius()).toBe(43);
});
