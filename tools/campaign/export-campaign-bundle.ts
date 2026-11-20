import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createCampaignServerClient } from "../../src/app/campaign-storage/campaign-server-client";
import { readMapFile } from "../../src/shared/world/save/map-reader";
import {
  buildCampaignBundle, type CampaignBundleInput, CampaignBundleRefused, readCampaignBundleInput
} from "./campaign-bundle-builder";
import { writeCampaignBundleFolder } from "./campaign-bundle-folder";

/**
 * Exports the Ready campaigns of a campaign server into `public/campaigns/` (CAMP-BUNDLE), the bundle every build
 * ships for offline players and guests:
 *
 *   npx tsx --env-file=<file> tools/campaign/export-campaign-bundle.ts
 *   npx tsx tools/campaign/export-campaign-bundle.ts --empty     (ship no campaign: the rollback state)
 *
 * The env file names the API and an administrator's access token: `CAMPAIGN_BUNDLE_API_URL`,
 * `CAMPAIGN_BUNDLE_ADMIN_TOKEN`. Every exported image needs a reviewed licence line in
 * `campaign-image-licences.json` (image id → "Own artwork, <author>, <date>" or the licence and source); an image
 * without one stops the export. Commit the changed folder with the release.
 */
const TARGET = resolve(import.meta.dirname, "../../public/campaigns");
const LICENCES = resolve(import.meta.dirname, "campaign-image-licences.json");
const EMPTY: CampaignBundleInput = { campaigns: [], images: [], licences: {}, mapFiles: new Map(), maps: [] };

const serverInput = async () => {
  const { CAMPAIGN_BUNDLE_ADMIN_TOKEN: token, CAMPAIGN_BUNDLE_API_URL: apiUrl } = process.env;
  if (!apiUrl || !token)
    throw new Error("Set CAMPAIGN_BUNDLE_API_URL and CAMPAIGN_BUNDLE_ADMIN_TOKEN (or pass --empty)");
  const server = createCampaignServerClient({ apiUrl: apiUrl.replace(/\/$/, ""), getAccessToken: async () => token });
  const licences = JSON.parse(readFileSync(LICENCES, "utf8")) as Record<string, string>;
  return readCampaignBundleInput(server, licences, readMapFile);
};

const run = async () => {
  const input = process.argv.includes("--empty") ? EMPTY : await serverInput();
  const { files, index, warnings } = buildCampaignBundle(input);
  const removed = writeCampaignBundleFolder(TARGET, files);
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  const mapCount = index.campaigns.reduce((total, entry) => total + entry.maps.length, 0);
  console.log(`Wrote ${TARGET}: ${index.campaigns.length} campaigns, ${mapCount} maps, ${index.images.length} ` +
    `images; removed ${removed.length} stale files`);
};

try {
  await run();
} catch (error) {
  if (!(error instanceof CampaignBundleRefused)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
