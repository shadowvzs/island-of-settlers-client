import { describe, expect, it } from "vitest";

import { snapBuildingPlot } from "../src/app/settlement/building-plot";
import { getPlacedBuildingLogistics } from "../src/render-common/buildings/building-grid-metrics";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createRoadStripIndex, parallelRoadConflict } from "../src/shared/settlement/road-reserved-strip";
import { ROAD_PLACEMENT_HALF_WIDTH, ROAD_PLACEMENT_WIDTH, ROAD_RESERVED_HALF_WIDTH, ROAD_STONE_WIDTH, ROAD_VERGE_WIDTH, ROAD_WIDTH } from "../src/shared/settlement/road-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { createPlacementSession } from "./helpers/placement-session";

const WOODCUTTER = 17;

const flatWorld = (size = 24) => ({
  cellsX: size, cellsZ: size, heights: new Float32Array((size + 1) ** 2),
  blocking: new Uint8Array(size * size), buildClass: new Uint8Array(size * size).fill(BUILD.large)
}) as unknown as WorldData;

type Plan = { segments: { end: { x: number; z: number }; start: { x: number; z: number } }[] } | null;
/** True when a planned road has an east-west half-cell edge on row `z` between `from` and `to`. */
const runsAlongRow = (plan: Plan, z: number, from = -Infinity, to = Infinity) =>
  !!plan?.segments.some(({ end, start }) => start.z === z && end.z === z &&
    Math.min(start.x, end.x) >= from && Math.max(start.x, end.x) <= to);

/** A Woodcutter plot south-west of the headquarters, its flag and the plot's front edge. */
const woodcutterSite = (simulation: ReturnType<typeof createPlacementSession>["simulation"]) => {
  const { headquarters } = simulation;
  const plot = snapBuildingPlot(WOODCUTTER, { x: headquarters.x - 9, z: headquarters.z + 9 }, 0);
  const flag = getPlacedBuildingLogistics(WOODCUTTER, plot.x, plot.z, 0).road;
  return { flag, front: plot.z + plot.depth / 2, plot };
};

