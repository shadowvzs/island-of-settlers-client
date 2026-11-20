import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getPlacedBuildingLogistics } from "../src/render-common/buildings/building-grid-metrics";
import { createBuildingRoadApproaches } from "../src/shared/settlement/building-road-approaches";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { roadRibbonWidth } from "../src/shared/settlement/road-types";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";

const approach = (construction = 1) => ({
  access: { x: 5, z: 5 }, workerApproach: { x: 5, z: 4.5 },
  doorThreshold: { x: 5, z: 4 }, hasDoor: true, construction
});

it.each([0, 29, 39])("keeps the complete two-foot-lane approach wide enough through storage%s", typeId => {
  const rendered = createBuildingRoadApproaches([], [{ ...approach(), typeId }]);
  expect(rendered.length).toBeGreaterThan(0);
  for (const segment of rendered) for (const fraction of [0, .25, .5, .75, 1])
    expect(roadRibbonWidth(segment, fraction)).toBeGreaterThanOrEqual(1);
  expect(rendered.at(-1)!.doorwayWidth).toBeGreaterThan(1);
});

it("omits the neutral archer scaffold's entrance road while preserving public roads", () => {
  const tower = { ...approach(), typeId: 4, bandit: { code: 1, layout: 0 }, hasDoor: false };
  const road = { start: { x: 1, z: 1 }, end: { x: 3, z: 1 }, tier: "dirt" as const };
  expect(createBuildingRoadApproaches([], [tower])).toEqual([]);
  expect(createBuildingRoadApproaches([road], [tower])).toEqual([road]);
  expect(createBuildingRoadApproaches([], [{ ...tower, bandit: undefined }])).toHaveLength(2);
});

it("creates the headquarters and finished-building entrance before a public road exists", () => {
  const finished = approach();
  const disconnected = createBuildingRoadApproaches([], [finished]);
  expect(disconnected).toHaveLength(2);
  expect(disconnected[0]!.start).toEqual(finished.access);
  expect(disconnected[1]!.end).toEqual(finished.doorThreshold);
  expect(disconnected.every(segment => segment.tier === "dirt")).toBe(true);
  expect(disconnected[1]!.doorway).toBe(true);
});

it.each([0, .75, 1])("shows a local stub at construction %s without connecting the public graph", (construction) => {
  const building = approach(construction);
  const roads = createRoadNetwork({ cellsX: 12, cellsZ: 12, heights: new Float32Array(13 ** 2),
    blocking: new Uint8Array(12 ** 2) });
  const graph = roads.segments();
  const rendered = createBuildingRoadApproaches(graph, [building]);
  expect(rendered).toHaveLength(2);
  expect(rendered[0]!.start).toEqual(building.access);
  expect(rendered[1]!.end).toEqual(building.doorThreshold);
  expect(rendered.every(segment => segment.tier === "dirt")).toBe(true);
  expect(roads.segments()).toEqual(graph);
  expect(roads.route(building.access, building.doorThreshold)).toBeNull();
  const external = { start: building.access, end: { x: 6, z: 5 }, tier: "dirt" as const };
  expect(createBuildingRoadApproaches([external], [building])).toHaveLength(3);
});

it("inherits stone upgrade at a mixed-tier junction without adding interior public graph edges", () => {
  const finished = approach();
  const roads = createRoadNetwork({ cellsX: 12, cellsZ: 12, heights: new Float32Array(13 ** 2),
    blocking: new Uint8Array(12 ** 2) });
  roads.addRoad(finished.access, { x: 7, z: 5 });
  roads.addRoad(finished.access, { x: 5, z: 7 });
  roads.upgradeRoad(finished.access, { x: 7, z: 5 }, () => true);
  const graph = roads.segments();
  const rendered = createBuildingRoadApproaches(graph, [finished]);
  expect(rendered.slice(graph.length).every(segment => segment.tier === "stone")).toBe(true);
  expect(roads.route(finished.access, finished.doorThreshold)).toBeNull();
  expect(roads.segments()).toEqual(graph);
});

it.each([0, 1, 2, 3])("connects an entire road ribbon to the precise rotated doorway %i", (rotation) => {
  const make = (id: number, left: number, top: number, turn: number) => {
    const [w, d] = getBuildingDefinition(id).gridFootprint;
    const width = turn % 2 ? d : w, depth = turn % 2 ? w : d;
    const x = left + width / 2, z = top + depth / 2;
    const logistics = getPlacedBuildingLogistics(id, x, z, turn);
    return { x, z, width, depth, access: logistics.road,
      workerApproach: logistics.workerApproach, doorThreshold: logistics.doorThreshold,
      hasDoor: logistics.hasDoor } as SettlementBuilding;
  };
  const buildings = [make(0, 4, 4, 0), make(17, 19, 17, rotation)];
  const roads = createRoadNetwork({ cellsX: 40, cellsZ: 40, heights: new Float32Array(41 ** 2),
    blocking: new Uint8Array(40 ** 2) }, { isBlocked: (x, z) => buildings.some((b) =>
      x >= b.x - b.width / 2 && x < b.x + b.width / 2 &&
      z >= b.z - b.depth / 2 && z < b.z + b.depth / 2) });
  expect(roads.addRoad(buildings[0]!.access, buildings[1]!.access)).toBe(true);
  expect(roads.route(buildings[0]!.access, buildings[1]!.access)).not.toBeNull();
  const rendered = createBuildingRoadApproaches(roads.segments(), buildings);
  for (const building of buildings) {
    const end = rendered.find((segment) => segment.doorway &&
      segment.end.x === building.doorThreshold.x && segment.end.z === building.doorThreshold.z);
    expect(end).toBeDefined();
    expect(end!.tier).toBe("dirt");
  }
  expect(roads.segments().some((segment) => segment.doorway)).toBe(false);
});
