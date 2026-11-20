import type {
  CampaignMap, CampaignMapExit
} from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { CampaignRepositories } from "../../../../../island-of-settlers-shared/src/campaign/campaign-repository";
import type { CampaignMapSlot } from "./helpers";

/**
 * The campaign map record behind a campaign slot, as the 3D map editor sees it (owner 2026-11-11): the map file
 * takes the campaign map's name, and each Save writes the file's content hash (and a renamed name) back.
 */
export interface CampaignSlotRecord {
  /**
   * The campaign map's declared exits (the script editor's `endMap` exit picker, BR2), read fresh on every call;
   * null when the record is missing or storage is blocked.
   */
  exits: () => Promise<readonly CampaignMapExit[] | null>;
  /** The campaign map's English name, or null when the record is missing or storage is blocked. */
  mapName: () => Promise<string | null>;
  /** After the slot was written: stores the file hash and the (possibly renamed) English map name. */
  recordSave: (hash: string, name: string) => Promise<void>;
}

/**
 * The record with its map file hash and English name set (unchanged values keep the same object). The publication
 * state is never touched (owner decision 2026-11-13): a Ready map whose file is saved again stays Ready. Its
 * Ready check runs again only when the map maker asks for it (Check, Mark ready) or edits the record in the
 * campaign editor.
 */
export const withSavedMapFile = (map: CampaignMap, hash: string, name: string): CampaignMap => {
  const renamed = name.trim() && name.trim() !== map.name.en;
  if (map.mapFile.hash === hash && !renamed) return map;
  return {
    ...map,
    mapFile: { ...map.mapFile, hash },
    name: renamed ? { ...map.name, en: name.trim() } : map.name
  };
};

/** Reads and updates the slot's campaign map through the campaign repositories (opened on first use). */
export const createCampaignSlotRecord = (
  slot: CampaignMapSlot, openRepositories: () => Promise<CampaignRepositories | null>
): CampaignSlotRecord => {
  let opened: Promise<CampaignRepositories | null> | undefined;
  const readMap = async () => {
    opened ??= openRepositories();
    const repositories = await opened;
    const map = await repositories?.maps.get(slot.mapId);
    return repositories && map?.campaignId === slot.campaignId ? { map, repositories } : null;
  };
  return {
    exits: async () => {
      const found = await readMap();
      return found ? found.map.exits ?? [] : null;
    },
    mapName: async () => (await readMap())?.map.name.en ?? null,
    recordSave: async (hash, name) => {
      const found = await readMap();
      if (!found) return;
      const updated = withSavedMapFile(found.map, hash, name);
      if (updated !== found.map) await found.repositories.maps.update(updated);
    }
  };
};
