import { expect, it, vi } from "vitest";

import { type BridgePlan,planBridge } from "../src/shared/settlement/bridge-planning";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createRoadTraversal } from "../src/shared/settlement/road-traversal";
import {
  ROAD_GRID_STEP,
  type RoadPoint,
  type RoadSegment,
  type RoadTier
} from "../src/shared/settlement/road-types";
import { bridgeRules, bridgeTestWorld } from "./helpers/bridge-world";

const planned = (result: ReturnType<typeof planBridge>): BridgePlan => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.plan;
};

const lineRoads = (start: RoadPoint, end: RoadPoint, tier: RoadTier): RoadSegment[] => {
  const roads: RoadSegment[] = [];
  for (let x = start.x; x < end.x; x += ROAD_GRID_STEP)
    roads.push({ end: { x: x + ROAD_GRID_STEP, z: start.z }, start: { x, z: start.z }, tier });
  return roads;
};

const fixture = () => {
  const world = bridgeTestWorld();
  const plan = planned(planBridge({
    id: 42,
    kind: "wood",
    pointer: { x: 9, z: 6 },
    rules: bridgeRules(world),
    world
  }));
  const roads = createRoadNetwork(world);
  const saved = [
    ...lineRoads({ x: 3, z: 6 }, { x: 7, z: 6 }, "stone"),
    ...plan.segments,
    ...lineRoads({ x: 11, z: 6 }, { x: 15, z: 6 }, "stone")
  ];
  return { plan, roads, saved, world };
};

it("routes land traffic across completed bridge tiles without making water walkable", () => {
  const { plan, roads, saved, world } = fixture();
  const traversal = createRoadTraversal(world, {});
  expect(traversal.blocked(9, 6)).toBe(true);
  expect(roads.planRoad({ x: 3, z: 6 }, { x: 15, z: 6 })).toBeNull();
  expect(roads.replaceSegments(saved)).toBe(true);

  const route = roads.route({ x: 3, z: 6 }, { x: 15, z: 6 });
  expect(route).not.toBeNull();
  expect(route!.length).toBe(12);
  expect(route!.points.map(({ x }) => x)).toEqual(expect.arrayContaining([7, 11]));
  expect(roads.stoneRoute({ x: 3, z: 6 }, { x: 15, z: 6 })).not.toBeNull();
  // Only the explicit deck edges cross the river: unrelated water cells stay outside the graph.
  expect(roads.route({ x: 3, z: 7 }, { x: 15, z: 7 })).toBeNull();
  expect(traversal.blocked(9, 6)).toBe(true);
  expect(plan.segments.every(segment => segment.bridge?.width === 2.6)).toBe(true);
});

it("round-trips bridge identity through the public road save shape", () => {
  const { roads, saved, world } = fixture();
  expect(roads.replaceSegments(saved)).toBe(true);
  const exported = JSON.parse(JSON.stringify(roads.segments())) as RoadSegment[];
  expect(exported.filter(segment => segment.bridge)).toHaveLength(8);
  expect(exported.filter(segment => !segment.bridge)).toHaveLength(16);

  const restored = createRoadNetwork(world);
  expect(restored.replaceSegments(exported)).toBe(true);
  expect(restored.segments()).toEqual(exported);
  expect(restored.route({ x: 3, z: 6 }, { x: 15, z: 6 })?.length).toBe(12);
});

it("rejects malformed bridge groups atomically", () => {
  const { roads, saved, world } = fixture();
  expect(roads.replaceSegments(saved)).toBe(true);
  const before = roads.segments();
  const cases = [
    (tiles: RoadSegment[]) => {
      tiles.find(segment => segment.bridge)!.bridge!.width = 1.3;
    },
    (tiles: RoadSegment[]) => {
      tiles.splice(tiles.findIndex(segment => segment.bridge), 1);
    },
    (tiles: RoadSegment[]) => {
      const bridge = tiles.filter(segment => segment.bridge);
      bridge[1]!.bridge!.tile = 0;
    },
    (tiles: RoadSegment[]) => {
      const bridge = tiles.filter(segment => segment.bridge);
      [bridge[1]!.start, bridge[1]!.end] = [bridge[1]!.end, bridge[1]!.start];
    },
    (tiles: RoadSegment[]) => {
      for (const segment of tiles) if (segment.bridge) segment.bridge.kind = "iron" as never;
    }
  ];
  for (const mutate of cases) {
    const malformed = structuredClone(before);
    mutate(malformed);
    const candidate = createRoadNetwork(world);
    expect(candidate.replaceSegments(malformed)).toBe(false);
    expect(candidate.segments()).toEqual([]);
  }
  expect(roads.segments()).toEqual(before);
});

it("removes a whole span when one bridge tile is demolished", () => {
  const { roads, saved } = fixture();
  expect(roads.replaceSegments(saved)).toBe(true);
  const tile = roads.segments().find(segment => segment.bridge)!;
  expect(roads.removeRoad(tile.start, tile.end)).toBe(true);
  expect(roads.segments().filter(segment => segment.bridge)).toEqual([]);
  expect(roads.segments()).toHaveLength(16);
});

it("refuses material upgrades through a bridge span", () => {
  const { roads, saved } = fixture();
  expect(roads.replaceSegments(saved)).toBe(true);
  const pay = vi.fn(() => true);
  expect(roads.upgradeRoad({ x: 3, z: 6 }, { x: 15, z: 6 }, pay)).toBe(false);
  expect(pay).not.toHaveBeenCalled();
});
