import type { I18n } from "@lingui/core";

import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { translateMessage } from "../../shared/i18n/translate";
import type { WorldData } from "../../shared/world/world-data";
import { drawHarbourSpotMarkers, hasHarbourSpotMarkers } from "../harbour-spot-markers";
import { MAP_EDITOR_MESSAGES as M } from "./messages";
import { createOverlayCanvas, fitOverlayCanvas } from "./overlay-canvas";

/**
 * HARBOUR-SPOTS in the map editor (owner 2026-11-09): the stored harbour spots, always shown and
 * prominent (filled plot, berth arrow, label) so the author sees exactly where a harbour can be built.
 * Maps without stored spots keep the canvas hidden and draw nothing.
 */
export const createHarbourSpotOverlay = (world: WorldData, viewport: HTMLElement, renderer: TerrainRenderer,
  i18n?: I18n) => {
  const canvas = createOverlayCanvas(viewport);
  const project = renderer.projectToViewport.bind(renderer);
  return {
    draw: (visible: boolean) => {
      canvas.hidden = !visible || !hasHarbourSpotMarkers(world);
      if (canvas.hidden) return;
      const context = fitOverlayCanvas(canvas, viewport);
      if (context) drawHarbourSpotMarkers(context, world, project, "prominent",
        translateMessage(i18n, M.harbourSpots.label));
    },
    dispose: () => canvas.remove()
  };
};
