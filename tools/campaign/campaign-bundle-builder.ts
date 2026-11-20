import {
  CAMPAIGN_BUNDLE_INDEX_FILE, CAMPAIGN_BUNDLE_VERSION
} from "../../../island-of-settlers-shared/src/campaign/campaign-constants";
import type { Campaign, CampaignMap } from "../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  type BundledCampaignImage, campaignBundleImagePath, type CampaignBundleIndex, campaignBundleMapPath,
  checkCampaignBundleShape, playableCampaignsOf, type PublishedCampaign
} from "../../../island-of-settlers-shared/src/campaign/campaign-published";
import type { CampaignImage } from "../../../island-of-settlers-shared/src/campaign/campaign-records";
import { checkCampaignImageShape } from "../../../island-of-settlers-shared/src/campaign/campaign-shape";
import { sha256Hex } from "../../../island-of-settlers-shared/src/sha256";
import type { CampaignServer } from "../../src/app/campaign-storage/campaign-server-client";

/** Everything an export reads: the stored records, the stored map files and the reviewed image licences. */
export interface CampaignBundleInput {
  campaigns: readonly Campaign[];
  images: readonly CampaignImage[];
  /** Image id → the reviewed licence line (`campaign-image-licences.json`); an image without one is refused. */
  licences: Readonly<Record<string, string>>;
  /** Map record id → the stored map file's bytes. */
  mapFiles: ReadonlyMap<string, Uint8Array>;
  maps: readonly CampaignMap[];
}

export interface CampaignBundle {
  /** Every file of the bundle folder by its relative path, the index included. */
  files: Map<string, Uint8Array>;
  index: CampaignBundleIndex;
  /** Ready content the bundle leaves out (no stored file, a hash mismatch): worth a look, not a refusal. */
  warnings: string[];
}

/** The export stops: shipping would break the bundle or the licence rule. `problems` lists every reason. */
export class CampaignBundleRefused extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`The campaign bundle was not exported:\n- ${problems.join("\n- ")}`);
    this.name = "CampaignBundleRefused";
    this.problems = problems;
  }
}

const WEBP_HEADER_LENGTH = 12, WEBP_FORMAT_OFFSET = 8;
const asciiAt = (bytes: Uint8Array, offset: number, text: string) =>
  [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
/** A RIFF container holding WebP: the only image format the game ships for campaigns. */
const isWebp = (bytes: Uint8Array) =>
  bytes.length > WEBP_HEADER_LENGTH && asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, WEBP_FORMAT_OFFSET, "WEBP");

/** Why an image may not ship, or null: only processed (bounded WebP) and licence-checked images do. */
const imageProblem = (image: CampaignImage, licences: CampaignBundleInput["licences"]) => {
  if (checkCampaignImageShape(image).length > 0 || !isWebp(image.bytes))
    return `image ${image.id}: not a processed campaign image (WebP within the size limits)`;
  if (!licences[image.id]?.trim()) return `image ${image.id}: no reviewed licence line`;
  return null;
};

const bundledImage = (image: CampaignImage, licence: string): BundledCampaignImage => ({
  campaignId: image.campaignId, hash: sha256Hex(image.bytes), height: image.height, id: image.id,
  licence: licence.trim(), width: image.width
});

/** Ready campaigns and maps that are stored but not playable from the bundle. */
const leftOutWarnings = (input: CampaignBundleInput, published: readonly PublishedCampaign[]) => {
  const bundledMaps = new Set(published.flatMap(entry => entry.maps.map(({ map }) => map.id)));
  const bundledCampaigns = new Set(published.map(entry => entry.campaign.id));
  const campaigns = input.campaigns
    .filter(campaign => campaign.state === "ready" && !bundledCampaigns.has(campaign.id))
    .map(campaign => `campaign ${campaign.id}: ready, but none of its maps has a matching stored map file`);
  const maps = input.maps
    .filter(map => map.state === "ready" && bundledCampaigns.has(map.campaignId) && !bundledMaps.has(map.id))
    .map(map => `map ${map.id}: ready, but left out (no stored file, another hash, or not in the campaign's order)`);
  return [...campaigns, ...maps];
};

