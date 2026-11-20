import { expect, it } from "vitest";

import { levelRoadGround } from "../src/shared/settlement/road-ground-leveling";
import type { RoadSegment } from "../src/shared/settlement/road-types";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import type { WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 20;
  const world = { cellsX: size, cellsZ: size, seaLevel: 0,
    heights: new Float32Array((size + 1) ** 2), waterDepth: new Float32Array((size + 1) ** 2),
    heightLevels: new Uint8Array((size + 1) ** 2) } as WorldData;
  for (let z = 0; z <= size; z++) for (let x = 0; x <= size; x++)
    world.heights[z * (size + 1) + x] = 2 + z * .07 + (x >= 10 ? 1 : 0);
  const roads: RoadSegment[] = Array.from({ length: 24 }, (_, i) => ({
    start: { x: 4 + i * .5, z: 10 }, end: { x: 4.5 + i * .5, z: 10 }, tier: "dirt" }));
  return { world, roads };
};

it("checks each foundation vertex once per grading operation and observes later plot movement", () => {
  const { roads, world } = fixture();
  let reads = 0, plotX = 100;
  const building = { get x() { reads++; return plotX; }, z: 10.25, width: 2.5, depth: 2.5 } as SettlementBuilding;
  levelRoadGround(world, [...roads, ...roads, ...roads, ...roads], [building]);
  expect(reads).toBeLessThanOrEqual(world.heights.length);
  plotX = 10.25;
  // Integer vertex lies exactly on both fractional footprint boundaries.
  world.heights[9 * 21 + 9] = 8;
  levelRoadGround(world, roads, [building]);
  expect(world.heights[9 * 21 + 9]).toBe(8);
});

it("grades a half-tile terrain step into a walkable road without flattening the distant hill", () => {
  const { roads, world } = fixture();
  const before = world.heights.slice();
  expect(levelRoadGround(world, roads, [])).not.toBeNull();
  for (const road of roads) {
    const a = sampleSmooth(world, world.heights, road.start.x, road.start.z);
    const b = sampleSmooth(world, world.heights, road.end.x, road.end.z);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(.5 * .7);
  }
  expect(world.heights[2 * 21 + 10]).toBe(before[2 * 21 + 10]);
  expect(world.terrainRevision).toBe(1);
});

it("preserves water and every foundation vertex, including unworked construction sites", () => {
  const { roads, world } = fixture();
  const water = 10 * 21 + 6;
  world.waterDepth[water] = .5;
  const before = world.heights.slice();
  const building = { x: 14, z: 11, width: 2, depth: 2, foundationProgress: 0 } as SettlementBuilding;
  levelRoadGround(world, roads, [building]);
  expect(world.heights[water]).toBe(before[water]);
  expect(world.waterDepth[water]).toBe(.5);
  for (let z = 10; z <= 12; z++) for (let x = 13; x <= 15; x++)
    expect(world.heights[z * 21 + x]).toBe(before[z * 21 + x]);
});

it("leaves preview and doorway-only roads untouched", () => {
  const { roads, world } = fixture();
  const before = world.heights.slice();
  expect(levelRoadGround(world, roads.map(road => ({ ...road, preview: true })), [])).toBeNull();
  expect(levelRoadGround(world, roads.map(road => ({ ...road, doorway: true })), [])).toBeNull();
  expect(world.heights).toEqual(before);
});

