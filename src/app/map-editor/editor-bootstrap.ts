import { openCampaignIndexedDbRepositories } from "../campaign-storage/campaign-indexeddb-store";
import { createCampaignSlotRecord } from "./campaign/campaign-slot-record";
import { readCampaignSlotParam } from "./campaign/helpers";
import { createEditorStore } from "./editor-store";
import type { MapEditorOptions } from "./map-editor";
import { createMapLibrary } from "./map-library";
import { MAP_EDITOR_MESSAGES as M } from "./messages";
import { getStartMapErrorText } from "./progress-text";
import type { TerrainTool } from "./terrain-tool";

type LibraryOptions = Parameters<typeof createMapLibrary>[0];
type Notify = LibraryOptions["notify"];

export const createEditorMutationGuard = (
  options: Pick<MapEditorOptions, "canEditStorageTerrain" | "onEdit">, notify: Notify
) => {
  const canEdit = () => {
    if (options.canEditStorageTerrain?.() === false) {
      notify(M.hints.storageTerrainBusy, true);
      return false;
    }
    return true;
  };
  const onEdit = () => {
    if (!canEdit()) return false;
    options.onEdit?.();
    return true;
  };
  return { canEdit, onEdit };
};

export const createEditorBootstrap = (
  options: MapEditorOptions, getAnimals: LibraryOptions["getAnimals"], getTerrain: () => TerrainTool
) => {
  const store = createEditorStore();
  const guard = createEditorMutationGuard(options, store.setHint);
  const campaignSlot = typeof location === "undefined" ? null : readCampaignSlotParam(location.search);
  const library = createMapLibrary({
    campaignRecord: campaignSlot && createCampaignSlotRecord(campaignSlot, openCampaignIndexedDbRepositories),
    campaignSlot,
    getAnimals,
    getTerrain: () => { const terrain = getTerrain(); terrain.flush(); return terrain.state; },
    loadMap: options.loadMap, name: options.map.name, notify: store.setHint, provenance: options.map.provenance,
    source: options.map.source, validateAnimals: options.validateAnimals, world: options.world
  });
  if (options.map.loadError) store.setHint(getStartMapErrorText(options.map.loadError), true);
  return { ...guard, library, store };
};
