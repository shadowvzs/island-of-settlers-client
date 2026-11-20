import { editorMessage } from "../messages";
import type { ScriptDeepLink } from "../script/deep-link";
import type { CampaignEditorCore } from "./campaign-editor-core";
import type { CampaignReadyReport } from "./campaign-editor-state";
import { checkCampaign, checkCampaignMap } from "./campaign-readiness";
import { CAMPAIGN_MAP_ID_PREFIX } from "./constants";
import { campaignMapEditorUrl, displayText } from "./helpers";
import { listMap, moveMapId, newCampaignMap, unlistMap } from "./map-list/helpers";
import { setNodePosition } from "./map-view/helpers";
import { CAMPAIGN_EDITOR_MESSAGES as M } from "./messages";

/** The selected campaign's maps: order, nodes, records, map files ("Open map") and their Ready state. */
export const createCampaignMapActions = (core: CampaignEditorCore) => {
  const { deps, run, state } = core;
  const findMap = (mapId: string) => state().maps.find(map => map.id === mapId);

  const markMapReady = async (mapId: string) => {
    const { draft } = state(), map = findMap(mapId);
    if (!draft || !map) return;
    const result = await checkCampaignMap(map, draft, core.mapCheckSource());
    const report: CampaignReadyReport = {
      campaign: checkCampaign(draft, state().maps, core.imageIds()), maps: [{ mapId, result }]
    };
    core.set({ report });
    if (!result.ready) { core.notify(M.status.notReady, true); return; }
    core.updateMap(mapId, entry => ({ ...entry, state: "ready" }));
    await core.persist();
    core.notify(editorMessage(M.status.mapReady, { name: displayText(map.name, "en", map.id) }));
  };

  return {
    /** A new draft map record owned by the campaign, appended to the order (Save stores the order). */
    addMap: () => run(async () => {
      const { draft } = state();
      if (!draft) return;
      const id = core.newId(CAMPAIGN_MAP_ID_PREFIX);
      const map = await deps.repositories.maps.create(newCampaignMap(draft, id, state().maps.length + 1));
      core.set({ maps: [...state().maps, map], selectedMapId: map.id });
      core.updateDraft(campaign => listMap(campaign, map));
    }),
    /** Asks first: the confirmation panel names the map (its record and map file). */
    deleteMap: (mapId: string) => {
      const map = findMap(mapId);
      if (!map || state().busy) return;
      core.set({ confirmation: {
        id: mapId, imageCount: 0, kind: "map", mapCount: 1, name: displayText(map.name, "en", map.id)
      } });
    },
    deleteMapConfirmed: (mapId: string) => run(async () => {
      const map = findMap(mapId);
      if (!map) return;
      await deps.repositories.maps.delete(map.id, map.revision);
      await deps.mapFiles?.delete(map.mapFile.id);
      core.dirtyMapIds.delete(mapId);
      const selectedMapId = state().selectedMapId === mapId ? null : state().selectedMapId;
      core.set({ maps: state().maps.filter(entry => entry.id !== mapId), selectedMapId });
      core.updateDraft(campaign => unlistMap(campaign, mapId));
      await core.persist();
    }),
    listMap: (mapId: string) => {
      const map = findMap(mapId);
      if (map) core.updateDraft(campaign => listMap(campaign, map));
    },
    moveMap: (from: number, to: number) =>
      core.updateDraft(campaign => ({ ...campaign, mapIds: moveMapId(campaign.mapIds, from, to) })),
    /** Saves pending changes, then opens the map's slot in the 3D map editor (its Save writes that slot). */
    openMap: (mapId: string, scriptLink?: ScriptDeepLink) => run(async () => {
      const { draft } = state();
      if (!draft) return;
      if (state().dirty) await core.persist();
      if (!state().dirty) deps.navigate(campaignMapEditorUrl(deps.pageUrl(), draft.id, mapId, scriptLink));
    }),
    selectMap: (selectedMapId: string) => core.set({ selectedMapId }),
    setMapReady: (mapId: string, ready: boolean) => run(async () => {
      if (ready) { await markMapReady(mapId); return; }
      core.updateMap(mapId, map => ({ ...map, state: "draft" }));
      await core.persist();
    }),
    setNode: (mapId: string, u: number, v: number) =>
      core.updateDraft(campaign => setNodePosition(campaign, mapId, u, v)),
    unlistMap: (mapId: string) => core.updateDraft(campaign => unlistMap(campaign, mapId))
  };
};
