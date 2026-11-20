import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { roadBaseWidth, type RoadSegment } from "../../../shared/settlement/road-types";
import { distanceToSegment } from "../../../shared/settlement/settlement-geometry";
import type { SurveyJob } from "../../../shared/settlement/settlement-surveying";
import type { SettlementPoint } from "../../../shared/settlement/settlement-types";
import { displayFogAt } from "../../../shared/world/fog-display";
import { sampleSmooth } from "../../../shared/world/grid-geometry";
import { FOG, type WorldData } from "../../../shared/world/world-data";
import { findMineZoneAt } from "../../build-overlay/mine-tooltip";
import { SETTLEMENT_MESSAGES as M } from "../messages";

export interface TerrainSurveyTarget {
  description: string;
  job: SurveyJob;
  point: SettlementPoint;
  title: string;
}

/** Call only after building, military, ship and active-tool picking have had priority. */
export const getTerrainSurveyTarget = (
  world: WorldData, point: SettlementPoint, roads: readonly RoadSegment[], i18n?: I18n
): TerrainSurveyTarget | null => {
  const x = Math.floor(point.x), z = Math.floor(point.z);
  if (!Number.isFinite(x) || !Number.isFinite(z) || x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return null;
  if (roads.some(road => distanceToSegment(point, road.start, road.end) <= roadBaseWidth(road) / 2)) return null;
  const cell = z * world.cellsX + x;
  if (world.blocking[cell] || !world.walkCost[cell] ||
    sampleSmooth(world, world.heights, point.x, point.z) < world.seaLevel) return null;
  if (displayFogAt(world, cell) === FOG.hidden) return {
    description: translateMessage(i18n, M.terrain.scoutDescription),
    job: "Scout", point: { ...point }, title: translateMessage(i18n, M.terrain.scoutTitle)
  };
  const zone = findMineZoneAt(world, point.x, point.z);
  if (!zone || zone.surveyed) return null;
  return {
    description: translateMessage(i18n, M.terrain.geologistDescription),
    job: "Geologist", point: { ...point }, title: translateMessage(i18n, M.terrain.geologistTitle)
  };
};
