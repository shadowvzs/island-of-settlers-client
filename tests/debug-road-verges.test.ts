import { expect, it } from "vitest";

import { ROAD_GRID_STEP, type RoadPoint, type RoadSegment } from "../src/shared/settlement/road-types";
import { createPlacementSession } from "./helpers/placement-session";

const VERGE_STOCK = { hammer: 4, planks: 60, stone: 60 };

const straightRun = (start: RoadPoint, dx: number, dz: number, count: number): RoadSegment[] =>
  Array.from({ length: count }, (_, index) => ({
    start: { x: start.x + dx * index, z: start.z + dz * index },
    end: { x: start.x + dx * (index + 1), z: start.z + dz * (index + 1) },
    tier: "dirt"
  }));

const bridgeRun = (start: RoadPoint, count = 6): RoadSegment[] =>
  straightRun(start, 0, ROAD_GRID_STEP, count).map((segment, tile) => ({
    ...segment,
    bridge: { id: 1, kind: "wood" as const, width: 2.6, tile, tiles: count }
  }));

/** A foreign road is outside the headquarters' 48-tile territory and its storage network. */
const isForeign = (segment: RoadSegment) => Math.min(segment.start.x, segment.end.x) > 100;

it("plants every owned public road and skips bridges and foreign roads", () => {
  const { roads, simulation } = createPlacementSession({ initialSettlers: 12,
    initialStock: { ...VERGE_STOCK } });
  const { access } = simulation.headquarters;
  const far = { x: access.x, z: access.z + 3 };
  expect(simulation.connectRoads(access, far)).toBe(true);
  const bridgeStart = { x: access.x, z: access.z + 4 };
  expect(simulation.connectRoads(access, bridgeStart)).toBe(true);
  const bridgeEnd = { x: bridgeStart.x, z: bridgeStart.z + 3 };
  expect(roads.replaceSegments([...roads.segments(), ...bridgeRun(bridgeStart),
    ...straightRun(bridgeEnd, 0, ROAD_GRID_STEP, 1),
    ...straightRun({ x: 105, z: 105 }, ROAD_GRID_STEP, 0, 3)])).toBe(true);

  const report = simulation.debugPlantRoadVerges();
  const segments = simulation.roadSegments();
  const plantable = segments.filter(segment => !segment.bridge && !isForeign(segment));
  expect(report.planted).toBe(plantable.length);
  expect(report.planted).toBeGreaterThan(0);
  for (const segment of segments) {
    if (segment.bridge || isForeign(segment)) expect(segment.verge).toBeUndefined();
    else expect(segment.verge).toBe("flowers");
  }
  expect(simulation.debugPlantRoadVerges()).toEqual({ planted: 0 });
});

it("plants nothing twice and leaves other verge kinds untouched", () => {
  const { roads, simulation } = createPlacementSession({ initialSettlers: 12,
    initialStock: { ...VERGE_STOCK } });
  const { access } = simulation.headquarters;
  const far = { x: access.x, z: access.z + 3 };
  expect(simulation.connectRoads(access, far)).toBe(true);
  expect(simulation.debugPlantRoadVerges().planted).toBeGreaterThan(0);
  const before = roads.revision;
  expect(simulation.debugPlantRoadVerges()).toEqual({ planted: 0 });
  expect(roads.revision).toBe(before);
});
