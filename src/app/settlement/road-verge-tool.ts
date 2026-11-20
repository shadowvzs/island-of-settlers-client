import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { roadEdgeKey, type RoadSegment } from "../../shared/settlement/road-types";
import type {
  RoadVergePreview, RoadVergeRefusal, RoadVergeSnapshot
} from "../../shared/settlement/road-verge-planting";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "./debug-messages";

/** The stretch highlight: the real existing edges the order would plant, marked as a preview. */
export const vergePreviewSegments = (
  preview: RoadVergePreview, roads: readonly RoadSegment[]
): RoadSegment[] => {
  const keys = new Set(preview.segments.map(edge => roadEdgeKey(edge.start, edge.end)));
  return roads.filter(segment => keys.has(roadEdgeKey(segment.start, segment.end)))
    .map(segment => ({ ...segment, preview: true }));
};

/** The Road tab explains each refusal the same way for every verge kind. */
export const roadVergeRefusalText = (reason: RoadVergeRefusal | undefined, i18n?: I18n) => {
  if (reason === "invalid-kind") return translateMessage(i18n, M.debug.placement.vergeInvalidKind);
  if (reason === "no-road") return translateMessage(i18n, M.debug.placement.vergeNoRoad);
  if (reason === "nothing-to-plant") return translateMessage(i18n, M.debug.placement.vergeNothingToPlant);
  if (reason === "busy") return translateMessage(i18n, M.debug.placement.vergeBusy);
  return translateMessage(i18n, M.debug.placement.vergeNoStorage);
};

/** “N tiles · N planks”: the exact cost the order pays before the second click confirms it. */
export const roadVergeCostText = (preview: RoadVergePreview, i18n?: I18n) =>
  translateMessage(i18n, M.debug.placement.vergeCost, {
    planks: preview.planks, tiles: preview.segments.length
  });

/** The placement badge: the next click's meaning or the cost of the highlighted stretch. */
export const roadVergeBadgeText = (
  preview: RoadVergePreview | null, startChosen: boolean, i18n?: I18n
) => {
  if (!startChosen) return translateMessage(i18n, M.debug.placement.vergeStart);
  if (!preview) return translateMessage(i18n, M.debug.placement.vergeEnd);
  if (!preview.ok) return roadVergeRefusalText(preview.reason, i18n);
  return roadVergeCostText(preview, i18n);
};

/** Confirmation after the second click started the order. */
export const roadVergeOrderedText = (preview: RoadVergePreview, i18n?: I18n) =>
  translateMessage(i18n, M.debug.placement.vergeOrdered, {
    planks: preview.planks, tiles: preview.segments.length
  });

/** Remove-mode badge over a running order. */
export const roadVergeCancelText = (site: RoadVergeSnapshot, i18n?: I18n) =>
  translateMessage(i18n, M.debug.placement.vergeCancel, { percent: Math.round(site.progress * 100) });
