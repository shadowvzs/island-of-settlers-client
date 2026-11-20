import type { CampaignStoredRecord } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { CampaignMapFileMeta } from "../../../../island-of-settlers-shared/src/campaign/campaign-records";
import {
  assertCampaignRecord, CAMPAIGN_RECORD_KINDS, CampaignRecordConflict, type CampaignRecordHead,
  type CampaignRecordKind, CampaignRecordNotFound, type CampaignRecordQuery, type CampaignRecordRepository,
  type CampaignRepositories
} from "../../../../island-of-settlers-shared/src/campaign/campaign-repository";
import { base64ToBytes, bytesToBase64 } from "../base64";
import {
  createApiTransport, readApiBytes, readApiError, type SaveApiOptions
} from "../save-store/save-api-client";
import { CAMPAIGN_ADMIN_PATH, CAMPAIGN_MAP_FILES_PATH, HTTP_CONFLICT, HTTP_NOT_FOUND } from "./constants";

type ApiTransport = ReturnType<typeof createApiTransport>;
type RouteKind = keyof typeof CAMPAIGN_RECORD_KINDS;

/** The server's stored map files of campaign maps, by map record id (administrators). */
export interface CampaignServerMapFiles {
  delete(mapId: string): Promise<void>;
  list(campaignId?: string): Promise<CampaignMapFileMeta[]>;
  read(mapId: string): Promise<Uint8Array | null>;
  write(mapId: string, bytes: Uint8Array): Promise<CampaignMapFileMeta>;
}

/** The server side of campaign authoring: the C1 repository contract over HTTP plus the map files. */
export interface CampaignServer {
  mapFiles: CampaignServerMapFiles;
  repositories: CampaignRepositories;
}

/** JSON carries image bytes as base64 (the route's encoding); other records travel as they are. */
const toWire = (record: CampaignStoredRecord) => {
  if (!("bytes" in record) || !(record.bytes instanceof Uint8Array)) return record;
  return { ...record, bytes: bytesToBase64(record.bytes) };
};

const fromWire = <T extends CampaignStoredRecord>(body: unknown) => {
  const record = body as Record<string, unknown>;
  if (typeof record.bytes !== "string") return record as unknown as T;
  return { ...record, bytes: base64ToBytes(record.bytes) } as unknown as T;
};

const queryString = (fields: Record<string, string | undefined>) => {
  const given = Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (!given.length) return "";
  return `?${given.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("&")}`;
};

/** The response when it succeeded; a missing record is null; anything else is the API's error. */
const foundOrNull = async (response: Response) => {
  if (response.status === HTTP_NOT_FOUND) return null;
  if (!response.ok) throw await readApiError(response);
  return response;
};

/**
 * One record kind over `/v1/campaign-admin/:kind`: 409 and 404 become the repository's typed errors, and a record
 * that fails its shape check is refused before it is sent (the server checks again).
 */
const createRemoteRepository = <T extends CampaignStoredRecord>(
  transport: ApiTransport, route: RouteKind, kind: CampaignRecordKind<T>
): CampaignRecordRepository<T> => {
  const path = (id?: string) => `${CAMPAIGN_ADMIN_PATH}/${route}${id === undefined ? "" : `/${encodeURIComponent(id)}`}`;
  const settled = async (response: Response, id: string) => {
    if (response.status === HTTP_CONFLICT) throw new CampaignRecordConflict(kind.name, id);
    if (response.status === HTTP_NOT_FOUND) throw new CampaignRecordNotFound(kind.name, id);
    if (!response.ok) throw await readApiError(response);
    return response;
  };
  const stored = async (response: Response, id: string) => fromWire<T>(await (await settled(response, id)).json());
  const checked = (record: T, revision: number) => {
    assertCampaignRecord(kind, { ...record, revision, updatedAt: Date.now() });
    return toWire(record);
  };
  return {
    create: async record => stored(await transport.send("POST", path(), { body: checked(record, 1) }), record.id),
    delete: async (id, expectedRevision) => {
      await settled(await transport.send("DELETE", `${path(id)}?revision=${expectedRevision}`), id);
    },
    get: async id => {
      const response = await foundOrNull(await transport.send("GET", path(id)));
      return response ? fromWire<T>(await response.json()) : null;
    },
    heads: async () => (await transport.read<{ heads: CampaignRecordHead[] }>(`${path()}?view=heads`)).heads,
    list: async (query: CampaignRecordQuery = {}) => {
      const { campaignId, state } = query;
      const { records } = await transport.read<{ records: unknown[] }>(
        `${path()}${queryString({ campaignId, state })}`);
      return records.map(record => fromWire<T>(record));
    },
    update: async record => stored(
      await transport.send("PUT", path(record.id), { body: checked(record, record.revision + 1) }), record.id)
  };
};

const createServerMapFiles = (transport: ApiTransport): CampaignServerMapFiles => {
  const path = (mapId: string) => `${CAMPAIGN_MAP_FILES_PATH}/${encodeURIComponent(mapId)}`;
  return {
    delete: async mapId => { await foundOrNull(await transport.send("DELETE", path(mapId))); },
    list: async campaignId =>
      (await transport.read<{ files: CampaignMapFileMeta[] }>(`${CAMPAIGN_MAP_FILES_PATH}${queryString({ campaignId })}`)).files,
    read: async mapId => readApiBytes(await transport.send("GET", path(mapId))),
    write: async (mapId, bytes) => {
      const response = await transport.send("PUT", path(mapId), { body: { bytes: bytesToBase64(bytes) } });
      if (!response.ok) throw await readApiError(response);
      return await response.json() as CampaignMapFileMeta;
    }
  };
};

/** The administrator's campaign authoring client (the campaign editor's server sync). */
export const createCampaignServerClient = (options: SaveApiOptions): CampaignServer => {
  const transport = createApiTransport(options);
  return {
    mapFiles: createServerMapFiles(transport),
    repositories: {
      campaigns: createRemoteRepository(transport, "campaigns", CAMPAIGN_RECORD_KINDS.campaigns),
      images: createRemoteRepository(transport, "images", CAMPAIGN_RECORD_KINDS.images),
      maps: createRemoteRepository(transport, "maps", CAMPAIGN_RECORD_KINDS.maps),
      statistics: createRemoteRepository(transport, "statistics", CAMPAIGN_RECORD_KINDS.statistics)
    }
  };
};
