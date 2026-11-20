import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import type { TerrainRenderer } from "../../render-common/renderer-contract";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";

/** The building whose plot holds the clicked ground point, else the one whose roof centre is under the cursor. */
export const pickClickedBuilding = (
  buildings: readonly SettlementBuilding[],
  ground: { x: number; z: number },
  screen: { x: number; y: number },
  renderer: Pick<TerrainRenderer, "projectToViewport">,
  world: WorldData
) => {
  const building = buildings.find((entry) => {
    const [baseWidth, baseDepth] = getBuildingDefinition(entry.typeId).gridFootprint;
    const width = entry.rotation % 2 ? baseDepth : baseWidth;
    const depth = entry.rotation % 2 ? baseWidth : baseDepth;
    return Math.abs(entry.x - ground.x) <= width / 2 && Math.abs(entry.z - ground.z) <= depth / 2;
  });
  if (building) return building;
  // Roof clicks project onto ground behind the plot. Match the visible centre as well.
  const nearest = buildings.map((entry) => {
    const projected = renderer.projectToViewport(entry.x,
      sampleSmooth(world, world.heights, entry.x, entry.z) + 1, entry.z);
    return { entry, distance: Math.hypot(projected.x - screen.x, projected.y - screen.y) };
  }).sort((a, b) => a.distance - b.distance)[0];
  return nearest && nearest.distance < 30 ? nearest.entry : undefined;
};