const indexBytes = (index: CampaignBundleIndex) => new TextEncoder().encode(`${JSON.stringify(index)}\n`);

/**
 * The campaign bundle of the stored records (CAMP-BUNDLE): ready campaigns with their playable maps in the
 * server's published shape, each map pinned to the hash of its file, plus the images of those campaigns.
 * Throws `CampaignBundleRefused` for an unprocessed or unlicensed image and for an index that fails its shape.
 */
export const buildCampaignBundle = (input: CampaignBundleInput): CampaignBundle => {
  const fileHashes = new Map([...input.mapFiles].map(([mapId, bytes]) => [mapId, sha256Hex(bytes)]));
  const campaigns = playableCampaignsOf(input.campaigns, input.maps, fileHashes);
  const bundledCampaigns = new Set(campaigns.map(entry => entry.campaign.id));
  const images = input.images.filter(image => bundledCampaigns.has(image.campaignId));
  const imageProblems = images.flatMap(image => imageProblem(image, input.licences) ?? []);
  if (imageProblems.length > 0) throw new CampaignBundleRefused(imageProblems);

  const index: CampaignBundleIndex = {
    campaigns,
    images: images.map(image => bundledImage(image, input.licences[image.id] ?? "")),
    version: CAMPAIGN_BUNDLE_VERSION
  };
  const shapeIssues = checkCampaignBundleShape(JSON.parse(JSON.stringify(index)));
  if (shapeIssues.length > 0)
    throw new CampaignBundleRefused(shapeIssues.map(issue => `index field ${issue.path} is invalid`));

  const files = new Map<string, Uint8Array>([[CAMPAIGN_BUNDLE_INDEX_FILE, indexBytes(index)]]);
  for (const { maps } of campaigns)
    for (const { fileHash, map } of maps) files.set(campaignBundleMapPath(fileHash), input.mapFiles.get(map.id)!);
  for (const image of images) files.set(campaignBundleImagePath(sha256Hex(image.bytes)), image.bytes);
  return { files, index, warnings: leftOutWarnings(input, campaigns) };
};

/** The stored bytes of the ready maps; a file that `checkMapFile` rejects is a problem, not a silent skip. */
const readMapFiles = async (
  server: CampaignServer, maps: readonly CampaignMap[], checkMapFile: (bytes: Uint8Array) => Promise<unknown>
) => {
  const mapFiles = new Map<string, Uint8Array>(), problems: string[] = [];
  for (const map of maps) {
    const bytes = await server.mapFiles.read(map.id);
    if (!bytes) continue;
    try {
      await checkMapFile(bytes);
      mapFiles.set(map.id, bytes);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      problems.push(`map ${map.id}: its stored map file cannot be read (${reason})`);
    }
  }
  return { mapFiles, problems };
};

/**
 * Reads what an export needs from the campaign server (an administrator's client): ready records, the images of
 * the ready campaigns and the map files, each checked with `checkMapFile` (the game's map reader).
 */
export const readCampaignBundleInput = async (
  server: CampaignServer, licences: CampaignBundleInput["licences"],
  checkMapFile: (bytes: Uint8Array) => Promise<unknown>
): Promise<CampaignBundleInput> => {
  const { campaigns: campaignRecords, images: imageRecords, maps: mapRecords } = server.repositories;
  const [campaigns, maps] = await Promise.all([
    campaignRecords.list({ state: "ready" }), mapRecords.list({ state: "ready" })
  ]);
  const images = (await Promise.all(campaigns.map(campaign => imageRecords.list({ campaignId: campaign.id })))).flat();
  const { mapFiles, problems } = await readMapFiles(server, maps, checkMapFile);
  if (problems.length > 0) throw new CampaignBundleRefused(problems);
  return { campaigns, images, licences, mapFiles, maps };
};
