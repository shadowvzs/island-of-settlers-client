import { CAMPAIGN_IMAGE_MIME_TYPE } from "../../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import type { Campaign, CampaignMap } from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { CampaignImage } from "../../../../../island-of-settlers-shared/src/campaign/campaign-records";
import type { CampaignRepositories } from "../../../../../island-of-settlers-shared/src/campaign/campaign-repository";
import type { CampaignImageView } from "./campaign-editor-state";
import { referencedImageIds } from "./helpers";
import type { ProcessedImage } from "./image-processing";

/** The editor's access to campaign map files (`island-maps` slots `campaign/...`). */
export interface CampaignMapFiles {
  delete: (slotId: string) => Promise<void>;
  read: (slotId: string) => Promise<Uint8Array | null>;
}

/** Object URLs of stored image bytes (injected: tests run without a DOM). */
export interface ImageUrls {
  create: (bytes: Uint8Array, mimeType: string) => string;
  revoke: (url: string) => void;
}

/** A campaign with every map it owns (listed or not) and its stored images. */
export interface LoadedCampaign {
  campaign: Campaign;
  images: CampaignImage[];
  maps: CampaignMap[];
}

export const loadCampaign = async (repositories: CampaignRepositories, id: string): Promise<LoadedCampaign | null> => {
  const campaign = await repositories.campaigns.get(id);
  if (!campaign) return null;
  const [maps, images] = await Promise.all([
    repositories.maps.list({ campaignId: id }),
    repositories.images.list({ campaignId: id })
  ]);
  return { campaign, images, maps };
};

export const imageViews = (images: readonly CampaignImage[], urls: ImageUrls) =>
  Object.fromEntries(images.map(image => [image.id, {
    height: image.height, url: urls.create(image.bytes, image.mimeType), width: image.width
  } satisfies CampaignImageView]));

export const revokeImageViews = (views: Readonly<Record<string, CampaignImageView>>, urls: ImageUrls) => {
  for (const view of Object.values(views)) urls.revoke(view.url);
};

/** A new image record of the campaign from processed WebP bytes. */
export const createImageRecord = (id: string, campaignId: string, image: ProcessedImage): CampaignImage => ({
  bytes: image.bytes, campaignId, height: image.height, id, mimeType: CAMPAIGN_IMAGE_MIME_TYPE, revision: 0,
  updatedAt: 0, width: image.width
});

/** Removes the campaign's images nothing references any more (abandoned or replaced uploads). */
export const deleteUnusedImages = async (
  repositories: CampaignRepositories, campaign: Campaign, maps: readonly CampaignMap[]
) => {
  const used = referencedImageIds(campaign, maps);
  const stored = await repositories.images.list({ campaignId: campaign.id });
  const unused = stored.filter(image => !used.has(image.id));
  await Promise.all(unused.map(image => repositories.images.delete(image.id, image.revision)));
  return new Set(unused.map(image => image.id));
};

/** Deletes a campaign with every map record, map file and image it owns. */
export const deleteCampaignCascade = async (
  repositories: CampaignRepositories, mapFiles: CampaignMapFiles | null, loaded: LoadedCampaign
) => {
  for (const map of loaded.maps) {
    await repositories.maps.delete(map.id, map.revision);
    await mapFiles?.delete(map.mapFile.id);
  }
  await Promise.all(loaded.images.map(image => repositories.images.delete(image.id, image.revision)));
  await repositories.campaigns.delete(loaded.campaign.id, loaded.campaign.revision);
};
