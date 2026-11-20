import { type Camera,Group } from "three";

import type { BuildingFrame } from "../../../render-common/buildings/building-catalog";
import { BUILDING_LEVELS, type BuildingLevel,buildingLevelOf } from "../../../render-common/buildings/levels/building-level";
import { type BuildingPauseMarker, createBuildingPauseBadges } from "./building-pause-badges";

export interface BuildingLevelMarker extends BuildingPauseMarker { level: BuildingLevel }

/** Render frames already use panel levels; a missing level is the completed base building's level 1. */
export const hoveredBuildingLevel = (
  frame: Pick<BuildingFrame, "id" | "level" | "construction" | "owner">,
  hoveredId: string | null, demolishing = false
) => {
  if (frame.id !== hoveredId || frame.construction !== 1 || (frame.owner ?? 0) !== 0 || demolishing) return null;
  return frame.level ?? buildingLevelOf();
};

/** Only the hovered level has instances; cached digit geometry never rebuilds on pointer movement. */
export const createBuildingLevelBadges = (detailed: boolean) => {
  const root = new Group(); root.name = "building_level_badges";
  const digits = BUILDING_LEVELS.map(level => ({ level, badge: createBuildingPauseBadges(detailed, level) }));
  for (const { badge } of digits) root.add(badge.root);
  return { root,
    update: (markers: readonly BuildingLevelMarker[], time: number) => {
      for (const { badge, level } of digits) badge.update(markers.filter(marker => marker.level === level), time);
    },
    faceCamera: (camera: Camera) => { for (const { badge } of digits) badge.faceCamera(camera); },
    dispose: () => { for (const { badge } of digits) badge.dispose(); root.removeFromParent(); }
  };
};
