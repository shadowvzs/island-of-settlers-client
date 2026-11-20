import type { Campaign, CampaignMap } from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  CampaignRecordConflict, type CampaignRepositories
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-repository";
import {
  DEFAULT_ONLINE_SETTINGS, type GameSettings
} from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import type { CampaignSyncReport } from "../../campaign-storage/campaign-sync";
import { createExternalStore } from "../../components/ui-store";
import { editorMessage, type EditorText } from "../messages";
import {
  type CampaignMapFiles, deleteUnusedImages, type ImageUrls, imageViews, loadCampaign, revokeImageViews
} from "./campaign-documents";
import type { CampaignEditorState, CampaignReadyReport, CampaignStorageKind } from "./campaign-editor-state";
import { checkCampaign, checkCampaignMap } from "./campaign-readiness";
import { INITIAL_CAMPAIGN_EDITOR_STATE } from "./constants";
import { createRecordId } from "./helpers";
import type { ProcessedImage } from "./image-processing";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "./messages";

/** Everything outside the editor's own state: storage, browser dialogs, navigation and the clock. */
export interface CampaignEditorDependencies {
  confirm: (question: string) => boolean;
  /** The deployment's game settings the Check runs against (plan §13.4); absent: the default home-island mode. */
  gameSettings?: () => GameSettings;
  imageUrls: ImageUrls;
  mapFiles: CampaignMapFiles | null;
  navigate: (url: string) => void;
  now: () => number;
  pageUrl: () => string;
  processImage: (file: Blob) => Promise<ProcessedImage>;
  prompt: (question: string, value: string) => string | null;
  random: () => number;
  repositories: CampaignRepositories;
  /** Syncs the local records and map files with the server; null offline or without an administrator session. */
  serverSync: (() => Promise<CampaignSyncReport>) | null;
  storage: CampaignStorageKind;
  /** Resolves editor copy in the active locale (dialog questions). */
  translate: (text: EditorText) => string;
}

export const errorReason = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * The editor's state store plus the shared steps every action uses: one action at a time, loading a campaign,
 * working-copy updates and Save (with the re-check of edited Ready documents).
 */
export const createCampaignEditorCore = (deps: CampaignEditorDependencies) => {
  const store = createExternalStore<CampaignEditorState>({
    ...INITIAL_CAMPAIGN_EDITOR_STATE, server: deps.serverSync ? "connected" : "none", storage: deps.storage
  });
  const state = store.getSnapshot;
  const set = (change: Partial<CampaignEditorState>) => store.set({ ...state(), ...change });
  const dirtyMapIds = new Set<string>();
  const notify = (text: EditorText, error = false) => set({ notice: { error, text } });
  const imageIds = () => new Set(Object.keys(state().images));
  const readMapFile = (slotId: string) => deps.mapFiles?.read(slotId) ?? Promise.resolve(null);
  const gameSettings = () => deps.gameSettings?.() ?? DEFAULT_ONLINE_SETTINGS;
  const mapCheckSource = () => ({ imageIds: imageIds(), readBytes: readMapFile, settings: gameSettings() });

  const clearSelection = () => {
    revokeImageViews(state().images, deps.imageUrls);
    dirtyMapIds.clear();
    set({ dirty: false, draft: null, images: {}, jump: null, maps: [], report: null, selectedMapId: null,
      textEdits: [] });
  };

  const select = async (id: string, mapId: string | null = null) => {
    const loaded = await loadCampaign(deps.repositories, id);
    clearSelection();
    if (!loaded) return;
    const { campaign } = loaded;
    const selectedMapId = mapId && campaign.mapIds.includes(mapId) ? mapId : campaign.mapIds[0] ?? null;
    set({ draft: campaign, images: imageViews(loaded.images, deps.imageUrls), maps: loaded.maps, selectedMapId });
  };

  /** Runs one action at a time; storage errors become the notice, a revision conflict reloads the campaign. */
  const run = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    if (state().busy) return undefined;
    set({ busy: true });
    try {
      return await action();
    } catch (error) {
      const draftId = state().draft?.id;
      if (!(error instanceof CampaignRecordConflict) || !draftId) {
        notify(editorMessage(M.status.failed, { reason: errorReason(error) }), true);
        return undefined;
      }
      await select(draftId, state().selectedMapId);
      notify(M.status.conflict, true);
      return undefined;
    } finally {
      set({ busy: false });
    }
  };

  const updateDraft = (change: (campaign: Campaign) => Campaign) => {
    const { draft } = state();
    if (draft) set({ dirty: true, draft: change(draft) });
  };

  const updateMap = (mapId: string, change: (map: CampaignMap) => CampaignMap) => {
    dirtyMapIds.add(mapId);
    set({ dirty: true, maps: state().maps.map(map => map.id === mapId ? change(map) : map) });
  };

  const dropImageViews = (ids: ReadonlySet<string>) => {
    if (!ids.size) return;
    const images = { ...state().images };
    for (const id of ids) {
      const view = images[id];
      if (view) deps.imageUrls.revoke(view.url);
      delete images[id];
    }
    set({ images });
  };

  /** Ready maps edited since the last save are checked again with their map file; failures become drafts. */
  const recheckEditedReadyMaps = async (campaign: Campaign) => {
    const results: CampaignReadyReport["maps"][number][] = [];
    const maps = await Promise.all(state().maps.map(async map => {
      if (!dirtyMapIds.has(map.id) || map.state !== "ready") return map;
      const result = await checkCampaignMap(map, campaign, mapCheckSource());
      results.push({ mapId: map.id, result });
      return result.ready ? map : { ...map, state: "draft" as const };
    }));
    return { maps, results };
  };

  /** Stores the working copies; a Ready campaign or map that no longer passes its check is saved as a draft. */
  const persist = async () => {
    const { draft } = state();
    if (!draft) return;
    const { maps, results } = await recheckEditedReadyMaps(draft);
    const check = checkCampaign(draft, maps, imageIds());
    const campaign = draft.state === "ready" && !check.ready ? { ...draft, state: "draft" as const } : draft;
    const storedMaps = await Promise.all(maps.map(map => dirtyMapIds.has(map.id)
      ? deps.repositories.maps.update(map) : Promise.resolve(map)));
    const storedCampaign = await deps.repositories.campaigns.update(campaign);
    dirtyMapIds.clear();
    dropImageViews(await deleteUnusedImages(deps.repositories, storedCampaign, storedMaps));
    const failed = campaign !== draft || results.some(entry => !entry.result.ready);
    const report = failed ? { campaign: check, maps: results } : state().report;
    set({ campaigns: await deps.repositories.campaigns.list(), dirty: false, draft: storedCampaign, maps: storedMaps,
      report });
    notify(failed ? M.status.returnedToDraft : M.status.saved, failed);
  };

  return {
    canLeaveDraft: () => !state().dirty || deps.confirm(deps.translate(M.confirm.discard)),
    clearSelection,
    deps,
    dirtyMapIds,
    imageIds,
    mapCheckSource,
    newId: (prefix: string) => createRecordId(prefix, deps.now(), deps.random()),
    notify,
    persist,
    refreshList: async () => set({ campaigns: await deps.repositories.campaigns.list() }),
    run,
    select,
    set,
    state,
    store,
    updateDraft,
    updateMap
  };
};

export type CampaignEditorCore = ReturnType<typeof createCampaignEditorCore>;
