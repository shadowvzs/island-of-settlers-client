import { ROAD_SPEED } from "@shared/catalog/balance";
import { expect, it, vi } from "vitest";

import {
  buildingRoadApproachSpeedAt, createBuildingRoadApproaches
} from "../src/shared/settlement/building-road-approaches";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { settlementRoadSpeedAt } from "../src/shared/settlement/settlement-road-speed";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

const fixture = () => {
  const roads = createRoadNetwork({ cellsX: 12, cellsZ: 12,
    heights: new Float32Array(13 ** 2), blocking: new Uint8Array(12 ** 2) });
  const building = { access: { x: 5, z: 5 }, workerApproach: { x: 5, z: 4.5 },
    doorThreshold: { x: 5, z: 3.5 }, hasDoor: true, construction: 1 };
  const context = { options: { roads }, buildings: [building] } as unknown as SettlementContext;
  return { roads, context, building };
};

it("gives carriers the connected road's stone speed throughout the physical entrance ribbon", () => {
  const { building, context, roads } = fixture();
  const point = { x: 5, z: 3.8 };
  expect(settlementRoadSpeedAt(context, point)).toBe(ROAD_SPEED.dirt);
  roads.addRoad(building.access, { x: 7, z: 5 });
  expect(settlementRoadSpeedAt(context, point)).toBe(ROAD_SPEED.dirt);
  roads.upgradeRoad(building.access, { x: 7, z: 5 }, () => true);
  expect(roads.speedAt(point)).toBe(ROAD_SPEED.dirt);
  expect(settlementRoadSpeedAt(context, point)).toBe(ROAD_SPEED.stone);
  expect(settlementRoadSpeedAt(context, { x: 5.5, z: 3.8 })).toBe(ROAD_SPEED.dirt);
  expect(settlementRoadSpeedAt(context, { x: 5, z: 3 })).toBe(ROAD_SPEED.dirt);
});

it("caches entrance geometry until road topology/tier or building count changes", () => {
  const { building, context, roads } = fixture();
  const segments = vi.spyOn(roads, "segments");
  const point = { x: 5, z: 3.8 };
  settlementRoadSpeedAt(context, point);
  settlementRoadSpeedAt(context, point);
  expect(segments).toHaveBeenCalledTimes(1);
  roads.addRoad(building.access, { x: 7, z: 5 });
  settlementRoadSpeedAt(context, point);
  expect(segments).toHaveBeenCalledTimes(2);
  roads.upgradeRoad(building.access, { x: 7, z: 5 }, () => true);
  settlementRoadSpeedAt(context, point);
  expect(segments).toHaveBeenCalledTimes(3);
  context.buildings.push({ ...context.buildings[0]! });
  settlementRoadSpeedAt(context, point);
  expect(segments).toHaveBeenCalledTimes(4);
});

it("keeps the stone bonus inside the same tapered doorway ribbon as the rendered road", () => {
  const { building, context, roads } = fixture();
  roads.addRoad(building.access, { x: 7, z: 5 });
  roads.upgradeRoad(building.access, { x: 7, z: 5 }, () => true);
  expect(settlementRoadSpeedAt(context, { x: 5.15, z: 3.6 })).toBe(ROAD_SPEED.stone);
  expect(settlementRoadSpeedAt(context, { x: 5.35, z: 3.6 })).toBe(ROAD_SPEED.dirt);
  expect(settlementRoadSpeedAt(context, { x: 5.35, z: 4.4 })).toBe(ROAD_SPEED.stone);
});

it("answers from the bucketed approaches exactly like a scan of every approach lane", () => {
  const { building, context, roads } = fixture();
  context.buildings.push({ ...building, access: { x: 8, z: 7 }, workerApproach: { x: 8.6, z: 7.4 },
    doorThreshold: { x: 9.2, z: 8.1 } } as unknown as SettlementBuilding);
  roads.addRoad(building.access, { x: 8, z: 7 });
  roads.upgradeRoad(building.access, { x: 8, z: 7 }, () => true);
  const graph = roads.segments();
  const approaches = createBuildingRoadApproaches(graph, context.buildings).slice(graph.length);
  for (let z = 2; z <= 10; z += .07) for (let x = 2; x <= 11; x += .09) {
    const point = { x, z };
    const expected = Math.max(roads.speedAt(point), buildingRoadApproachSpeedAt(point, approaches));
    expect(settlementRoadSpeedAt(context, point)).toBe(expected);
  }
});
