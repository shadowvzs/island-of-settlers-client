import type { MessageDescriptor } from "@lingui/core";

import type { TerrainRenderer } from "../../render-common/renderer-contract";
import {
  inspectLocalNavigation, type NavigationInspectionCell, type NavigationInspectionLayer
} from "../../shared/settlement/settlement-navigation-inspection";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { getWorldRevision, pickViewCentre, runDeferredInspection } from "./helpers";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createOverlayCanvas, drawClearanceDot, fitOverlayCanvas } from "./overlay-canvas";
import { createSectionStore } from "./section-store";

/** The inspection layers and their names (select options). */
export const NAVIGATION_LAYERS: Record<NavigationInspectionLayer, MessageDescriptor> = {
  walking: M.navLayer.walking, road: M.navLayer.road, sea: M.navLayer.oceanDraft,
  parallelX: M.navLayer.parallelX, parallelZ: M.navLayer.parallelZ, turning: M.navLayer.turning,
  oceanTurning: M.navLayer.oceanTurning
};

/** On-demand local diagnostic; no world writes and no per-frame navigation searches. */
export const createNavigationOverlay = (world: WorldData, viewport: HTMLElement, renderer: TerrainRenderer) => {
  const section = createSectionStore({ busy: false, layer: "walking", status: "" as EditorText });
  const canvas = createOverlayCanvas(viewport);
  let cells: NavigationInspectionCell[] | undefined;
  let revision = "", scenario = world.scenario, heights = world.heights;
  const stamp = () => getWorldRevision(world);
  const hide = () => { cells = undefined; canvas.hidden = true; };
  const inspect = () => {
    const centre = pickViewCentre(renderer, viewport);
    hide();
    if (!centre) { section.update({ status: M.hints.aimAtTerrain }); return; }
    section.update({ busy: true, status: M.inspection.inspectingLocal });
    runDeferredInspection(section, () => {
      const inspected = inspectLocalNavigation(world, centre, section.get().layer as NavigationInspectionLayer);
      cells = inspected;
      revision = stamp(); scenario = world.scenario; heights = world.heights;
      return editorMessage(M.inspection.navigationStatus, {
        clear: inspected.filter(cell => cell.clear).length,
        samples: inspected.length
      });
    }, M.inspection.failed, hide);
  };
  const setLayer = (layer: string) => {
    section.update({ layer });
    hide(); section.update({ status: M.inspection.inspectAgainLayer });
  };
  const draw = (visible: boolean) => {
    canvas.hidden = !visible || !cells;
    if (!visible || !cells) return;
    if (revision !== stamp() || scenario !== world.scenario || heights !== world.heights) {
      hide(); section.update({ status: M.inspection.mapChangedInspect }); return;
    }
    const ctx = fitOverlayCanvas(canvas, viewport); if (!ctx) return;
    for (const cell of cells) {
      const p = renderer.projectToViewport(cell.x, sampleSmooth(world, world.heights, cell.x, cell.z) + .12, cell.z);
      drawClearanceDot(ctx, canvas, p, cell.clear);
    }
  };
  return { draw, hide, inspect, section, setLayer };
};

export type NavigationOverlay = ReturnType<typeof createNavigationOverlay>;
