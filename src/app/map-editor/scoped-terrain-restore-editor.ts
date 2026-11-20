import { captureTerrainRestoreBaseline, restoreTerrainSelection } from "../../shared/world/editing/terrain/scoped-restore";
import type { TerrainComponent } from "../../shared/world/editing/terrain/terrain-component";
import type { WorldData } from "../../shared/world/world-data";
import type { EditorHistory } from "./editor-history";
import type { EditorStore } from "./editor-store";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createScopedSeedRegenerationControls } from "./scoped-seed-regeneration-controls";
import { createSectionStore } from "./section-store";
import type { RegenerateSeedWorld } from "./seed-generation-worker";
import type { TerrainTool } from "./terrain-tool";

/** Safe baseline restore, deliberately distinct from rerunning an unknown historical seed. */
export const createScopedTerrainRestoreEditor = (world: WorldData, terrain: TerrainTool, history: EditorHistory,
  store: EditorStore, selection: () => TerrainComponent | null, onEdit: () => boolean | void,
  relocate?: (inside: (x: number, z: number) => boolean) => void,
  regenerate?: RegenerateSeedWorld) => {
  let generationBusy = false;
  const section = createSectionStore({
    busy: false,
    name: world.restoreBaselineName ?? "My terrain baseline",
    status: "" as EditorText
  });
  const setStatus = (status: EditorText) => section.update({ status });
  const capture = () => {
    if (terrain.stats.busy || generationBusy) { store.setHint(M.hints.seedWait, true); return; }
    try {
      if (onEdit() === false) return;
      captureTerrainRestoreBaseline(world, section.get().name);
      setStatus(editorMessage(M.hints.baselineCaptured, { name: world.restoreBaselineName ?? "" }));
    }
    catch { store.setHint(M.hints.baselineCaptureFailed, true); }
  };
  const restore = () => {
    if (terrain.stats.busy || generationBusy) { store.setHint(M.hints.seedWait, true); return; }
    const component = selection();
    if (!component) { store.setHint(M.hints.selectContourFirst, true); return; }
    if (onEdit() === false) return;
    history.begin();
    try {
      const result = restoreTerrainSelection(world, terrain.state, component.cells);
      if (result.changed) {
        history.note({ cells: result.cells, ground: true, mineStones: false });
        const selectedCells = new Set(component.cells);
        relocate?.((x, z) => selectedCells.has(Math.floor(z) * world.cellsX + Math.floor(x)));
        terrain.rebuildArea(result.cells, true, []);
      }
      setStatus(editorMessage(M.hints.baselineRestored, {
        count: result.changed,
        name: world.restoreBaselineName ?? ""
      }));
    } catch { store.setHint(M.hints.baselineRestoreFailed, true); }
    finally { history.endStroke(); }
  };
  const seedRegeneration = createScopedSeedRegenerationControls(world, terrain, history, store, selection, onEdit,
    busy => { generationBusy = busy; section.update({ busy }); }, regenerate, relocate);
  return { capture, restore, section, seedRegeneration, setName: (name: string) => section.update({ name }) };
};

export type ScopedTerrainRestoreEditor = ReturnType<typeof createScopedTerrainRestoreEditor>;
