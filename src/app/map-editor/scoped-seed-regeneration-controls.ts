import type { TerrainRestoreSource } from "../../shared/world/editing/terrain/scoped-restore";
import {
  regenerateSeedTerrainSelection, seedRegenerationProblem, seedTerrainSource
} from "../../shared/world/editing/terrain/scoped-seed-regeneration";
import type { TerrainComponent } from "../../shared/world/editing/terrain/terrain-component";
import type { WorldData } from "../../shared/world/world-data";
import type { EditorHistory } from "./editor-history";
import type { EditorStore } from "./editor-store";
import { getWorldRevision } from "./helpers";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { getGenerationPhaseText, getSeedProblemText } from "./progress-text";
import { createSectionStore } from "./section-store";
import type { RegenerateSeedWorld } from "./seed-generation-worker";
import type { TerrainTool } from "./terrain-tool";

export const createScopedSeedRegenerationControls = (world: WorldData, terrain: TerrainTool,
  history: EditorHistory, store: EditorStore, selection: () => TerrainComponent | null, onEdit: () => boolean | void,
  setBusy: (busy: boolean) => void, regenerate?: RegenerateSeedWorld,
  relocate?: (inside: (x: number, z: number) => boolean) => void) => {
  const problem = seedRegenerationProblem(world);
  const section = createSectionStore({
    disabled: Boolean(problem) || !regenerate,
    status: (problem ? getSeedProblemText(problem) : "") as EditorText
  });
  const setStatus = (status: EditorText) => section.update({ status });
  let request: AbortController | undefined;
  let generating = false, baseline: TerrainRestoreSource | undefined, baselineRecipe = "";
  const revisions = () => getWorldRevision(world);
  const regenerateSelection = async () => {
    if (generating || terrain.stats.busy) { store.setHint(M.hints.seedWait, true); return; }
    const chosen = selection(), invalid = seedRegenerationProblem(world);
    if (invalid || !regenerate) { store.setHint(invalid ? getSeedProblemText(invalid) : M.hints.seedUnavailable, true); return; }
    if (!chosen || chosen.truncated || !chosen.cells.length) {
      store.setHint(M.hints.selectContourFirst, true); return;
    }
    const before = revisions(), recipe = JSON.stringify(world.generationProvenance), cells = chosen.cells.slice();
    request = new AbortController();
    generating = true; section.update({ disabled: true }); setBusy(true);
    try {
      setStatus(M.hints.seedPreparing);
      if (!baseline || baselineRecipe !== recipe) {
        const candidate = await regenerate({ ...world.generationProvenance!.options }, { signal: request.signal,
          onPhase: phase => {
            if (revisions() !== before || selection() !== chosen ||
              JSON.stringify(world.generationProvenance) !== recipe) request?.abort();
            else setStatus(editorMessage(M.feature.phase, { phase: getGenerationPhaseText(phase) }));
          } });
        baseline = seedTerrainSource(world, candidate); baselineRecipe = recipe;
      }
      if (terrain.stats.busy || revisions() !== before || selection() !== chosen ||
        JSON.stringify(world.generationProvenance) !== recipe) throw new Error("Map or contour changed; select again before regenerating.");
      if (onEdit() === false) return;
      history.begin();
      try {
        const result = regenerateSeedTerrainSelection(world, terrain.state, cells, baseline);
        if (result.changed) {
          history.note({ cells: result.cells, ground: true, mineStones: false });
          const selected = new Set(cells);
          relocate?.((x, z) => selected.has(Math.floor(z) * world.cellsX + Math.floor(x)));
          terrain.rebuildArea(result.cells, true, []);
        }
        setStatus(editorMessage(M.hints.seedRestored, { count: result.changed }));
      } finally { history.endStroke(); }
    } catch {
      setStatus(M.hints.seedFailed);
      store.setHint(section.get().status, true);
    }
    finally { request = undefined; generating = false; section.update({ disabled: false }); setBusy(false); }
  };
  const cancel = () => { request?.abort(); setStatus(M.hints.seedCancelled); };
  return { cancel, regenerate: regenerateSelection, section };
};