it("previews and commits grading across a raised joining tile without changing preview terrain", async () => {
  const { canLevelRoadGround } = await import("../src/shared/settlement/road-ground-leveling");
  const { createRoadNetwork } = await import("../src/shared/settlement/road-network");
  const { world } = fixture();
  world.blocking = new Uint8Array(world.cellsX * world.cellsZ);
  const before = world.heights.slice();
  const roads = createRoadNetwork(world, {
    validateGradedRoads: (planned, existing) => canLevelRoadGround(world, planned, existing, [])
  });
  // The joining segment itself crosses the step; complete it at the existing road endpoint.
  expect(roads.replaceSegments([{ start: { x: 10, z: 10 }, end: { x: 10.5, z: 10 }, tier: "dirt" }])).toBe(true);
  const plan = roads.planRoad({ x: 7, z: 10 }, { x: 9.5, z: 10 });
  expect(plan?.points.at(-1)).toEqual({ x: 10, z: 10 });
  expect(world.heights).toEqual(before);
  expect(world.terrainRevision).toBeUndefined();
  expect(roads.addRoad({ x: 7, z: 10 }, { x: 9.5, z: 10 })).toBe(true);
  expect(roads.route({ x: 7, z: 10 }, { x: 10.5, z: 10 })).toBeNull();
  levelRoadGround(world, roads.segments(), []);
  expect(roads.route({ x: 7, z: 10 }, { x: 10.5, z: 10 })).not.toBeNull();
});

it("rejects ungradeable protected steps atomically instead of promising an invalid preview", async () => {
  const { canLevelRoadGround } = await import("../src/shared/settlement/road-ground-leveling");
  const { createRoadNetwork } = await import("../src/shared/settlement/road-network");
  const { world } = fixture();
  world.blocking = new Uint8Array(world.cellsX * world.cellsZ);
  const before = world.heights.slice();
  const plot = { x: 10, z: 10, width: 20, depth: 20 } as SettlementBuilding;
  const roads = createRoadNetwork(world, {
    validateGradedRoads: (planned, existing) => canLevelRoadGround(world, planned, existing, [plot])
  });
  expect(roads.planRoad({ x: 8, z: 10 }, { x: 11, z: 10 })).toBeNull();
  expect(roads.addRoad({ x: 8, z: 10 }, { x: 11, z: 10 })).toBe(false);
  expect(roads.segments()).toEqual([]);
  expect(world.heights).toEqual(before);
});


it("does not regrade an unchanged road when a distant mine foundation changes terrain", async () => {
  const { refreshSettlementRoadTerrain } = await import("../src/shared/settlement/settlement-road-terrain");
  const { roads, world } = fixture();
  const onRoadGroundLeveled = (await import("vitest")).vi.fn();
  const context = { options: { world, roads: { revision: 1, segments: () => roads }, onRoadGroundLeveled },
    buildings: [] } as unknown as import("../src/shared/settlement/settlement-types").SettlementContext;
  refreshSettlementRoadTerrain(context);
  const graded = world.heights.slice();
  const calls = onRoadGroundLeveled.mock.calls.length;
  for (let tile = 0; tile < 20; tile++) {
    world.heights[2 * 21 + 2]! += .1;
    world.terrainRevision!++;
    refreshSettlementRoadTerrain(context);
  }
  expect(onRoadGroundLeveled).toHaveBeenCalledTimes(calls);
  for (let z = 7; z <= 13; z++) for (let x = 2; x <= 18; x++)
    expect(world.heights[z * 21 + x]).toBe(graded[z * 21 + x]);
  world.heights[10 * 21 + 10]! += .2;
  world.terrainRevision!++;
  refreshSettlementRoadTerrain(context);
  expect(onRoadGroundLeveled.mock.calls.length).toBeGreaterThan(calls);
});


