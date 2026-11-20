import { ROAD_SPEED } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { createRoadGeometry } from "../src/renderers/three/settlement/road-geometry";
import {
  createBuildingRoadApproaches,
  ENTRANCE_FLARE_LENGTH
} from "../src/shared/settlement/building-road-approaches";
import { fitStoneRoadWidths, fittedStoneWidth } from "../src/shared/settlement/road-fitted-widths";
import { levelRoadGround } from "../src/shared/settlement/road-ground-leveling";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { ROAD_STONE_WIDTH, ROAD_WIDTH, roadRibbonWidth, type RoadSegment } from "../src/shared/settlement/road-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const line = (from: number, to: number, z: number, tier: RoadSegment["tier"]): RoadSegment[] =>
  Array.from({ length: Math.round((to - from) * 2) }, (_, index) => ({
    start: { x: from + index * .5, z }, end: { x: from + (index + 1) * .5, z }, tier
  }));

/** Widest lateral extent of a straight east-west ribbon's vertices (z offset from its centreline). */
const ribbonHalfWidth = (segments: RoadSegment[], tier: RoadSegment["tier"], z: number, x: number) => {
  const geometry = createRoadGeometry(segments, tier, true, () => 0);
  const positions = geometry.getAttribute("position");
  let half = 0;
  for (let index = 0; index < positions.count; index++)
    if (Math.abs(positions.getX(index) - x) < .2) half = Math.max(half, Math.abs(positions.getZ(index) - z));
  geometry.dispose();
  return half;
};

