import type { Campaign, CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type {
  PublishedCampaign, PublishedCampaignMap
} from "../../../../island-of-settlers-shared/src/campaign/campaign-published";
import type { CampaignRecordQuery } from "../../../../island-of-settlers-shared/src/campaign/campaign-repository";
import type { LoadedMap } from "../../shared/world/save/map-reader";
import type { ServerEconomy } from "../cloud/server-economy";
import type { StartMap } from "../map-editor/map-startup";
import type { CampaignBundleReader } from "./campaign-bundle-reader";
import { CAMPAIGN_MAP_FILE_DAMAGED, CAMPAIGN_MAP_FILE_MISSING } from "./constants";

/** The campaign records the window lists: ready campaigns and the maps of one campaign. */
export interface CampaignRecordSource {
  campaigns: { list(query?: CampaignRecordQuery): Promise<Campaign[]> };
  maps: { list(query?: CampaignRecordQuery): Promise<CampaignMap[]> };
}

export interface CampaignPlayerSourceOptions {
  /** The campaigns shipped with the build, for sessions the server gives no list; absent in tests without one. */
  bundle?: CampaignBundleReader;
  /** The signed-in player's server calls; absent for guests. */
  economy?: Pick<ServerEconomy, "campaignMapFile" | "publishedCampaigns">;
  /** A published map by its content hash: the verified cached copy, else `fetchBytes` checked and kept. */
  loadHashedMap(hash: string, fetchBytes: () => Promise<Uint8Array>, damaged: string): Promise<LoadedMap>;
  /** This browser's authored records are offered too (administrators and development sessions). */
  localAllowed: boolean;
  /** This browser's campaign records (the editor's); null where the browser gives no storage. */
  openLocal(): Promise<CampaignRecordSource | null>;
  /** Reads a map file slot of this browser (the editor's campaign map slots). */
  readLocalMap(slotId: string): Promise<StartMap>;
}

/** A published map's file (the server's or the bundle's), remembered by the slot id its record names. */
interface PublishedFile {
  fetchBytes(): Promise<Uint8Array | null | undefined>;
  fileHash: string;
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Published records first; local ones only for campaigns the server or the bundle does not publish. */
const mergedRecords = (
  published: readonly PublishedCampaign[], local: CampaignRecordSource | null
): CampaignRecordSource => {
  const byId = new Map(published.map(entry => [entry.campaign.id, entry]));
  return {
    campaigns: {
      list: async query => {
        const localOnly = (await local?.campaigns.list(query) ?? []).filter(campaign => !byId.has(campaign.id));
        return [...published.map(entry => entry.campaign), ...localOnly];
      }
    },
    maps: {
      list: async query => {
        const entry = query?.campaignId === undefined ? undefined : byId.get(query.campaignId);
        if (entry) return entry.maps.map(({ map }) => map);
        return await local?.maps.list(query) ?? [];
      }
    }
  };
};

/**
 * Where the campaign window's records and map files come from (CAMPAIGN-SERVER-STORAGE, CAMP-BUNDLE): the
 * server's published campaigns for a signed-in player, with the map file downloaded, checked against its hash and
 * cached. Guests and offline sessions read the campaigns bundled with the build the same way, plus this browser's
 * records for campaigns the bundle does not hold; administrators also keep their local campaigns the server does
 * not publish (a published campaign always comes from the server or the bundle).
 */
export const createCampaignPlayerSource = (options: CampaignPlayerSourceOptions) => {
  const publishedFiles = new Map<string, PublishedFile>();

  /** The server's campaigns; null for guests and while the server has no answer. */
  const readPublished = async () => {
    try {
      return await options.economy?.publishedCampaigns?.() ?? null;
    } catch {
      return null;
    }
  };

  /** The build's campaigns; null without a bundle or while it lists none. */
  const readBundled = async () => {
    const bundled = await options.bundle?.campaigns() ?? null;
    return bundled?.length ? bundled : null;
  };

  const rememberFiles = (
    published: readonly PublishedCampaign[], fetchBytes: (entry: PublishedCampaignMap) => PublishedFile["fetchBytes"]
  ) => {
    publishedFiles.clear();
    for (const { maps } of published)
      for (const entry of maps)
        publishedFiles.set(entry.map.mapFile.id, { fetchBytes: fetchBytes(entry), fileHash: entry.fileHash });
  };
  const serverFile = ({ map }: PublishedCampaignMap) => async () => options.economy?.campaignMapFile?.(map.id);
  const bundleFile = ({ fileHash }: PublishedCampaignMap) => async () => options.bundle?.mapFile(fileHash);

  const fetchPublishedFile = async (file: PublishedFile) => {
    const bytes = await file.fetchBytes();
    if (!bytes) throw new Error(CAMPAIGN_MAP_FILE_MISSING);
    return bytes;
  };

  const openBundled = async () => {
    const bundled = await readBundled();
    if (!bundled) { publishedFiles.clear(); return options.openLocal(); }
    rememberFiles(bundled, bundleFile);
    return mergedRecords(bundled, await options.openLocal());
  };

  return {
    openRepositories: async (): Promise<CampaignRecordSource | null> => {
      const published = await readPublished();
      if (!published) return openBundled();
      rememberFiles(published, serverFile);
      return mergedRecords(published, options.localAllowed ? await options.openLocal() : null);
    },
    /** The map file of a listed map: the published file for a published map, else this browser's slot. Never throws. */
    readMap: async (slotId: string): Promise<StartMap> => {
      const file = publishedFiles.get(slotId);
      if (!file) return options.readLocalMap(slotId);
      try {
        const loaded = await options.loadHashedMap(file.fileHash, () => fetchPublishedFile(file),
          CAMPAIGN_MAP_FILE_DAMAGED);
        return { error: "", loaded, provenance: loaded.meta.provenance };
      } catch (error) {
        return { error: errorText(error), loaded: null };
      }
    }
  };
};

export type CampaignPlayerSource = ReturnType<typeof createCampaignPlayerSource>;
