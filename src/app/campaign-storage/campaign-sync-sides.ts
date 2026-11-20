import type { CampaignRepositories } from "../../../../island-of-settlers-shared/src/campaign/campaign-repository";
import type { MapStorage } from "../map-editor/map-storage";
import type { CampaignServer } from "./campaign-server-client";
import type { CampaignSyncBaseStore, CampaignSyncSide } from "./campaign-sync";
import { type CampaignSyncBase, emptyCampaignSyncBase } from "./campaign-sync-plan";
import { CAMPAIGN_SYNC_BASE_KEY_PREFIX } from "./constants";

/** This browser's side: the IndexedDB records and the campaign map slots (`mapFile.id`) of the map storage. */
export const createLocalCampaignSyncSide = (
  repositories: CampaignRepositories, mapStorage: Pick<MapStorage, "delete" | "read" | "write">,
  hashBytes: (bytes: Uint8Array) => Promise<string>, now: () => number = Date.now
): CampaignSyncSide => ({
  deleteMapFile: map => mapStorage.delete(map.mapFile.id),
  mapFileHashes: async maps => {
    const hashes = new Map<string, string>();
    for (const map of maps) {
      const bytes = await mapStorage.read(map.mapFile.id);
      if (bytes) hashes.set(map.id, await hashBytes(bytes));
    }
    return hashes;
  },
  readMapFile: map => mapStorage.read(map.mapFile.id),
  repositories,
  writeMapFile: (map, bytes) =>
    mapStorage.write({ id: map.mapFile.id, name: map.name.en, savedAt: now(), size: bytes.length }, bytes)
});

/** The server's side over the administrator routes. */
export const createServerCampaignSyncSide = ({ mapFiles, repositories }: CampaignServer): CampaignSyncSide => ({
  deleteMapFile: map => mapFiles.delete(map.id),
  mapFileHashes: async () => new Map((await mapFiles.list()).map(file => [file.mapId, file.hash])),
  readMapFile: map => mapFiles.read(map.id),
  repositories,
  writeMapFile: async (map, bytes) => { await mapFiles.write(map.id, bytes); }
});

const readBase = (text: string | null): CampaignSyncBase => {
  try {
    return { ...emptyCampaignSyncBase(), ...(JSON.parse(text ?? "{}") as Partial<CampaignSyncBase>) };
  } catch {
    return emptyCampaignSyncBase();
  }
};

/**
 * The sync base in web storage, one entry per server (`apiUrl`). A lost or blocked entry only means the next sync
 * compares every record again (equal documents need nothing; different ones follow the conflict rule).
 */
export const createCampaignSyncBaseStore = (
  storage: Pick<Storage, "getItem" | "setItem"> | null, apiUrl: string
): CampaignSyncBaseStore => {
  const key = `${CAMPAIGN_SYNC_BASE_KEY_PREFIX}${apiUrl}`;
  let current: CampaignSyncBase | null = null;
  const stored = () => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  return {
    read: () => current ??= readBase(stored()),
    write: base => {
      current = base;
      try {
        storage?.setItem(key, JSON.stringify(base));
      } catch { /* blocked storage: the base lives for this page only */ }
    }
  };
};
