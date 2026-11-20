import type { CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { openCampaignIndexedDbRepositories } from "../campaign-storage/campaign-indexeddb-store";

/** The campaign map records of this browser (the campaign editor's store, synced with the server); none if blocked. */
export const readCampaignMapRecords = async (): Promise<CampaignMap[]> => {
  const repositories = await openCampaignIndexedDbRepositories();
  return repositories ? repositories.maps.list() : [];
};
