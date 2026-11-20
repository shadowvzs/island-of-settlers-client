import { createBuildingRoadApproaches } from "../../shared/settlement/building-road-approaches";
import { fitStoneRoadWidths } from "../../shared/settlement/road-fitted-widths";
import type { RoadPreview, RoadSegment } from "../../shared/settlement/road-network";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";

interface RoadPreviewFrameOptions {
  buildings: () => readonly SettlementBuilding[];
  preview: () => RoadPreview | null;
  segments: () => readonly RoadSegment[];
  widthObstacles: Parameters<typeof fitStoneRoadWidths>[1];
}

const segmentKey = (segment: RoadSegment) => [segment.start, segment.end]
  .map(point => `${point.x}:${point.z}`).sort().join("/");

/**
 * The placement road preview with the existing network it joins fitted around it; rebuilt only when the
 * preview or the road frames (`roadRevision`) change.
 */
export const createRoadPreviewFrame = (options: RoadPreviewFrameOptions) => {
  let lastPreview: RoadPreview | null = null, renderedPreview: RoadPreview | null = null;
  let previewRoadRevision = -1;
  return (roadRevision: number) => {
    const preview = options.preview();
    if (preview === lastPreview && previewRoadRevision === roadRevision) return renderedPreview;
    lastPreview = preview; previewRoadRevision = roadRevision;
    if (!preview?.valid) { renderedPreview = preview; return renderedPreview; }
    const selected = new Set(preview.segments.map(segmentKey));
    const combined = [...options.segments().filter(segment => !selected.has(segmentKey(segment))),
      ...preview.segments.map(segment => ({ ...segment, preview: true }))];
    renderedPreview = { ...preview,
      contextSegments: fitStoneRoadWidths(createBuildingRoadApproaches(combined, options.buildings()),
        options.widthObstacles) };
    return renderedPreview;
  };
};
