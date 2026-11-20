import { CAMPAIGN_BUNDLE_INDEX_FILE } from "../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import {
  type CampaignBundleIndex, campaignBundleMapPath, checkCampaignBundleShape, type PublishedCampaign
} from "../../../../island-of-settlers-shared/src/campaign/campaign-published";
import { CAMPAIGN_BUNDLE_FOLDER } from "./constants";

export interface CampaignBundleReaderOptions {
  /** The page's base URL (`import.meta.env.BASE_URL`); the bundle folder sits under it. */
  baseUrl: string;
  fetch?: typeof fetch;
}

/** The campaigns shipped with this build: readable without an account or a server. */
export interface CampaignBundleReader {
  /** The bundled campaigns in the server's published shape; null when the index is missing or invalid. */
  campaigns(): Promise<PublishedCampaign[] | null>;
  /** A bundled map file by its content hash (the caller checks the hash); null when it is missing. */
  mapFile(fileHash: string): Promise<Uint8Array | null>;
}

/**
 * Reads the campaign bundle of the build (CAMP-BUNDLE, `public/campaigns/`). The index is untrusted like any
 * download: only the published shape is accepted, and a valid index is read once per page.
 */
export const createCampaignBundleReader = (
  { baseUrl, fetch: request = fetch }: CampaignBundleReaderOptions
): CampaignBundleReader => {
  const fileUrl = (path: string) => `${baseUrl}${CAMPAIGN_BUNDLE_FOLDER}/${path}`;
  let index: CampaignBundleIndex | undefined;

  const readIndex = async () => {
    const response = await request(fileUrl(CAMPAIGN_BUNDLE_INDEX_FILE));
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (checkCampaignBundleShape(value).length > 0) return null;
    return value as CampaignBundleIndex;
  };

  return {
    campaigns: async () => {
      try {
        index ??= await readIndex() ?? undefined;
      } catch { /* no bundle in reach: the caller falls back */ }
      return index?.campaigns ?? null;
    },
    mapFile: async fileHash => {
      try {
        const response = await request(fileUrl(campaignBundleMapPath(fileHash)));
        return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
      } catch {
        return null;
      }
    }
  };
};
