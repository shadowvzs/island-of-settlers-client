import { createCampaign } from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { editorMessage } from "../messages";
import { deleteCampaignCascade, loadCampaign } from "./campaign-documents";
import type { CampaignEditorCore } from "./campaign-editor-core";
import { CAMPAIGN_ID_PREFIX } from "./constants";
import { displayText, mapEditorUrl } from "./helpers";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "./messages";

/** The campaign list: start, create, select, rename, delete (with its maps, map files and images). */
export const createCampaignListActions = (core: CampaignEditorCore) => {
  const { deps, run, state } = core;

  const askName = (question: typeof M.confirm.newName, current: string) =>
    deps.prompt(deps.translate(question), current)?.trim() ?? "";

  const renameUnselected = async (id: string) => {
    const campaign = await deps.repositories.campaigns.get(id);
    if (!campaign) return;
    const name = askName(M.confirm.rename, campaign.name.en);
    if (!name || name === campaign.name.en) return;
    await deps.repositories.campaigns.update({ ...campaign, name: { ...campaign.name, en: name } });
    await core.refreshList();
  };

  const renameSelected = async () => {
    const current = state().draft?.name.en ?? "";
    const name = askName(M.confirm.rename, current);
    if (!name || name === current) return;
    core.updateDraft(draft => ({ ...draft, name: { ...draft.name, en: name } }));
    await core.persist();
  };

  return {
    backToMapEditor: () => { if (core.canLeaveDraft()) deps.navigate(mapEditorUrl(deps.pageUrl())); },
    createCampaign: () => run(async () => {
      const name = askName(M.confirm.newName, "");
      if (!name || !core.canLeaveDraft()) return;
      const campaign = await deps.repositories.campaigns.create({
        ...createCampaign(core.newId(CAMPAIGN_ID_PREFIX)), name: { en: name }
      });
      await core.refreshList();
      await core.select(campaign.id);
    }),
    /** Asks first: the confirmation panel names the campaign and counts its maps and images. */
    deleteCampaign: (id: string) => run(async () => {
      const loaded = await loadCampaign(deps.repositories, id);
      if (!loaded) return;
      core.set({ confirmation: {
        id, imageCount: loaded.images.length, kind: "campaign", mapCount: loaded.maps.length,
        name: displayText(loaded.campaign.name, "en", id)
      } });
    }),
    /** The confirmed cascade: every map record, map file and image of the campaign, then the campaign. */
    deleteCampaignConfirmed: (id: string) => run(async () => {
      const loaded = await loadCampaign(deps.repositories, id);
      if (!loaded) return;
      const name = displayText(loaded.campaign.name, "en", id);
      if (state().draft?.id === id) core.clearSelection();
      await deleteCampaignCascade(deps.repositories, deps.mapFiles, loaded);
      await core.refreshList();
      core.notify(editorMessage(M.status.deleted, { name }));
    }),
    renameCampaign: (id: string) => run(() => state().draft?.id === id ? renameSelected() : renameUnselected(id)),
    save: () => run(core.persist),
    selectCampaign: (id: string) => run(async () => {
      if (state().draft?.id === id || !core.canLeaveDraft()) return;
      core.set({ notice: null });
      await core.select(id);
    }),
    /** Loads the list and selects `campaignId` (and `mapId`) from the URL when they exist. */
    start: (campaignId: string | null, mapId: string | null) => run(async () => {
      await core.refreshList();
      if (campaignId && state().campaigns.some(campaign => campaign.id === campaignId))
        await core.select(campaignId, mapId);
      core.set({ loaded: true });
    })
  };
};
