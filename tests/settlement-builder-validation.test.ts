import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 64;
  const world = { cellsX: size, cellsZ: size, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 10,
    initialStock: { hammer: 1, planks: 8, stone: 8 } });
  const [width, depth] = getBuildingDefinition(17).gridFootprint;
  const placed = simulation.placeBuilding(17, 24 + width / 2, 8 + depth / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const building = placed.building!;
  simulation.connectRoads(simulation.headquarters.access, building.access);
  const advance = (seconds: number) => {
    for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05);
  };
  advance(1);
  const builder = simulation.frames().find(actor => actor.job === "Builder")!;
  expect(builder).toBeDefined();
  const setBlocked = (value: boolean) => {
    world.walkCost.fill(value ? 0 : 10);
    world.buildRevision = (world.buildRevision ?? 0) + 1;
  };
  return { simulation, building, builder, roads, advance, setBlocked };
};

it("periodically retires a stale completed-plan builder, keeping hammer and cargo until physical HQ entry", () => {
  const { advance, builder, building, setBlocked, simulation } = fixture();
  // The old crew has already reached the workshop flag while its plan is completed elsewhere.
  Object.assign(builder, building.access);
  builder.visible = true; builder.phase = "builderWork"; builder.path = []; builder.pathIndex = 0;
  builder.ware = "planks";
  simulation.headquarters.inventory.planks!--;
  const planksBefore = simulation.headquarters.inventory.planks!;
  building.construction = 1; building.required = {}; building.worker = undefined;
  setBlocked(true);
  advance(8);
  expect(builder.job).toBe("Settler");
  expect(builder.demolitionReturning).toBe(true);
  expect(builder.visible).toBe(true);
  expect(builder.tool).toBe("hammer");
  expect(builder.ware).toBe("planks");
  expect(simulation.headquarters.inventory.hammer ?? 0).toBe(0);
  expect(simulation.headquarters.inventory.planks).toBe(planksBefore);
  const origin = { x: builder.x, z: builder.z };
  setBlocked(false);
  simulation.update(.05);
  expect(Math.hypot(builder.x - origin.x, builder.z - origin.z)).toBeLessThan(.08);
  expect(simulation.headquarters.inventory.hammer ?? 0).toBe(0);
  advance(160);
  expect(builder.phase).toBe("retired");
  expect(builder.home).toBe(simulation.headquarters.uid);
  expect(builder.tool).toBeUndefined(); expect(builder.ware).toBeNull();
  expect(simulation.headquarters.inventory.hammer).toBe(1);
  expect(simulation.headquarters.inventory.planks).toBeGreaterThanOrEqual(planksBefore + 1);
  expect(simulation.snapshot().settlersInside + simulation.frames().filter(actor => actor.phase !== "retired").length).toBe(10 + simulation.settlerBirths());
});

it("replans a stranded approach to a live plan instead of abandoning its hammer or duplicating builders", () => {
  const { advance, builder, building, setBlocked, simulation } = fixture();
  Object.assign(builder, building.access);
  builder.visible = true; builder.phase = "builderWork";
  builder.path = [{ x: -5, z: -5 }]; builder.pathIndex = 0;
  building.input = {}; building.construction = 0;
  setBlocked(true);
  advance(8);
  expect(builder.phase).toBe("inside");
  expect(builder.path).toEqual([]);
  expect(builder.tool).toBe("hammer");
  expect(building.worker).toBe(builder.uid);
  expect(simulation.frames().filter(actor => actor.job === "Builder")).toHaveLength(1);
  setBlocked(false);
  advance(100);
  expect(building.construction).toBe(1);
  expect(builder.phase).toBe("retired");
  expect(simulation.headquarters.inventory.hammer).toBe(1);
});

it("uses a genuine ground return after a finished crew's road is removed", () => {
  const { advance, builder, building, roads, simulation } = fixture();
  Object.assign(builder, building.access);
  builder.visible = true; builder.job = "Settler"; builder.phase = "builderReturnBlocked";
  builder.timer = 0; builder.path = []; builder.pathIndex = 0;
  building.construction = 1; building.required = {}; building.worker = undefined;
  const segments = roads.segments();
  expect(segments.length).toBeGreaterThan(0);
  for (const segment of segments) roads.removeRoad(segment.start, segment.end);
  expect(roads.route(building.access, simulation.headquarters.access)).toBeNull();
  advance(160);
  expect(builder.phase).toBe("retired");
  expect(builder.home).toBe(simulation.headquarters.uid);
  expect(builder.tool).toBeUndefined();
  expect(simulation.headquarters.inventory.hammer).toBe(1);
});

it("cancels a blocked builder plan without losing its hammer or counting it home before entry", () => {
  const { advance, builder, building, setBlocked, simulation } = fixture();
  Object.assign(builder, building.access);
  builder.visible = true; builder.phase = "builderWork";
  builder.path = [{ x: -5, z: -5 }]; builder.pathIndex = 0;
  setBlocked(true);
  advance(6);
  expect(builder.tool).toBe("hammer");
  expect(simulation.demolishBuilding(building.uid).ok).toBe(true);
  advance(4);
  expect(builder.demolitionReturning).toBe(true);
  expect(builder.visible).toBe(true);
  expect(builder.tool).toBe("hammer");
  expect(simulation.headquarters.inventory.hammer ?? 0).toBe(0);
  setBlocked(false);
  advance(160);
  expect(builder.phase).toBe("retired");
  expect(simulation.headquarters.inventory.hammer).toBe(1);
  expect(simulation.snapshot().settlersInside).toBe(10 + simulation.settlerBirths());
});
