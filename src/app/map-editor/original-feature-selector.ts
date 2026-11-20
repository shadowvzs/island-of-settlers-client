import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { seedRegenerationProblem, seedTerrainSource } from "../../shared/world/editing/terrain/scoped-seed-regeneration";
import {
  featureContainsCell,   type GeneratedFeatureIdentity,
originalFeatureCells, validGeneratedFeatureIdentities} from "../../shared/world/generation/generated-feature-identities";
import type { WorldData } from "../../shared/world/world-data";
import type { EditorHistory } from "./editor-history";
import type { EditorStore } from "./editor-store";
import { bumpBuildRevision, getWorldRevision, pickViewCentre } from "./helpers";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createOverlayCanvas, drawBoundaryCells, fitOverlayCanvas } from "./overlay-canvas";
import { getGenerationPhaseText } from "./progress-text";
import { createSectionStore, type FieldOption, keepOption } from "./section-store";
import type { RegenerateSeedWorld } from "./seed-generation-worker";

const NO_IDENTITIES: readonly FieldOption[] = [{ label: M.hints.recoveryNoIdentities, value: "" }];

/** Recover identities only; the edited terrain is never replaced by the detached candidate. */
export const recoverOriginalFeatureIdentities = (world: WorldData, candidate: WorldData) => {
  seedTerrainSource(world, candidate);
  if (!validGeneratedFeatureIdentities(candidate.generatedFeatureIdentities, candidate))
    throw new Error("This generator did not return valid bounded source identities.");
  return structuredClone(candidate.generatedFeatureIdentities);
};

/** The select's options: one per saved source identity, or the placeholder. */
export const toOriginalFeatureOptions = (features: readonly GeneratedFeatureIdentity[] | undefined) => {
  if (!features?.length) return NO_IDENTITIES;
  return features.map(feature => ({
    label: editorMessage(M.coordinate.generatedFeatureOption, {
      id: feature.id,
      kind: feature.source === "massif" ? M.feature.originalMassif : M.feature.generatedOasis
    }),
    value: String(feature.id)
  }));
};

