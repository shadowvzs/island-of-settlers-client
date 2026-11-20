import { isRoadVergeKind, type RoadSegment, type RoadVergeKind } from "./road-types";
import { refreshSettlementRoadTerrain } from "./settlement-road-terrain";
import { ownsTerritoryRoute, settlementTerritory } from "./settlement-territory";
import type { SettlementContext } from "./settlement-types";

export interface DebugRoadUpgradeReport { upgraded: number }
export interface DebugRoadVergeReport { planted: number }

/** Free Development action on this island only. The real player's ownership mask is read once. */
export const debugUpgradeOwnedRoads = (context: SettlementContext): DebugRoadUpgradeReport => {
  const { roads } = context.options;
  if (!roads.raiseTiersWhere) return { upgraded: 0 };
  const owned = settlementTerritory(context).owned;
  const upgraded = roads.raiseTiersWhere(segment =>
    ownsTerritoryRoute(context, [segment.start, segment.end], owned));
  if (upgraded && context.roadDecorations?.hasState()) refreshSettlementRoadTerrain(context);
  return { upgraded };
};

/** An owned public edge a debug verge may mark: no bridge deck, doorway lane or placed-preview edge. */
const publicRoadEdge = (segment: RoadSegment) =>
  !segment.bridge && !segment.doorway && !segment.preview;

/** Free Development action: the requested plants on every owned public road of this island only. */
export const debugPlantRoadVerges = (
  context: SettlementContext, kind: RoadVergeKind = "flowers"
): DebugRoadVergeReport => {
  const { roads } = context.options;
  if (!isRoadVergeKind(kind) || !roads.replaceSegments) return { planted: 0 };
  const segments = roads.segments?.() ?? [];
  const owned = settlementTerritory(context).owned;
  let planted = 0;
  for (const segment of segments) {
    if (!publicRoadEdge(segment) || segment.verge === kind) continue;
    if (!ownsTerritoryRoute(context, [segment.start, segment.end], owned)) continue;
    segment.verge = kind;
    planted++;
  }
  if (!planted) return { planted };
  return { planted: roads.replaceSegments(segments) ? planted : 0 };
};
