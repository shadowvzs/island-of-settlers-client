import { getPlacedBuildingLogistics } from "../../render-common/buildings/building-grid-metrics";
import { nearestRoadEndpoints } from "../../shared/settlement/road-endpoints";
import type { RoadPoint } from "../../shared/settlement/road-types";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { WorldData } from "../../shared/world/world-data";
import type { RoadPlotReservation } from "./road-plot-reservation";

type ConnectionSimulation = Pick<SettlementSimulation,
  "buildings" | "planRoad" | "roadRevision" | "roadSegments" | "territory">;

export interface ConnectionPlot {
  depth: number;
  /** Quarter turns. */
  rotation: number;
  width: number;
  x: number;
  z: number;
}

/** Nearest road endpoints tried, closest first (one road search each at most). */
const CANDIDATES = 3;
/** A planned road may touch the plot's edge, never cross its inside (guard without a reservation). */
const PLOT_MARGIN = 0.01;

const crossesPlot = (points: readonly RoadPoint[], plot: ConnectionPlot) => {
  const left = plot.x - plot.width / 2 + PLOT_MARGIN, right = plot.x + plot.width / 2 - PLOT_MARGIN;
  const top = plot.z - plot.depth / 2 + PLOT_MARGIN, bottom = plot.z + plot.depth / 2 - PLOT_MARGIN;
  return points.some((point) => point.x > left && point.x < right && point.z > top && point.z < bottom);
};

/**
 * The road a plot's flag would get to the nearest reachable road endpoint (null: none found).
 * With a reservation the planner routes around the plot as if the building stood there.
 */
export const planBuildingRoadConnection = (
  simulation: ConnectionSimulation, typeId: number, plot: ConnectionPlot, reservation?: RoadPlotReservation
): RoadPoint[] | null => {
  const { road } = getPlacedBuildingLogistics(typeId, plot.x, plot.z, plot.rotation);
  const planTo = (target: RoadPoint) => simulation.planRoad(road, target, "dirt");
  const flags = () => simulation.buildings().map(building => building.access);
  for (const target of nearestRoadEndpoints(simulation.roadSegments(), flags, road, CANDIDATES)) {
    if (target.x === road.x && target.z === road.z) return [];
    const plan = reservation ? reservation.during(plot, () => planTo(target)) : planTo(target);
    if (plan && !crossesPlot(plan.points, plot)) return plan.points;
  }
  return null;
};

/**
 * The planned road connection of the hovered valid plot: the dirt road route (the same planner
 * as the road tool) from the plot's flag to the nearest road endpoint, around the plot. Planned
 * once per plot and road/building/territory/terrain revision; repeated calls return the same array.
 */
export const createBuildingRoadConnection = (
  simulation: ConnectionSimulation, world: WorldData, reservation?: RoadPlotReservation
) => {
  const key: number[] = [];
  let points: RoadPoint[] | null = null;
  return (typeId: number, plot: ConnectionPlot) => {
    const values = [typeId, plot.x, plot.z, plot.rotation, simulation.roadRevision(),
      simulation.buildings().length, simulation.territory().revision, world.buildRevision ?? 0];
    if (key.length && values.every((value, index) => key[index] === value)) return points;
    key.splice(0, key.length, ...values);
    points = planBuildingRoadConnection(simulation, typeId, plot, reservation);
    return points;
  };
};
