import type { WorldData } from "../world/world-data";
import { roadIntersectsVisibleRock } from "./road-rock-footprints";
import { createRoadTraversal } from "./road-traversal";
import { ROAD_STONE_WIDTH } from "./road-types";
import { inspectHarbourNavigation } from "./settlement-harbour-placement";
import { createScenarioInspectionContext } from "./settlement-map-scenario";
import { isNavigationClear } from "./settlement-navigation";

export type NavigationInspectionLayer = "walking" | "road" | "sea" | "parallelX" | "parallelZ" | "turning" | "oceanTurning";
export interface NavigationInspectionCell { x: number; z: number; clear: boolean }
/** Explicit snapshot: only 25×25 local cells are inspected. Sea topology is computed once on demand. */
export const inspectLocalNavigation = (world: WorldData, centre: { x: number; z: number }, layer: NavigationInspectionLayer) => {
  const context = createScenarioInspectionContext(world);
  const marine = layer !== "walking" && layer !== "road" ? inspectHarbourNavigation(context) : undefined;
  const road = createRoadTraversal(world, {}, ROAD_STONE_WIDTH);
  const cells: NavigationInspectionCell[] = [];
  const cx = Math.floor(centre.x), cz = Math.floor(centre.z);
  for (let z = Math.max(0, cz - 12); z <= Math.min(world.cellsZ - 1, cz + 12); z++)
    for (let x = Math.max(0, cx - 12); x <= Math.min(world.cellsX - 1, cx + 12); x++) {
      const point = { x: x + .5, z: z + .5 };
      let clear: boolean;
      if (layer === "walking") clear = isNavigationClear(context, point);
      else if (layer === "road") {
        clear = [{ x: point.x + .5, z: point.z }, { x: point.x, z: point.z + .5 }].every(end =>
          road.walkable(point, end) && !roadIntersectsVisibleRock(world, point, end, ROAD_STONE_WIDTH));
      } else clear = marine![layer](z * world.cellsX + x);
      cells.push({ ...point, clear });
    }
  return cells;
};