describe("stone road width", () => {
  it("keeps an unobstructed paved junction wide beside a dirt branch", () => {
    const stone = line(2, 4, 3, "stone");
    const dirt: RoadSegment = { start: { x: 3, z: 3 }, end: { x: 3, z: 3.5 }, tier: "dirt" };
    const fitted = fitStoneRoadWidths([...stone, dirt], { isBlocked: () => false });
    for (const segment of fitted.filter(segment => segment.tier === "stone"))
      expect(roadRibbonWidth(segment, .5)).toBe(ROAD_STONE_WIDTH);
    expect(roadRibbonWidth(fitted.at(-1)!, .5)).toBe(ROAD_WIDTH);
  });

  it("draws dirt at 0.8 and upgraded stone at 1.2 on the same graph edges", () => {
    expect(ribbonHalfWidth(line(1, 6, 3, "dirt"), "dirt", 3, 3.5)).toBeCloseTo(ROAD_WIDTH / 2, 1);
    expect(ribbonHalfWidth(line(1, 6, 3, "stone"), "stone", 3, 3.5)).toBeCloseTo(ROAD_STONE_WIDTH / 2, 1);
    expect(roadRibbonWidth(line(1, 2, 3, "stone")[0]!, .5)).toBe(ROAD_STONE_WIDTH);
    expect(roadRibbonWidth(line(1, 2, 3, "dirt")[0]!, .5)).toBe(ROAD_WIDTH);
  });

  it("keeps the doorway taper and flares a stone junction into the dirt-width entrance lane", () => {
    const building = { access: { x: 5, z: 5 }, construction: 1, doorThreshold: { x: 5, z: 3.6 }, hasDoor: true,
      workerApproach: { x: 5, z: 4.2 } };
    const stub = { start: { x: 5, z: 5 }, end: { x: 5, z: 5.5 }, tier: "stone" as const };
    const lanes = createBuildingRoadApproaches([stub], [building]).slice(1);
    expect(lanes).toHaveLength(3);
    const [flare, lane, doorway] = lanes as [RoadSegment, RoadSegment, RoadSegment];
    expect(Math.hypot(flare.end.x - flare.start.x, flare.end.z - flare.start.z)).toBeCloseTo(ENTRANCE_FLARE_LENGTH);
    expect(roadRibbonWidth(flare, 0)).toBe(ROAD_STONE_WIDTH);
    expect(roadRibbonWidth(flare, 1)).toBe(ROAD_WIDTH);
    expect(roadRibbonWidth(lane, .5)).toBe(ROAD_WIDTH);
    expect(roadRibbonWidth(doorway, 1)).toBeCloseTo(.34);
    const dirt = createBuildingRoadApproaches([{ ...stub, tier: "dirt" }], [building]).slice(1);
    expect(dirt).toHaveLength(2);
    expect(dirt.every(segment => segment.startWidth === undefined)).toBe(true);
  });

  it("narrows an upgraded old road beside an intruding plot and tapers back to the full width", () => {
    // A plot from z = 3.5 down: the road on z = 3 has only 0.5 free on that side.
    const plot = (x: number, z: number) => x >= 4 && x < 6 && z >= 3.5;
    const obstacles = { isBlocked: plot };
    const road = line(1, 9, 3, "stone");
    expect(fittedStoneWidth(road[0]!, obstacles)).toBeCloseTo(ROAD_STONE_WIDTH);
    expect(fittedStoneWidth(road.find(segment => segment.start.x === 4.5)!, obstacles)).toBeCloseTo(1);
    const fitted = fitStoneRoadWidths(road, obstacles);
    const at = (x: number) => fitted.find(segment => segment.start.x === x)!;
    expect(roadRibbonWidth(at(4.5), .5)).toBeCloseTo(1);
    // The neighbouring half cells taper between the narrowed node and the full stone width.
    expect(roadRibbonWidth(at(3), 0)).toBeCloseTo(ROAD_STONE_WIDTH);
    expect(roadRibbonWidth(at(3), 1)).toBeCloseTo(1);
    expect(roadRibbonWidth(at(6), 0)).toBeCloseTo(1);
    expect(roadRibbonWidth(at(6), 1)).toBeCloseTo(ROAD_STONE_WIDTH);
    expect(at(1).startWidth).toBeUndefined();
    // The graph is untouched: same edges, same tier.
    expect(fitted.map(({ end, start, tier }) => ({ end, start, tier }))).toEqual(road);
    expect(ribbonHalfWidth(fitted, "stone", 3, 5)).toBeLessThan(.52);
  });

  it("never narrows below the dirt width and keeps clear of signpost stakes", () => {
    const segment = line(1, 1.5, 3, "stone")[0]!;
    expect(fittedStoneWidth(segment, { isBlocked: () => true })).toBe(ROAD_WIDTH);
    expect(fittedStoneWidth(segment, { clearance: () => .47, isBlocked: () => false })).toBeCloseTo(.9);
  });

  it("levels a wider bed under stone roads than under dirt roads", () => {
    const size = 20;
    const slopedWorld = () => {
      const world = { cellsX: size, cellsZ: size, heights: new Float32Array((size + 1) ** 2), seaLevel: -5,
        waterDepth: new Float32Array((size + 1) ** 2) } as unknown as WorldData;
      for (let z = 0; z <= size; z++) for (let x = 0; x <= size; x++)
        world.heights[z * (size + 1) + x] = z * .12;
      return world;
    };
    const dirt = slopedWorld(), stone = slopedWorld();
    levelRoadGround(dirt, line(4, 14, 10, "dirt"), []);
    levelRoadGround(stone, line(4, 14, 10, "stone"), []);
    // One cell off the centreline the stone bed is levelled more fully than the dirt bed.
    const vertex = 11 * (size + 1) + 8, original = 11 * .12, centre = 10 * .12;
    expect(Math.abs(stone.heights[vertex]! - centre)).toBeLessThan(Math.abs(dirt.heights[vertex]! - centre));
    expect(Math.abs(dirt.heights[vertex]! - original)).toBeGreaterThan(0);
  });

  it("invalidates cached travel routes when a road is upgraded", () => {
    const size = 16;
    const world = { blocking: new Uint8Array(size * size), buildClass: new Uint8Array(size * size).fill(BUILD.large),
      cellsX: size, cellsZ: size, heights: new Float32Array((size + 1) ** 2) } as unknown as WorldData;
    const roads = createRoadNetwork(world, { verifyRouteCache: 1 });
    roads.addRoad({ x: 2, z: 4 }, { x: 10, z: 4 });
    const dirtCost = roads.route({ x: 2, z: 4 }, { x: 10, z: 4 })!.cost;
    expect(roads.route({ x: 2, z: 4 }, { x: 10, z: 4 })!.cost).toBe(dirtCost);
    expect(roads.upgradeRoad({ x: 2, z: 4 }, { x: 10, z: 4 }, () => true)).toBe(true);
    expect(roads.route({ x: 2, z: 4 }, { x: 10, z: 4 })!.cost)
      .toBeCloseTo(dirtCost * ROAD_SPEED.dirt / ROAD_SPEED.stone);
    expect(roads.speedAt({ x: 5, z: 4.55 })).toBe(ROAD_SPEED.stone);
    expect(roads.speedAt({ x: 5, z: 4 + ROAD_STONE_WIDTH / 2 - .05 })).toBe(ROAD_SPEED.stone);
    expect(roads.speedAt({ x: 5, z: 4 + ROAD_STONE_WIDTH / 2 + .05 })).toBe(ROAD_SPEED.dirt);
  });
});
