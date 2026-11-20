import type { I18n } from "@lingui/core";

import type { CampaignMapExit } from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { MapAudioAsset } from "../../../../../island-of-settlers-shared/src/script/audio";
import { freezeMapScript } from "../../../../../island-of-settlers-shared/src/script/hash";
import type { ScriptValidationResult } from "../../../../../island-of-settlers-shared/src/script/issues";
import type { MapScript } from "../../../../../island-of-settlers-shared/src/script/types/script";
import type { ScriptTrigger } from "../../../../../island-of-settlers-shared/src/script/types/triggers";
import { translateMessage } from "../../../shared/i18n/translate";
import type { ScenarioPoint } from "../../../shared/world/map-scenario";
import type { WorldData } from "../../../shared/world/world-data";
import { createExternalStore } from "../../components/ui-store";
import type { EditorStore } from "../editor-store";
import type { EditorText } from "../messages";
import { addRegionAt, nearestAuthoredObject } from "./actors";
import { SCRIPT_UNDO_LIMIT, type TriggerListFilter } from "./constants";
import type { ScriptDeepLink } from "./deep-link";
import { SCRIPT_MESSAGES as M } from "./messages";
import { createEmptyMapScript, replaceTrigger } from "./script-document";
import { scriptMapKind, validateEditedScript } from "./validation";

/**
 * The Script workspace's state and commands (design §13.1): the edited map script (frozen snapshots, so unchanged
 * parts are shared), its own undo/redo, live validation, the selection, and "pick on map". Every commit writes
 * `world.script`, which the map file codec stores in the header on Save (TRG1).
 */

export type PickKind = "object" | "region";

/** A request to show a tab with one item selected (deep link); a new revision applies it. */
export interface ScriptFocusRequest extends ScriptDeepLink {
  revision: number;
}

export interface ScriptWorkspaceState {
  /** Audio uploaded with the map (`world.audioAssets`); saved in the map file header beside the script. */
  audioAssets: readonly MapAudioAsset[];
  /** The map is a campaign map: its `endMap` actions may name an exit (BR2). */
  campaignMap: boolean;
  canRedo: boolean;
  canUndo: boolean;
  filter: TriggerListFilter;
  /** The last deep link request (tab, item, field path), null until one arrives. */
  focus: ScriptFocusRequest | null;
  /** The declared exits of the map's campaign record; null while unknown (no campaign record at hand). */
  mapExits: readonly CampaignMapExit[] | null;
  /** Last workspace notice (picked object, refusal), "" when none. */
  notice: EditorText;
  noticeIsRefusal: boolean;
  /** A running "pick on map" (the window steps aside until the click). */
  pick: PickKind | null;
  query: string;
  script: MapScript;
  selectedActorId: string | null;
  selectedTriggerId: string | null;
  validation: ScriptValidationResult;
}

export interface ScriptWorkspaceOptions {
  /** Asks the author (the browser confirmation by default); true continues. */
  confirmSave?: (question: string) => boolean;
  i18n?: I18n;
  /** Reads the declared exits of the map's campaign record (null: no record); absent outside a campaign slot. */
  mapExits?: () => Promise<readonly CampaignMapExit[] | null>;
  /** Edit permission (the editor's own `onEdit`: false refuses, e.g. while the island is being replaced). */
  onEdit: () => boolean;
  /** Starts the admin play-test of the edited map (the map library's `testPlay`); absent hides the button. */
  onTestPlay?: () => void;
  store: Pick<EditorStore, "clearTool" | "getState" | "selectTool" | "setHint" | "subscribe">;
  world: WorldData;
}

type PickHandler = (result: { objectId: number } | { regionId: string }) => void;

