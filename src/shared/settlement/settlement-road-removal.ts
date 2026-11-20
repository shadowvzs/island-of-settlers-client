import type { RoadPoint } from "./road-types";
import { invalidateRoadTravel } from "./settlement-road-rerouting";
import { refreshSettlementRoadTerrain } from "./settlement-road-terrain";
import type { SettlementContext } from "./settlement-types";

/**
 * After removed road edges: every road journey re-validates before its next step, and road
 * decorations and the graded road terrain follow the removed sections.
 */
export const afterRoadsRemoved = (
  context: SettlementContext, sections: readonly { end: RoadPoint; start: RoadPoint }[]
) => {
  invalidateRoadTravel(context);
  if (!context.roadDecorations?.hasState()) return;
  context.roadDecorations.changedRoads(sections.map(({ end, start }) => ({ end, start })));
  refreshSettlementRoadTerrain(context);
};