it("keeps an accepted road's corridor and slope passable after a nearby sloped foundation apron", async () => {
  const { levelBuildingFoundation, levelBuildingFoundationTile } =
    await import("../src/shared/settlement/settlement-foundation");
  const { getCellTerrain } = await import("../src/shared/world/generation/gameplay");
  const { BLOCKING } = await import("../src/shared/world/world-data");
  const { createRoadTraversal } = await import("../src/shared/settlement/road-traversal");
  const { roads, world } = fixture();
  world.blocking = new Uint8Array(400);
  for (let z = 0; z <= 20; z++) for (let x = 0; x <= 20; x++)
    world.heights[z * 21 + x] = 2 + x * .65 + z * .1;
  const plot = { x: 13, z: 14, width: 6, depth: 4,
    y: Math.fround(2 + 13 * .65 + 14 * .1) } as SettlementBuilding;
  const refreshBlocking = () => {
    for (let z = 0; z < 20; z++) for (let x = 0; x < 20; x++)
      world.blocking[z * 20 + x] = getCellTerrain(world, world, x, z).blocking;
  };
  const assertPassable = () => {
    refreshBlocking();
    const traversal = createRoadTraversal(world, {});
    for (const road of roads) {
      expect(traversal.walkable(road.start, road.end), JSON.stringify(road)).toBe(true);
      expect(world.blocking[10 * 20 + Math.floor(road.start.x)]).toBe(BLOCKING.free);
    }
  };
  levelRoadGround(world, roads, [plot]);
  assertPassable();
  // Normal shovel work edits one tile at a time before applying the completed apron.
  for (let z = 12; z < 16; z++) for (let x = 10; x < 16; x++) {
    levelBuildingFoundationTile(world, plot, x, z, []);
    levelRoadGround(world, roads, [plot]);
    assertPassable();
  }
  levelBuildingFoundation(world, plot, []);
  const foundation = world.heights.slice();
  levelRoadGround(world, roads, [plot]);
  assertPassable();
  for (let z = 12; z <= 16; z++) for (let x = 10; x <= 16; x++)
    expect(world.heights[z * 21 + x]).toBe(foundation[z * 21 + x]);
});


it("rejects a new preview if grading would leave an existing protected corridor impassable", async () => {
  const { canLevelRoadGround } = await import("../src/shared/settlement/road-ground-leveling");
  const { world } = fixture();
  world.heights.fill(3);
  // Both centreline endpoints are level, but the traversed cell has a protected cliff corner.
  world.heights[9 * 21 + 10] = 5;
  const existing: RoadSegment[] = [{ start: { x: 9, z: 10 }, end: { x: 9.5, z: 10 }, tier: "dirt" }];
  const planned: RoadSegment[] = [{ start: { x: 4, z: 4 }, end: { x: 4.5, z: 4 }, tier: "dirt" }];
  const protectedPlot = { x: 10, z: 9, width: 4, depth: 4 } as SettlementBuilding;
  const before = world.heights.slice();
  expect(canLevelRoadGround(world, planned, existing, [protectedPlot])).toBe(false);
  expect(world.heights).toEqual(before);
  expect(world.terrainRevision).toBeUndefined();
});

it("previews the entire network on a sloped apron with exactly the same committed passability", async () => {
  const { canLevelRoadGround } = await import("../src/shared/settlement/road-ground-leveling");
  const { roadGroundPassable } = await import("../src/shared/settlement/road-ground-passability");
  const { levelBuildingFoundation } = await import("../src/shared/settlement/settlement-foundation");
  const { roads, world } = fixture();
  for (let z = 0; z <= 20; z++) for (let x = 0; x <= 20; x++)
    world.heights[z * 21 + x] = 2 + x * .65 + z * .1;
  const plot = { x: 13, z: 14, width: 6, depth: 4,
    y: Math.fround(2 + 13 * .65 + 14 * .1) } as SettlementBuilding;
  levelBuildingFoundation(world, plot, []);
  const existing = roads.slice(0, 20), planned = roads.slice(20);
  const before = world.heights.slice(), revision = world.terrainRevision;
  expect(canLevelRoadGround(world, planned, existing, [plot])).toBe(true);
  expect(world.heights).toEqual(before);
  expect(world.terrainRevision).toBe(revision);
  levelRoadGround(world, [...existing, ...planned], [plot]);
  expect(roadGroundPassable(world, [...existing, ...planned])).toBe(true);
});

