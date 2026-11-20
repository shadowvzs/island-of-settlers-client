import type { ServerEconomy } from "../cloud/server-economy";
import { readStartMap } from "../map-editor/map-startup";
import type { CampaignPlayerSource } from "./campaign-player-source";
import type { CampaignDepartureSources } from "./campaign-window-port";

export interface CampaignDepartureSourceOptions {
  economy?: ServerEconomy;
  /** Administrators and development sessions also see this browser's authored campaigns. */
  localAllowed: boolean;
  /** Real UTC time (ms). */
  now(): number;
}

/**
 * The page's campaign sources for the home session. The records and the published map loader load with
 * the campaign window's first open, so they stay out of the startup chunk.
 */
export const createCampaignDepartureSources = (
  { economy, localAllowed, now }: CampaignDepartureSourceOptions
): CampaignDepartureSources => {
  let opening: Promise<CampaignPlayerSource> | undefined;
  const open = async () => {
    const [
      { createCampaignPlayerSource }, { createCampaignBundleReader }, { openCampaignIndexedDbRepositories },
      { loadHashedMap }
    ] = await Promise.all([
      import("./campaign-player-source"), import("./campaign-bundle-reader"),
      import("../campaign-storage/campaign-indexeddb-store"), import("../map-editor/map-catalog")
    ]);
    return createCampaignPlayerSource({
      bundle: createCampaignBundleReader({ baseUrl: import.meta.env.BASE_URL }), economy, loadHashedMap, localAllowed,
      openLocal: openCampaignIndexedDbRepositories, readLocalMap: readStartMap
    });
  };
  const source = () => opening ??= open();
  return {
    economy,
    now,
    openRepositories: async () => (await source()).openRepositories(),
    readMap: async slotId => (await source()).readMap(slotId)
  };
};
