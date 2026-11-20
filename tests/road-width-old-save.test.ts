import { describe, expect, it } from "vitest";

import { createBuildingRoadApproaches } from "../src/shared/settlement/building-road-approaches";
import { fitStoneRoadWidths } from "../src/shared/settlement/road-fitted-widths";
import type { StripRect } from "../src/shared/settlement/road-reserved-strip";
import { createRoadTraversal } from "../src/shared/settlement/road-traversal";
import { ROAD_STONE_WIDTH, ROAD_WIDTH, roadRibbonWidth, type RoadSegment } from "../src/shared/settlement/road-types";
import { createSignpostStakes, plotRect } from "../src/shared/settlement/settlement-road-strip-placement";
import { createPlacementSession } from "./helpers/placement-session";

const WOODCUTTER = 17, WELL = 35;
type Session = ReturnType<typeof createPlacementSession>;

/**
 * A crowded town saved before the reserved stone width (2026-10-14): two Woodcutters and a Well
 * packed beside the headquarters, every flag on one dirt road that runs half a cell in front of
 * the plots (allowed then, inside today's reserved strip).
 */
const crowdedOldSave = () => {
  const { simulation } = createPlacementSession();
  const { headquarters } = simulation;
  const front = headquarters.z + headquarters.depth / 2;
  const hqLeft = headquarters.x - headquarters.width / 2;
  const place = (typeId: number, right: number, depth: number, width: number) => {
    const x = right - width / 2, z = front - depth / 2;
    expect(simulation.validatePlacement(typeId, x, z, 0)).toBeNull();
    expect(simulation.placeBuilding(typeId, x, z, 0)).toBeTruthy();
  };
  place(WOODCUTTER, hqLeft - 1, 4, 4);
  place(WOODCUTTER, hqLeft - 6, 4, 4);
  place(WELL, hqLeft - 11, 2, 2);
  // The old road: straight along the fronts through every flag, written as an old save stored it.
  const row = front + .5, from = hqLeft - 14, to = headquarters.x + headquarters.width / 2 + 2;
  const roads: RoadSegment[] = [];
  for (let x = from; x < to; x += .5) roads.push({ end: { x: x + .5, z: row }, start: { x, z: row }, tier: "dirt" });
  const saved = JSON.parse(JSON.stringify({ ...simulation.saveState(), roads }));
  return { from, row, saved, to };
};

const loadOldSave = () => {
  const old = crowdedOldSave();
  const session = createPlacementSession();
  const loaded = session.simulation.loadState(old.saved);
  return { ...old, loaded, session };
};

/** Samples the east-west ribbon's edges: true when any edge point lies strictly inside the plot. */
const ribbonCoversPlot = (segment: RoadSegment, plot: StripRect) => {
  for (let step = 0; step <= 10; step++) {
    const fraction = step / 10, half = roadRibbonWidth(segment, fraction) / 2;
    const x = segment.start.x + (segment.end.x - segment.start.x) * fraction;
    if (x <= plot.left + 1e-6 || x >= plot.right - 1e-6) continue;
    for (const z of [segment.start.z - half, segment.start.z + half])
      if (z > plot.top + 1e-6 && z < plot.bottom - 1e-6) return true;
  }
  return false;
};

const fitted = (session: Session) => {
  const { roads, simulation, world } = session;
  const obstacles = {
    clearance: createSignpostStakes(world, () => simulation.buildings()).clearance,
    isBlocked: createRoadTraversal(world, { isBlocked: (x, z) => simulation.isOccupied(x, z) }).blocked
  };
  return fitStoneRoadWidths(createBuildingRoadApproaches(roads.segments(), simulation.buildings()),
    obstacles).slice(0, roads.segments().length);
};

describe("old saves with roads inside today's reserved strip", () => {
  it("load unchanged: every road and building keeps its place", () => {
    const { loaded, saved, session } = loadOldSave();
    expect(loaded).toEqual({ ok: true });
    expect(session.simulation.roadSegments()).toEqual(saved.roads);
    expect(session.simulation.buildings().map(({ rotation, typeId, x, z }) => ({ rotation, typeId, x, z })))
      .toEqual(saved.buildings.map(({ rotation, typeId, x, z }: Record<string, number>) =>
        ({ rotation, typeId, x, z })));
  });

  it("keep routing carriers between the crowded flags", () => {
    const { session } = loadOldSave();
    const flags = session.simulation.buildings().map(building => building.access);
    for (const flag of flags.slice(1)) expect(session.roads.route(flags[0]!, flag)).not.toBeNull();
  });

  it("upgrade every crowded stretch without a refusal, then narrow only where plots intrude", () => {
    const { from, row, session, to } = loadOldSave();
    const { simulation } = session;
    expect(simulation.upgradeRoad({ x: from, z: row }, { x: to, z: row })).toBe(true);
    expect(simulation.roadSegments().every(segment => segment.tier === "stone")).toBe(true);
    const plots = simulation.buildings().map(plotRect);
    const widths = fitted(session).map(segment => ({
      end: roadRibbonWidth(segment, 1), segment, start: roadRibbonWidth(segment, 0)
    }));
    for (const { end, segment, start } of widths) {
      // Never below the dirt width it was built with, and the drawn ribbon never covers a plot.
      expect(Math.min(start, end)).toBeGreaterThanOrEqual(ROAD_WIDTH - 1e-6);
      expect(plots.some(plot => ribbonCoversPlot(segment, plot))).toBe(false);
    }
    // In front of the plots the ribbon narrows; past the last plot it is the full stone width.
    expect(widths.some(({ end, start }) => Math.max(start, end) < ROAD_STONE_WIDTH - 1e-6)).toBe(true);
    const open = widths.filter(({ segment }) => segment.start.x >= to - 1.5);
    expect(open.every(({ end, start }) => start === ROAD_STONE_WIDTH && end === ROAD_STONE_WIDTH)).toBe(true);
  });

  it("refuse new buildings and roads inside the strip around the old road", () => {
    const { from, row, session } = loadOldSave();
    const { simulation } = session;
    // A new Woodcutter whose front would sit half a cell from the old road.
    const x = from + 3, z = row + .5 + 2;
    expect(simulation.validatePlacement(WOODCUTTER, x, z, 2)).toMatch(/reserved stone width|entrance/);
    expect(simulation.validatePlacement(WOODCUTTER, x, z + .5 + .5, 2)).toBeNull();
  });
});
