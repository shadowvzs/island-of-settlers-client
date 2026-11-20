import type { PlacementGhostFrame } from "../../render-common/renderer-contract";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { snapBuildingPlot } from "./building-plot";
import { createBuildingRoadConnection } from "./building-road-connection";
import type { RoadPlotReservation } from "./road-plot-reservation";

type Point = { x: number; z: number };
type PlacementSimulation = Pick<SettlementSimulation,
  "buildings" | "navigationRevision" | "planRoad" | "playerNation" | "roadRevision" | "roadSegments" | "territory" |
  "validatePlacement"> & Partial<Pick<SettlementSimulation, "harbourBerthPreview" | "placementStockReason">>;

/** A cached verdict is re-checked at least this often (crop and charcoal sites change silently). */
const REVALIDATE_MS = 500;

export interface PlacementCheck {
  ghost: PlacementGhostFrame;
  plot: ReturnType<typeof snapBuildingPlot>;
  /** Why the plot is refused (null: it can be built). */
  reason: string | null;
  /** A harbour that can be built here: the berths it would get (1 or 2). */
  berths?: number;
}

/** Changes whenever territory, roads, the building list or crop/plantation plots change placement validity. */
export const placementRevisionKey = (simulation: PlacementSimulation) =>
  `${simulation.territory().revision}/${simulation.roadRevision()}/${simulation.buildings().length}/` +
  `${simulation.navigationRevision()}`;

/**
 * Snaps the pointer to the selected building's plot and validates it with the shared placement
 * rules, then with the construction stock its landmass can pay (the same refusal `placeBuilding` gives);
 * a valid plot also gets its planned road connection (routed around the plot through
 * `reservation`). The verdict and ghost frame are reused while the plot, rotation and world
 * revisions stay the same, so a still pointer costs no validation per frame.
 */
export const createPlacementCheck = (
  simulation: PlacementSimulation, world: WorldData, now = () => performance.now(),
  reservation?: RoadPlotReservation
) => {
  const connect = createBuildingRoadConnection(simulation, world, reservation);
  const key: number[] = [];
  let result: PlacementCheck | null = null;
  const sameKey = (values: readonly number[]) => values.every((value, index) => key[index] === value);
  return (typeId: number, point: Point, rotation: number): PlacementCheck => {
    const plot = snapBuildingPlot(typeId, point, rotation);
    const territory = simulation.territory().revision, roads = simulation.roadRevision();
    const values = [typeId, plot.x, plot.z, plot.rotation, territory, roads, simulation.buildings().length,
      world.buildRevision ?? 0, simulation.navigationRevision(), Math.floor(now() / REVALIDATE_MS)];
    const nation = simulation.playerNation();
    if (result?.ghost.nation === nation && sameKey(values)) return result;
    key.splice(0, key.length, ...values);
    const reason = simulation.validatePlacement(typeId, plot.x, plot.z, plot.rotation) ??
      simulation.placementStockReason?.(typeId, plot.x, plot.z, plot.rotation) ?? null;
    const road = reason === null ? connect(typeId, plot) : null;
    const ghost = { nation, road, rotation: plot.rotation * Math.PI / 2, type: typeId,
      valid: reason === null, x: plot.x, y: sampleSmooth(world, world.heights, plot.x, plot.z), z: plot.z };
    const berths = reason === null
      ? simulation.harbourBerthPreview?.(typeId, plot.x, plot.z, plot.rotation) ?? undefined : undefined;
    result = { berths, ghost, plot, reason };
    return result;
  };
};
