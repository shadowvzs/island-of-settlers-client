import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { storedHarbourSpots } from "../../shared/settlement/harbour-spot-index";
import { isOwnBuilding } from "../../shared/settlement/settlement-home";
import { landmassAt } from "../../shared/settlement/settlement-landmass-index";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import type { HarbourSpot, WorldData } from "../../shared/world/world-data";
import { drawHarbourSpotMarkers } from "../harbour-spot-markers";
import { createOverlayCanvas, fitCanvasToViewport } from "../helpers";

interface FogOffHarbourMarkerOptions {
  renderer: Pick<TerrainRenderer, "projectToViewport">;
  viewport: HTMLElement;
  world: WorldData;
}

/** Landmasses holding one of the player's buildings: their harbour spots are already settled. */
const settledLandmasses = (world: WorldData, buildings: readonly SettlementBuilding[]) => {
  const settled = new Set<number>();
  for (const building of buildings) if (isOwnBuilding(building)) settled.add(landmassAt(world, building));
  return settled;
};

/** The stored harbour spots on landmasses the player has not settled yet. */
export const unsettledHarbourSpots = (world: WorldData, buildings: readonly SettlementBuilding[]) => {
  const settled = settledLandmasses(world, buildings);
  return storedHarbourSpots(world).filter(spot => !settled.has(landmassAt(world, spot)));
};

/**
 * Fog of war off (plan §8.6, GS4a): the map's stored harbour spots of not-yet-settled landmasses stay outlined
 * in the subtle placement style on a 2D overlay (no new art, the same cost on High and Minimal). The overlay
 * redraws only when the projection, the viewport or the settled set changes; hidden and free while fog is on.
 */
export const createFogOffHarbourMarkers = ({ renderer, viewport, world }: FogOffHarbourMarkerOptions) => {
  let canvas: HTMLCanvasElement | undefined, context: CanvasRenderingContext2D | null = null;
  let spots: readonly HarbourSpot[] = [], buildingCount = -1, drawnKey = "";
  const project = renderer.projectToViewport.bind(renderer);
  const viewKey = () => {
    const first = spots[0], last = spots.at(-1);
    if (!first || !last) return "";
    const a = project(first.x, 0, first.z), b = project(last.x, 0, last.z);
    return [a.x, a.y, b.x, b.y, viewport.clientWidth, viewport.clientHeight, spots.length]
      .map(value => value.toFixed(1)).join();
  };
  const draw = () => {
    canvas ??= createOverlayCanvas(viewport, "build-overlay build-overlay--harbour-spots");
    context ??= canvas.getContext("2d");
    if (!context) return;
    const ratio = fitCanvasToViewport(canvas, viewport);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawHarbourSpotMarkers(context, world, project, "subtle", undefined, spots);
  };
  return {
    dispose: () => { canvas?.remove(); canvas = undefined; context = null; },
    /** Each frame: `enabled` = fog of war is off in the island's rules. */
    update: (enabled: boolean, buildings: readonly SettlementBuilding[]) => {
      if (canvas) canvas.hidden = !enabled;
      if (!enabled) { drawnKey = ""; return; }
      if (buildings.length !== buildingCount) {
        buildingCount = buildings.length;
        spots = unsettledHarbourSpots(world, buildings);
        drawnKey = "";
      }
      const key = viewKey();
      if (key === drawnKey) return;
      drawnKey = key;
      draw();
    }
  };
};