it("does not accumulate grading drift after repeat calls, previews or unrelated network changes", async () => {
  const { canLevelRoadGround } = await import("../src/shared/settlement/road-ground-leveling");
  const { roads, world } = fixture();
  levelRoadGround(world, roads, []);
  const graded = world.heights.slice();
  const reference = world.roadGradeBase!.slice();
  for (let pass = 0; pass < 10; pass++) {
    canLevelRoadGround(world, [], roads, []);
    expect(world.roadGradeBase).toEqual(reference);
    expect(levelRoadGround(world, roads, [])).toBeNull();
    expect(world.heights).toEqual(graded);
  }
  world.heights[10 * 21 + 8]! += .3;
  world.terrainRevision!++;
  levelRoadGround(world, roads, []);
  const edited = world.heights.slice();
  expect(levelRoadGround(world, roads, [])).toBeNull();
  expect(world.heights).toEqual(edited);
});

it("keeps a road between different foundation heights within its terrain profile as a new apron is worked", async () => {
  const { canLevelRoadGround } = await import("../src/shared/settlement/road-ground-leveling");
  const { roadGroundPassable } = await import("../src/shared/settlement/road-ground-passability");
  const { levelBuildingFoundation } = await import("../src/shared/settlement/settlement-foundation");
  const { world } = fixture();
  world.heights.fill(2.3);
  // Reduced layout from the supplied October 25 exports: an existing 6x6 foundation,
  // limestone road one tile north of it, then a lower 4x4 fisherman on the other side.
  const southern = { x: 9, z: 15, width: 6, depth: 6,
    y: Math.fround(2.4014177322387695) } as SettlementBuilding;
  const northern = { x: 9, z: 8, width: 4, depth: 4,
    y: Math.fround(2.1399195194244385) } as SettlementBuilding;
  const roads: RoadSegment[] = [
    ...Array.from({ length: 24 }, (_, i) => ({ start: { x: 5 + i * .5, z: 11 },
      end: { x: 5.5 + i * .5, z: 11 }, tier: "limestone" as const })),
    ...Array.from({ length: 10 }, (_, i) => ({ start: { x: 5, z: 16 - i * .5 },
      end: { x: 5, z: 15.5 - i * .5 }, tier: "limestone" as const }))
  ];
  levelBuildingFoundation(world, southern, []);
  levelRoadGround(world, roads, [southern]);
  levelBuildingFoundation(world, northern, [southern]);
  const foundations = world.heights.slice(), buildings = [southern, northern];
  expect(canLevelRoadGround(world, [], roads, buildings)).toBe(true);
  expect(world.heights).toEqual(foundations);
  levelRoadGround(world, roads, buildings);
  expect(roadGroundPassable(world, roads)).toBe(true);
  // Hard cubic camber projections previously pulled these 2.3-high vertices down to 0.02
  // and 0.83, despite both fixed foundations being less than 0.27 apart in height.
  expect(Math.min(...world.heights)).toBeGreaterThan(northern.y - .01);
  expect(Math.max(...world.heights)).toBeLessThan(southern.y + .01);
  for (const building of buildings)
    for (let z = building.z - building.depth / 2; z <= building.z + building.depth / 2; z++)
      for (let x = building.x - building.width / 2; x <= building.x + building.width / 2; x++)
        expect(world.heights[z * 21 + x]).toBe(foundations[z * 21 + x]);
  const graded = world.heights.slice(), reference = world.roadGradeBase!.slice();
  expect(levelRoadGround(world, roads, buildings)).toBeNull();
  expect(world.heights).toEqual(graded);
  expect(world.roadGradeBase).toEqual(reference);
  // A legacy save contains the bad applied result and its intact source terrain. Reload
  // grading repairs that result instead of incorporating the trench into its provenance.
  world.heights[10 * 21 + 4] = .02;
  world.heights[10 * 21 + 6] = .83;
  world.roadGradeApplied = world.heights.slice();
  levelRoadGround(world, roads, buildings);
  expect(world.heights).toEqual(graded);
  expect(world.roadGradeBase).toEqual(reference);
});