describe("reserved stone width", () => {
  it("keeps0.9 dirt and1.3 paving inside2.3 logical placement width, even without decoration", () => {
    expect(ROAD_WIDTH).toBe(.9);
    expect(ROAD_STONE_WIDTH).toBe(1.3);
    expect(ROAD_RESERVED_HALF_WIDTH).toBe(ROAD_STONE_WIDTH / 2);
    expect(ROAD_VERGE_WIDTH).toBe(.5);
    expect(ROAD_PLACEMENT_WIDTH).toBe(2.3);
    expect(ROAD_PLACEMENT_HALF_WIDTH).toBe(1.15);
  });

  it("refuses a plot whose edge lies inside a road's reserved strip, also beside a dirt road", () => {
    const { simulation } = createPlacementSession();
    const { flag, front, plot } = woodcutterSite(simulation);
    expect(simulation.validatePlacement(WOODCUTTER, plot.x, plot.z, 0)).toBeNull();
    // A dirt road parallel to the front, half a cell away: 0.8 fits, the reserved 1.2 does not.
    expect(simulation.connectRoads({ x: plot.x - 3, z: front + .5 }, { x: plot.x + 3, z: front + .5 })).toBe(true);
    expect(flag.z).toBe(front + .5);
    expect(simulation.validatePlacement(WOODCUTTER, plot.x, plot.z, 0)).toMatch(/reserved stone width/);
  });

  it("accepts a plot beyond the full verge and a road arriving straight at its flag", () => {
    const { simulation } = createPlacementSession();
    const { flag, front, plot } = woodcutterSite(simulation);
    expect(simulation.connectRoads({ x: plot.x - 3, z: front + 1.5 }, { x: plot.x + 3, z: front + 1.5 })).toBe(true);
    expect(simulation.validatePlacement(WOODCUTTER, plot.x, plot.z, 0)).toBeNull();
    expect(simulation.connectRoads(flag, { x: flag.x, z: front + 1.5 })).toBe(true);
    expect(simulation.validatePlacement(WOODCUTTER, plot.x, plot.z, 0)).toBeNull();
  });

  it("plans new roads with the reserved strip beside plots, while built roads stay usable", () => {
    const { simulation } = createPlacementSession();
    const { headquarters } = simulation;
    const front = headquarters.z + headquarters.depth / 2, left = headquarters.x - headquarters.width / 2;
    // Half a cell from the headquarters plot the 1.2 strip would cover its forecourt: the planner
    // steps out to the first row whose strip stays clear.
    const near = simulation.planRoad({ x: left + 1, z: front + .5 }, { x: left + 4, z: front + .5 }, "dirt");
    expect(near).not.toBeNull();
    expect(runsAlongRow(near, front + .5)).toBe(false);
    expect(runsAlongRow(near, front + 1.5)).toBe(true);
    const clear = simulation.planRoad({ x: left + 1, z: front + 1.5 }, { x: left + 4, z: front + 1.5 }, "dirt");
    expect(clear?.points).toHaveLength(7);
  });

  it("refuses a road whose strip would cover a signpost stake", () => {
    const world = flatWorld();
    const roads = createRoadNetwork(world, {
      isStripReserved: (start, end) => Math.min(start.x, end.x) <= 5 && Math.max(start.x, end.x) >= 5 &&
        Math.abs(start.z - 5.55) < .6
    });
    expect(runsAlongRow(roads.planRoad({ x: 2, z: 5 }, { x: 8, z: 5 }), 5, 4.5, 5.5)).toBe(false);
    expect(roads.planRoad({ x: 2, z: 7 }, { x: 8, z: 7 })?.points).toHaveLength(13);
  });

  it("refuses parallel roads closer than the stone width but allows joins and crossings", () => {
    const roads = createRoadNetwork(flatWorld());
    expect(roads.addRoad({ x: 2, z: 10 }, { x: 12, z: 10 })).toBe(true);
    // Closer rows only join the existing road with short perpendicular stubs.
    expect(runsAlongRow(roads.planRoad({ x: 3, z: 10.5 }, { x: 8, z: 10.5 }), 10.5)).toBe(false);
    expect(runsAlongRow(roads.planRoad({ x: 3, z: 11 }, { x: 8, z: 11 }), 11)).toBe(false);
    expect(roads.planRoad({ x: 3, z: 11.5 }, { x: 8, z: 11.5 })?.points).toHaveLength(11);
    // A branch leaving the road at a right angle, and a crossing road.
    expect(roads.addRoad({ x: 6, z: 10 }, { x: 6, z: 15 })).toBe(true);
    expect(roads.addRoad({ x: 9, z: 6 }, { x: 9, z: 14 })).toBe(true);
    const has = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      roads.segments().some(segment => (segment.start.x === a.x && segment.start.z === a.z &&
        segment.end.x === b.x && segment.end.z === b.z) || (segment.end.x === a.x && segment.end.z === a.z &&
        segment.start.x === b.x && segment.start.z === b.z));
    expect(parallelRoadConflict({ x: 4, z: 11 }, { x: 4.5, z: 11 }, has)).toBe(true);
    expect(parallelRoadConflict({ x: 4, z: 9 }, { x: 4, z: 9.5 }, has)).toBe(false);
  });

  it("indexes centrelines for cell and rectangle queries and follows the road revision", () => {
    const roads = createRoadNetwork(flatWorld());
    const index = createRoadStripIndex(roads);
    expect(index.isCellClear(5, 4)).toBe(true);
    roads.addRoad({ x: 2, z: 5 }, { x: 8, z: 5 });
    // Cells touching the centreline and the next row inside 0.6 are reserved; one cell beyond is clear.
    expect(index.isCellClear(5, 4)).toBe(false);
    expect(index.isCellClear(5, 5)).toBe(false);
    expect(index.isCellClear(5, 6)).toBe(false);
    expect(index.isCellClear(5, 3)).toBe(false);
    expect(index.isCellClear(5, 7)).toBe(true);
    expect(index.isCellClear(5, 2)).toBe(true);
    expect(index.findInRect({ bottom: 4.5, left: 4, right: 6, top: 4 })).not.toBeNull();
  });
});
