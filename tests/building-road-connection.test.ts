import { describe, expect, it, vi } from "vitest";

import { snapBuildingPlot } from "../src/app/settlement/building-plot";
import {
  createBuildingRoadConnection,
  planBuildingRoadConnection
} from "../src/app/settlement/building-road-connection";
import { createPlacementCheck } from "../src/app/settlement/placement-check";
import { getPlacedBuildingLogistics } from "../src/render-common/buildings/building-grid-metrics";
import { createPlacementSession } from "./helpers/placement-session";

const WOODCUTTER = 17;

/** A valid Woodcutter plot about `distance` cells west of the headquarters. */
const plotNear = (simulation: ReturnType<typeof createPlacementSession>["simulation"], distance: number) => {
  const { headquarters } = simulation;
  for (let offset = distance; offset < distance + 12; offset++) {
    const plot = snapBuildingPlot(WOODCUTTER, { x: headquarters.x - offset, z: headquarters.z + 1 }, 0);
    if (simulation.validatePlacement(WOODCUTTER, plot.x, plot.z, plot.rotation) === null) return plot;
  }
  throw new Error("No valid Woodcutter plot near the headquarters");
};

const inside = (point: { x: number; z: number }, plot: ReturnType<typeof snapBuildingPlot>) =>
  Math.abs(point.x - plot.x) < plot.width / 2 - 0.01 && Math.abs(point.z - plot.z) < plot.depth / 2 - 0.01;

describe("hovered plot road connection", () => {
  it("plans the road tool's route from the plot's flag to the headquarters flag before any road exists", () => {
    const { simulation } = createPlacementSession();
    expect(simulation.roadSegments()).toHaveLength(0);
    const plot = plotNear(simulation, 9);
    const points = planBuildingRoadConnection(simulation, WOODCUTTER, plot)!;
    const flag = getPlacedBuildingLogistics(WOODCUTTER, plot.x, plot.z, plot.rotation).road;
    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual(flag);
    expect(points.at(-1)).toEqual(simulation.headquarters.access);
    expect(points.some((point) => inside(point, plot))).toBe(false);
  });

  it("joins the nearest public road node once roads exist", () => {
    const { simulation } = createPlacementSession();
    const { access } = simulation.headquarters;
    const end = { x: access.x - 4, z: access.z };
    expect(simulation.connectRoads(access, end)).toBe(true);
    const plot = plotNear(simulation, 9);
    const points = planBuildingRoadConnection(simulation, WOODCUTTER, plot)!;
    const nodes = simulation.roadSegments().flatMap((section) => [section.start, section.end]);
    expect(nodes).toContainEqual(points.at(-1));
    expect(points.some((point) => inside(point, plot))).toBe(false);
  });

  it("routes around the plot, as if built, when the nearest road lies behind it", () => {
    const { reservation, simulation } = createPlacementSession();
    const { headquarters } = simulation;
    const plot = snapBuildingPlot(WOODCUTTER, { x: headquarters.x, z: headquarters.z + 10 }, 0);
    expect(simulation.validatePlacement(WOODCUTTER, plot.x, plot.z, plot.rotation)).toBeNull();
    expect(planBuildingRoadConnection(simulation, WOODCUTTER, plot)).toBeNull();
    const points = planBuildingRoadConnection(simulation, WOODCUTTER, plot, reservation)!;
    expect(points.length).toBeGreaterThan(2);
    expect(points.at(-1)).toEqual(headquarters.access);
    expect(points.some((point) => inside(point, plot))).toBe(false);
    expect(reservation.blocks(plot.x, plot.z)).toBe(false);
  });

  it("returns an empty route when the flag already lies on a road", () => {
    const { simulation } = createPlacementSession();
    const plot = plotNear(simulation, 9);
    const flag = getPlacedBuildingLogistics(WOODCUTTER, plot.x, plot.z, plot.rotation).road;
    expect(simulation.connectRoads(simulation.headquarters.access, flag)).toBe(true);
    expect(planBuildingRoadConnection(simulation, WOODCUTTER, plot)).toEqual([]);
  });

  it("plans once per plot and revision, then returns the same array", () => {
    const { simulation, world } = createPlacementSession();
    const plan = vi.spyOn(simulation, "planRoad");
    const connect = createBuildingRoadConnection(simulation, world);
    const plot = plotNear(simulation, 9);
    const first = connect(WOODCUTTER, plot);
    expect(connect(WOODCUTTER, { ...plot })).toBe(first);
    const calls = plan.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    world.buildRevision = (world.buildRevision ?? 0) + 1;
    expect(connect(WOODCUTTER, plot)).not.toBe(first);
    expect(plan.mock.calls.length).toBeGreaterThan(calls);
  });

  it("gives the cursor ghost its road on valid plots only", () => {
    const { simulation, world } = createPlacementSession();
    const check = createPlacementCheck(simulation, world, () => 0);
    const plot = plotNear(simulation, 9);
    const valid = check(WOODCUTTER, plot, 0);
    expect(valid.ghost.valid).toBe(true);
    expect(valid.ghost.road?.length).toBeGreaterThan(2);
    const { headquarters } = simulation;
    const refused = check(WOODCUTTER, headquarters, 0);
    expect(refused.ghost.valid).toBe(false);
    expect(refused.ghost.road).toBeNull();
  });
});
