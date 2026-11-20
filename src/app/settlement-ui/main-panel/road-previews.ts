import type { BridgeRoadMode } from "../../../shared/settlement/bridge-construction";
import type { RoadTier, RoadVergeMode } from "../../../shared/settlement/road-types";

const previews = import.meta.glob("../../../../assets/road-previews/*.png", {
  eager: true, import: "default", query: "?url"
}) as Record<string, string>;

/** Rendered game road thumbnails share the building cards' image dimensions. */
export const getRoadPreviewSource = (mode: RoadTier | BridgeRoadMode | RoadVergeMode) => {
  if (mode === "bridge-wood") return previews["../../../../assets/road-previews/bridge-wood.png"];
  if (mode === "bridge-stone") return previews["../../../../assets/road-previews/bridge-stone.png"];
  return previews[`../../../../assets/road-previews/${mode}.png`];
};