export const createScriptWorkspace = ({
  confirmSave = text => globalThis.confirm?.(text) ?? true, i18n, mapExits, onEdit, onTestPlay, store, world
}: ScriptWorkspaceOptions) => {
  const initial = freezeMapScript(structuredClone(world.script) ?? createEmptyMapScript());
  const state = createExternalStore<ScriptWorkspaceState>({
    audioAssets: world.audioAssets ?? [],
    campaignMap: scriptMapKind(world) === "campaign", canRedo: false, canUndo: false, filter: "all", focus: null,
    mapExits: null, notice: "", noticeIsRefusal: false, pick: null, query: "", script: initial,
    selectedActorId: null, selectedTriggerId: initial.triggers[0]?.id ?? null,
    validation: validateEditedScript(world, initial)
  });
  const past: MapScript[] = [];
  const future: MapScript[] = [];
  let pickHandler: PickHandler | null = null;
  const get = state.getSnapshot;
  const set = (change: Partial<ScriptWorkspaceState>) => state.set({ ...get(), ...change });
  const check = (script: MapScript) => validateEditedScript(world, script, get().mapExits);

  /** Reads the campaign record's exits again (the campaign editor may have changed them) and re-checks. */
  const loadMapExits = async () => {
    const loaded = await mapExits?.().catch(() => null) ?? null;
    if (JSON.stringify(loaded) === JSON.stringify(get().mapExits)) return;
    set({ mapExits: loaded });
    set({ validation: check(get().script) });
  };
  void loadMapExits();

  /** An edit may move rows, so the deep link's field highlight ends with the first change. */
  const withoutLinkedField = (focus: ScriptFocusRequest | null) => {
    if (!focus?.path) return focus;
    const { path: _path, ...rest } = focus;
    return rest;
  };

  const show = (script: MapScript, change: Partial<ScriptWorkspaceState> = {}) => {
    world.script = script;
    set({ canRedo: future.length > 0, canUndo: past.length > 0, focus: withoutLinkedField(get().focus), script,
      validation: check(script), ...change });
  };

  /** Commits a new script (one undo step); refused while the map cannot be edited. */
  const commit = (next: MapScript, change: Partial<ScriptWorkspaceState> = {}) => {
    const current = get().script;
    if (next === current) return false;
    if (!onEdit()) { set({ notice: M.workspace.refused, noticeIsRefusal: true }); return false; }
    past.push(current);
    if (past.length > SCRIPT_UNDO_LIMIT) past.shift();
    future.length = 0;
    show(freezeMapScript(next), { notice: "", noticeIsRefusal: false, ...change });
    return true;
  };

  const restore = (from: MapScript[], to: MapScript[]) => {
    const script = from.pop();
    if (!script || !onEdit()) return;
    to.push(get().script);
    const selected = get().selectedTriggerId;
    show(script, { selectedTriggerId: script.triggers.some(item => item.id === selected) ? selected
      : script.triggers[0]?.id ?? null });
  };

  const finishPick = () => {
    pickHandler = null;
    if (get().pick) set({ pick: null });
    if (store.getState().tool?.kind === "scriptPick") store.clearTool();
  };

  // A right click, Escape or another tool ends a pending pick.
  store.subscribe(() => {
    if (get().pick && store.getState().tool?.kind !== "scriptPick") { pickHandler = null; set({ pick: null }); }
  });

  const pickRegion = (point: ScenarioPoint) => {
    const handler = pickHandler;
    const { region, script } = addRegionAt(get().script, point,
      number => translateMessage(i18n, M.picker.regionName, { number }));
    finishPick();
    if (commit(script)) handler?.({ regionId: region.id });
  };

  const pickObject = (point: ScenarioPoint) => {
    const found = nearestAuthoredObject(world, point);
    if (!found) { store.setHint(M.picker.noObjectNear, true); return; }
    const handler = pickHandler;
    finishPick();
    handler?.({ objectId: found.id });
  };

  return {
    getSnapshot: get,
    subscribe: state.subscribe,
    commit,
    /** Applies a change to one trigger (by id). */
    updateTrigger: (id: string, change: (trigger: ScriptTrigger) => ScriptTrigger) => {
      const trigger = get().script.triggers.find(item => item.id === id);
      if (trigger) commit(replaceTrigger(get().script, change(trigger)));
    },
    undo: () => restore(past, future),
    redo: () => restore(future, past),
    selectTrigger: (selectedTriggerId: string | null) => set({ selectedTriggerId }),
    selectActor: (selectedActorId: string | null) => set({ selectedActorId }),
    /** Shows a deep link: its tab, with the named trigger or actor selected (quests and variables follow `focus`). */
    focusItem: (link: ScriptDeepLink) => {
      const { focus, script, selectedActorId, selectedTriggerId } = get();
      const names = (items: readonly { id: string }[]) => items.some(item => item.id === link.itemId);
      set({
        filter: "all",
        focus: { ...link, revision: (focus?.revision ?? 0) + 1 },
        query: "",
        selectedActorId: link.tab === "actors" && names(script.actors) ? link.itemId! : selectedActorId,
        selectedTriggerId: link.tab === "triggers" && names(script.triggers) ? link.itemId! : selectedTriggerId
      });
    },
    setQuery: (query: string) => set({ query }),
    setFilter: (filter: TriggerListFilter) => set({ filter }),
    setNotice: (notice: EditorText, noticeIsRefusal = false) => set({ notice, noticeIsRefusal }),
    /** Re-runs the Ready check (the map's objects may have changed while the workspace was closed). */
    refresh: () => {
      set({ campaignMap: scriptMapKind(world) === "campaign", validation: check(get().script) });
      void loadMapExits();
    },
    /** Starts "pick on map": the next map click makes a region or picks the nearest authored object. */
    beginPick: (kind: PickKind, handler: PickHandler) => {
      pickHandler = handler;
      set({ pick: kind });
      store.selectTool("scriptPick");
      store.setHint(kind === "region" ? M.picker.pickRegionHint : M.picker.pickObjectHint);
    },
    cancelPick: finishPick,
    /** The map click of a pending pick (routed by the map editor's stamp). */
    pickAt: (point: ScenarioPoint) => {
      if (get().pick === "region") pickRegion(point);
      else if (get().pick === "object") pickObject(point);
    },
    /**
     * Owner answer 1: saving a map whose script has errors asks "save as draft anyway?" (never blocks); true saves.
     */
    confirmDraftSave: () => {
      const validation = check(get().script);
      set({ validation });
      if (validation.ready || !world.script) return true;
      return confirmSave(translateMessage(i18n, M.workspace.confirmDraftSave, { errors: validation.errors.length }));
    },
    canTestPlay: onTestPlay !== undefined,
    /** Test play: refused with a notice while the script has errors (a draft cannot run), else the play-test. */
    testPlay: () => {
      const validation = check(get().script);
      if (!validation.ready) {
        set({ notice: M.workspace.testPlayErrors, noticeIsRefusal: true, validation });
        return;
      }
      set({ notice: "", noticeIsRefusal: false, validation });
      onTestPlay?.();
    },
    /** Replaces the map's uploaded audio (not an undo step: the bytes stay out of the script history). */
    setAudioAssets: (assets: readonly MapAudioAsset[]) => {
      if (!onEdit()) { set({ notice: M.workspace.refused, noticeIsRefusal: true }); return false; }
      world.audioAssets = assets.length ? [...assets] : undefined;
      set({ audioAssets: assets, validation: validateEditedScript(world, get().script) });
      return true;
    },
    /** Map centre in cells (new template regions are placed around it). */
    mapCenter: () => ({ x: world.cellsX / 2, z: world.cellsZ / 2 }),
    world
  };
};

export type ScriptWorkspace = ReturnType<typeof createScriptWorkspace>;
