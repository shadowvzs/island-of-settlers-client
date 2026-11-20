import type { CampaignRepositories } from "../../../../../island-of-settlers-shared/src/campaign/campaign-repository";
import { createCampaignServerClient } from "../../campaign-storage/campaign-server-client";
import { syncCampaignRecords } from "../../campaign-storage/campaign-sync";
import {
  createCampaignSyncBaseStore, createLocalCampaignSyncSide, createServerCampaignSyncSide
} from "../../campaign-storage/campaign-sync-sides";
import { catalogSession, hashMapBytes } from "../map-catalog";
import type { MapStorage } from "../map-storage";
import type { CampaignStorageKind } from "./campaign-editor-state";

const webStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * The editor's server sync when the online service answers and an administrator is signed in, else null (the
 * editor then stays local). Memory-only records (blocked browser storage) are never synced.
 */
export const openCampaignServerSync = async (
  repositories: CampaignRepositories, mapStorage: MapStorage | null, storage: CampaignStorageKind
) => {
  if (!mapStorage || storage !== "local") return null;
  try {
    const { backend, identity } = await catalogSession();
    const server = createCampaignServerClient({
      apiUrl: backend.apiUrl, getAccessToken: identity.accessToken, renewAccessToken: identity.renew
    });
    const options = {
      baseStore: createCampaignSyncBaseStore(webStorage(), backend.apiUrl),
      local: createLocalCampaignSyncSide(repositories, mapStorage, hashMapBytes),
      remote: createServerCampaignSyncSide(server)
    };
    return () => syncCampaignRecords(options);
  } catch {
    return null;
  }
};
