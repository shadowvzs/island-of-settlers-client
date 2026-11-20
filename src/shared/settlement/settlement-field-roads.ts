import { distanceToSegmentXZ } from "./settlement-geometry";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/** Field clearance includes the occupied-cell fringe, so growing crops never break a road graph. */
export const createFieldRoadClearance = (context: SettlementContext) => {
  let revision = -1;
  let segments: Array<{ start: SettlementPoint; end: SettlementPoint }> = [];
  return (x: number, z: number) => {
    const roads = context.options.roads;
    if (revision !== (roads.revision ?? 0)) {
      revision = roads.revision ?? 0;
      segments = roads.segments?.() ?? [];
    }
    for (const { end, start } of segments)
      if (distanceToSegmentXZ(x, z, start.x, start.z, end.x, end.z) < 1.6) return false;
    return true;
  };
};