export const createOriginalFeatureSelector = (world: WorldData, viewport: HTMLElement, renderer: TerrainRenderer,
  history: EditorHistory, store: EditorStore, onEdit: () => boolean | void,
  busy: () => boolean, regenerate?: RegenerateSeedWorld) => {
  const section = createSectionStore({
    choice: "",
    disabled: true,
    options: NO_IDENTITIES,
    recovering: false,
    status: "" as EditorText
  });
  const setStatus = (status: EditorText) => section.update({ status });
  const canvas = createOverlayCanvas(viewport);
  let selected: GeneratedFeatureIdentity | undefined, boundary: number[] = [], matches: number[] = [];
  let token = 0, pending = false, revision = "", selectedId = "";
  let recovery: AbortController | undefined;
  let recoveryRevision = "";
  const stamp = () => getWorldRevision(world);
  const clear = () => { selected = undefined; boundary = []; canvas.hidden = true; };
  const select = (id: string) => {
    clear(); selectedId = id; section.update({ choice: id });
    selected = world.generatedFeatureIdentities?.find(feature => String(feature.id) === id);
    if (!selected) { setStatus(M.hints.recoverySource); return; }
    const cells = originalFeatureCells(selected);
    if (!cells) { setStatus(M.hints.recoverySupportBudget); return; }
    const own = new Set(cells);
    boundary = cells.filter(cell => {
      const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
      return x === 0 || z === 0 || x === world.cellsX - 1 || z === world.cellsZ - 1 ||
        [cell - 1, cell + 1, cell - world.cellsX, cell + world.cellsX].some(next => !own.has(next));
    });
    revision = stamp();
    const overlap = matches.length > 1 ? editorMessage(M.feature.overlap, { count: matches.length }) : "";
    setStatus(editorMessage(M.feature.sourceStatus, {
      cells: cells.length,
      id: selected.id,
      overlap,
      source: selected.source === "massif" ? M.feature.originalMassif : M.feature.generatedOasis
    }));
  };
  const refresh = () => {
    const options = toOriginalFeatureOptions(world.generatedFeatureIdentities);
    const choice = keepOption(options, selectedId);
    section.update({ choice, disabled: !world.generatedFeatureIdentities?.length, options });
    if (selected) select(choice);
  };
  const choose = (id: string) => { matches = []; select(id); };
  const selectAtCentre = () => {
    const point = pickViewCentre(renderer, viewport);
    if (!point) { store.setHint(M.hints.aimAtFeatured, true); return; }
    const cell = Math.floor(point.z) * world.cellsX + Math.floor(point.x);
    matches = (world.generatedFeatureIdentities ?? []).filter(feature => featureContainsCell(feature, cell))
      .map(feature => feature.id);
    if (!matches.length) { clear(); setStatus(M.hints.recoveryUnsupportedCell); }
    else select(String(matches[0]));
  };
  const selectNext = () => {
    if (!matches.length) { store.setHint(M.hints.selectOriginalFirst, true); return; }
    select(String(matches[(matches.indexOf(Number(selectedId)) + 1) % matches.length]));
  };
  const recover = async () => {
    const problem = seedRegenerationProblem(world);
    if (pending || busy() || problem || !regenerate) {
      store.setHint(problem ?? M.hints.recoveryWait, true); return;
    }
    const request = ++token, before = stamp(), recipe = JSON.stringify(world.generationProvenance);
    recovery = new AbortController(); recoveryRevision = before;
    pending = true; section.update({ recovering: true });
    setStatus(M.hints.recoveryWorking);
    try {
      const candidate = await regenerate({ ...world.generationProvenance!.options }, {
        signal: recovery.signal,
        onPhase: phase => { if (request === token) setStatus(editorMessage(M.feature.phase, { phase: getGenerationPhaseText(phase) })); }
      });
      if (request !== token || before !== stamp() || recipe !== JSON.stringify(world.generationProvenance))
        throw new Error("Recovery cancelled or map changed; no identities were adopted.");
      const identities = recoverOriginalFeatureIdentities(world, candidate);
      if (onEdit() === false) return;
      history.transaction(() => {
        world.generatedFeatureIdentities = identities;
        bumpBuildRevision(world);
        history.note({ cells: { minX: 0, minZ: 0, maxX: 0, maxZ: 0 } });
      });
      // Refreshing re-selects the shown source (its outline status); the recovery result is reported last.
      refresh();
      setStatus(editorMessage(M.hints.recoveryDone, { count: identities.length }));
    } catch {
      setStatus(M.hints.recoveryFailed);
      store.setHint(section.get().status, true);
    }
    finally { pending = false; recovery = undefined; section.update({ recovering: false }); }
  };
  const cancelRecovery = () => {
    token++; recovery?.abort();
    setStatus(M.hints.recoveryCancelled);
  };
  history.subscribe(refresh); refresh();
  const draw = (visible: boolean) => {
    if (recovery && pending && (!visible || stamp() !== recoveryRevision)) recovery.abort();
    canvas.hidden = !visible || !selected || !boundary.length;
    if (!visible || !selected || !boundary.length) return;
    if (stamp() !== revision) { clear(); setStatus(M.hints.mapChangedSelectOriginal); return; }
    const ctx = fitOverlayCanvas(canvas, viewport); if (!ctx) return;
    drawBoundaryCells(ctx, canvas, renderer, world, boundary, .18, "#56e8f0dd");
  };
  return {
    cancelRecovery, choose, draw, hide: clear, recover, section, selectAtCentre, selectNext,
    showSelected: () => choose(section.get().choice)
  };
};

export type OriginalFeatureSelector = ReturnType<typeof createOriginalFeatureSelector>;
