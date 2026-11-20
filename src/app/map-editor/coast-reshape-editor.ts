import type { TerrainRenderer } from "../../render-common/renderer-contract";
import {
  type CoastReshapePreview,
  commitCoastReshape, previewCoastReshape} from "../../shared/world/editing/terrain/coast-reshape";
import type { TerrainBrushMode } from "../../shared/world/editing/terrain/terrain-brush";
import type { WorldData } from "../../shared/world/world-data";
import type { EditorHistory } from "./editor-history";
import type { EditorStore } from "./editor-store";
import { getWorldRevision, pickViewCentre } from "./helpers";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createOverlayCanvas, drawClearanceDot, fitOverlayCanvas } from "./overlay-canvas";
import { createSectionStore, type FieldOption } from "./section-store";
import type { TerrainTool } from "./terrain-tool";

export const COAST_OPERATIONS: readonly FieldOption[] = [
  { label: M.option.coastOperation.beach, value: "beach" },
  { label: M.option.coastOperation.sea, value: "sea" },
  { label: M.option.coastOperation.flatten, value: "flatten" }
];

export const COAST_FEEDBACK_LAYERS: readonly FieldOption[] = [
  { label: M.option.coastFeedback.walking, value: "walking" },
  { label: M.option.coastFeedback.sea, value: "sea" },
  { label: M.option.coastFeedback.oceanTurning, value: "oceanTurning" }
];

export const COAST_PREVIEW_DISCARDED: EditorText = M.coast.previewDiscarded;
export const NO_COAST_PREVIEW: EditorText = M.coast.noPreview;

const describe = (preview: CoastReshapePreview, applied: boolean): EditorText => {
  const clear = (layer: keyof CoastReshapePreview["after"]) => ({
    after: preview.after[layer].filter(cell => cell.clear).length,
    before: preview.before[layer].filter(cell => cell.clear).length,
    samples: preview.after[layer].length
  });
  const walking = clear("walking"), sea = clear("sea"), turning = clear("oceanTurning");
  return editorMessage(applied ? M.coast.appliedStatus : M.coast.previewStatus, {
    removed: preview.removed.length,
    seaAfter: sea.after,
    seaBefore: sea.before,
    seaSamples: sea.samples,
    turningAfter: turning.after,
    turningBefore: turning.before,
    turningSamples: turning.samples,
    vertices: preview.changed,
    walkingAfter: walking.after,
    walkingBefore: walking.before,
    walkingSamples: walking.samples
  });
};

export const createCoastReshapeEditor = (world: WorldData, viewport: HTMLElement, renderer: TerrainRenderer,
  terrain: TerrainTool, history: EditorHistory, store: EditorStore, onEdit: () => boolean | void,
  applied: (preview: CoastReshapePreview, moved: readonly number[]) => void) => {
  const section = createSectionStore({
    commitDisabled: true,
    feedback: "walking",
    mode: "beach",
    previewing: false,
    radius: "5",
    status: "" as EditorText,
    strength: ".7"
  });
  const setStatus = (status: EditorText) => section.update({ status });
  const canvas = createOverlayCanvas(viewport);
  let proposal: CoastReshapePreview | undefined, visibleFeedback: CoastReshapePreview["after"] | undefined;
  let token = 0, pending = false, revision = "", scenario = world.scenario;
  const stamp = () => getWorldRevision(world, { props: true });
  const cancel = () => {
    token++; proposal = undefined; visibleFeedback = undefined; canvas.hidden = true;
    section.update({ commitDisabled: true });
  };
  const preview = () => {
    if (pending || terrain.stats.busy) { store.setHint(M.hints.seedWait, true); return; }
    if (!section.reportValidity("radius", "strength")) return;
    const point = pickViewCentre(renderer, viewport);
    if (!point) { store.setHint(M.hints.aimAtShore, true); return; }
    cancel(); const request = ++token, before = stamp(), beforeScenario = world.scenario;
    pending = true; section.update({ previewing: true }); setStatus(M.hints.coastPreparing);
    setTimeout(() => {
      try {
        if (request !== token || before !== stamp() || beforeScenario !== world.scenario)
          throw new Error("Preview cancelled or map changed.");
        const result = previewCoastReshape(world, terrain.state, { ...point, radius: section.valueAsNumber("radius"),
          strength: section.valueAsNumber("strength"), mode: section.get().mode as TerrainBrushMode,
          targetHeight: world.seaLevel + 2 });
        proposal = result; visibleFeedback = result.after; revision = stamp(); scenario = world.scenario;
        section.update({ commitDisabled: !result.diff || !result.changed });
        setStatus(describe(result, false));
        store.setHint(M.hints.coastPreviewReady);
      } catch {
        // A preview the player cancelled already confirmed its discard on the hint line.
        if (request !== token) return;
        cancel(); setStatus(M.hints.coastPreviewFailed);
        store.setHint(section.get().status, true);
      }
      finally { pending = false; section.update({ previewing: false }); }
    }, 0);
  };
  const commit = () => {
    const chosen = proposal;
    if (!chosen || pending || terrain.stats.busy || stamp() !== revision || scenario !== world.scenario) {
      cancel(); store.setHint(M.hints.coastApplyFirst, true); return;
    }
    if (onEdit() === false) return;
    history.begin({ cells: chosen.historyCells, waterChanged: true });
    try {
      const changed = commitCoastReshape(world, terrain.state, chosen);
      history.note({ cells: chosen.cells, ground: true });
      applied(chosen, changed.restored);
      terrain.rebuildArea(chosen.cells, true, []);
      proposal = undefined; section.update({ commitDisabled: true }); revision = stamp(); scenario = world.scenario;
      setStatus(describe(chosen, true));
      store.setHint(M.hints.coastApplied);
    } catch {
      history.note({ cells: chosen.cells }); cancel();
      store.setHint(M.hints.coastEditFailed, true);
    } finally { history.endStroke(); }
  };
  /** Operation, radius and strength changes discard the preview. */
  const setOption = (change: { mode?: string; radius?: string; strength?: string }) => {
    section.update(change); cancel();
  };
  history.subscribe(() => { if (proposal) cancel(); });
  const draw = (visible: boolean) => {
    if (visibleFeedback && (stamp() !== revision || scenario !== world.scenario)) {
      cancel(); setStatus(M.hints.mapChangedPreview);
    }
    canvas.hidden = !visible || !visibleFeedback;
    if (!visible || !visibleFeedback) return;
    const ctx = fitOverlayCanvas(canvas, viewport); if (!ctx) return;
    for (const cell of visibleFeedback[section.get().feedback as keyof typeof visibleFeedback]) {
      drawClearanceDot(ctx, canvas, renderer.projectToViewport(cell.x, cell.y, cell.z), cell.clear);
    }
  };
  /** Discards the preview (or the one being prepared) and confirms it on the hint line. */
  const cancelPreview = () => {
    const discarded = Boolean(proposal || visibleFeedback || pending);
    cancel();
    const message = discarded ? COAST_PREVIEW_DISCARDED : NO_COAST_PREVIEW;
    setStatus(message); store.setHint(message);
  };
  return {
    cancelPreview,
    commit, draw, preview, section, setOption,
    setFeedback: (feedback: string) => section.update({ feedback })
  };
};

export type CoastReshapeEditor = ReturnType<typeof createCoastReshapeEditor>;
