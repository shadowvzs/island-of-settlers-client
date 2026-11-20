import type { TerrainRenderer } from "../../render-common/renderer-contract";
import {
  extractTerrainComponent, type TerrainComponent, type TerrainComponentKind
} from "../../shared/world/editing/terrain/terrain-component";
import type { WorldData } from "../../shared/world/world-data";
import { getWorldRevision, pickViewCentre, runDeferredInspection } from "./helpers";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createOverlayCanvas, drawBoundaryCells, fitOverlayCanvas } from "./overlay-canvas";
import { createSectionStore } from "./section-store";

const describeSelection = (selection: TerrainComponent | null): EditorText => {
  if (!selection) return M.inspection.noContour;
  if (selection.truncated) return M.inspection.contourBudget;
  return editorMessage(M.inspection.contourStatus, {
    boundary: selection.boundary.length,
    cells: selection.cells.length
  });
};

/** Contour selection is advisory: generated/baked shapes have no independent authored profile. */
export const createGeneratedFeatureInspector = (world: WorldData, viewport: HTMLElement, renderer: TerrainRenderer) => {
  const section = createSectionStore({
    busy: false,
    kind: "water",
    status: "" as EditorText,
    threshold: "3.5"
  });
  const canvas = createOverlayCanvas(viewport);
  let selection: TerrainComponent | null = null, revision = "";
  const stamp = () => getWorldRevision(world);
  const hide = () => { selection = null; canvas.hidden = true; };
  const inspect = () => {
    hide(); if (!section.reportValidity("threshold")) return;
    const point = pickViewCentre(renderer, viewport);
    if (!point) { section.update({ status: M.hints.aimAtTerrain }); return; }
    section.update({ busy: true });
    runDeferredInspection(section, () => {
      selection = extractTerrainComponent(world, point, section.get().kind as TerrainComponentKind,
        world.seaLevel + section.valueAsNumber("threshold"));
      revision = stamp();
      return describeSelection(selection);
    }, M.hints.contourInspectionFailed, hide);
  };
  const setKind = (kind: string) => { section.update({ kind }); hide(); };
  const draw = (visible: boolean) => {
    canvas.hidden = !visible || !selection || selection.truncated;
    if (!visible || !selection || selection.truncated) return;
    if (stamp() !== revision) {
      hide(); section.update({ status: M.hints.mapChangedSelectContour }); return;
    }
    const ctx = fitOverlayCanvas(canvas, viewport); if (!ctx) return;
    drawBoundaryCells(ctx, canvas, renderer, world, selection.boundary, .15, "#ffda65d0");
  };
  return { draw, hide, inspect, section, setKind,
    selection: () => selection && !selection.truncated && stamp() === revision ? selection : null };
};

export type GeneratedFeatureInspector = ReturnType<typeof createGeneratedFeatureInspector>;
