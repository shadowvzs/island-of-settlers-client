import type { RoadPoint } from "./road-types";
import type { SettlementRoads } from "./settlement-types";

/** Existence-only road query; avoids copying route points when the caller never walks them. */
export const hasRoadRoute = (roads: SettlementRoads, from: RoadPoint, to: RoadPoint) =>
  roads.routeMetrics ? roads.routeMetrics(from, to).route !== null : roads.route(from, to) !== null;
