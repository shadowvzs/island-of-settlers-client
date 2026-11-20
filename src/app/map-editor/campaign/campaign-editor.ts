import { editorMessage } from "../messages";
import { createImageRecord } from "./campaign-documents";
import { type CampaignEditorDependencies, createCampaignEditorCore } from "./campaign-editor-core";
import { createCampaignListActions } from "./campaign-list-actions";
import { createCampaignMapActions } from "./campaign-map-actions";
import { createCampaignPathActions } from "./campaign-path-actions";
import { checkCampaign, checkWholeCampaign, reportTotals } from "./campaign-readiness";
import { createCampaignServerActions } from "./campaign-server-actions";
import { createCampaignTextActions } from "./campaign-text-actions";
import { CAMPAIGN_IMAGE_ID_PREFIX, CAMPAIGN_SPEAKER_ID_PREFIX, IMAGE_REFUSAL_TEXT, KILOBYTE } from "./constants";
import { CampaignImageRefused, type ProcessedImage } from "./image-processing";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "./messages";
import { withSpeakerAdded } from "./speakers/helpers";

export type { CampaignEditorDependencies } from "./campaign-editor-core";

/**
 * The campaign editor service (C6): the campaign list, the selected campaign's working copies and every action
 * against the C1 repository. React reads it through `useCampaignEditor`; views hold no rule.
 */
export const createCampaignEditor = (deps: CampaignEditorDependencies) => {
  const core = createCampaignEditorCore(deps);
  const { run, state } = core;

  const processUpload = async (file: Blob): Promise<ProcessedImage | null> => {
    try {
      return await deps.processImage(file);
    } catch (error) {
      if (!(error instanceof CampaignImageRefused)) throw error;
      core.notify(M.status[IMAGE_REFUSAL_TEXT[error.reason]], true);
      return null;
    }
  };

  /** Stores an owner-confirmed upload as a WebP image record of the campaign; answers its id (null: refused). */
  const uploadImage = (file: Blob) => run(async () => {
    const { artworkConfirmed, draft } = state();
    if (!draft) return null;
    if (!artworkConfirmed) { core.notify(M.status.needsArtworkConfirmation, true); return null; }
    const processed = await processUpload(file);
    if (!processed) return null;
    const record = createImageRecord(core.newId(CAMPAIGN_IMAGE_ID_PREFIX), draft.id, processed);
    const image = await deps.repositories.images.create(record);
    const url = deps.imageUrls.create(image.bytes, image.mimeType);
    core.set({ images: { ...state().images, [image.id]: { height: image.height, url, width: image.width } } });
    const size = `${Math.ceil(image.bytes.length / KILOBYTE)} KB`;
    core.notify(editorMessage(M.status.uploaded, { height: image.height, size, width: image.width }));
    return image.id;
  });

  /** A speaker needs its neutral portrait, so adding one starts with that upload. */
  const addSpeaker = async (file: Blob) => {
    const imageId = await uploadImage(file);
    if (!imageId) return;
    const id = core.newId(CAMPAIGN_SPEAKER_ID_PREFIX);
    core.updateDraft(campaign => withSpeakerAdded(campaign, id, imageId));
  };

  /** The whole-campaign Check: the campaign, every map with its file and script, rewards and translations. */
  const checkReady = () => run(async () => {
    const { draft, maps } = state();
    if (!draft) return;
    const report = await checkWholeCampaign(draft, maps, core.mapCheckSource());
    const { errors, warnings } = reportTotals(report);
    core.set({ report });
    core.notify(editorMessage(M.status.checked, { errors, warnings }), errors > 0);
  });

  /** Ready runs the campaign check first and stays a draft (with the error list) when it fails. */
  const setCampaignReady = (ready: boolean) => run(async () => {
    const { draft, maps } = state();
    if (!draft) return;
    if (!ready) { core.updateDraft(campaign => ({ ...campaign, state: "draft" })); await core.persist(); return; }
    const result = checkCampaign(draft, maps, core.imageIds());
    core.set({ report: { campaign: result, maps: [] } });
    if (!result.ready) { core.notify(M.status.notReady, true); return; }
    core.updateDraft(campaign => ({ ...campaign, state: "ready" }));
    await core.persist();
    if (state().draft?.state === "ready") core.notify(M.status.ready);
  });

  const listActions = createCampaignListActions(core), mapActions = createCampaignMapActions(core);

  /** The confirmation panel's destructive button: runs the pending deletion once. */
  const confirmDeletion = async () => {
    const { confirmation } = state();
    if (!confirmation || state().busy) return;
    core.set({ confirmation: null });
    if (confirmation.kind === "campaign") await listActions.deleteCampaignConfirmed(confirmation.id);
    else await mapActions.deleteMapConfirmed(confirmation.id);
  };

  return {
    ...listActions,
    ...mapActions,
    ...createCampaignPathActions(core),
    ...createCampaignServerActions(core),
    ...createCampaignTextActions(core),
    cancelDeletion: () => core.set({ confirmation: null }),
    confirmDeletion,
    addSpeaker,
    checkReady,
    dispose: core.clearSelection,
    getState: state,
    setArtworkConfirmed: (artworkConfirmed: boolean) => core.set({ artworkConfirmed }),
    setCampaignReady,
    subscribe: core.store.subscribe,
    updateDraft: core.updateDraft,
    updateMap: core.updateMap,
    uploadImage
  };
};

export type CampaignEditor = ReturnType<typeof createCampaignEditor>;
