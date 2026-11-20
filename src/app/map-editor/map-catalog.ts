import type { MapMeta } from "../../shared/world/save/map-format";
import type { MapProvenance } from "../../shared/world/save/map-provenance";
import type { LoadedMap } from "../../shared/world/save/map-reader";
import { readMapFile } from "../../shared/world/save/map-reader";
import { createIdentityClient } from "../account/identity-client";
import { detectBackend } from "../backend/backend-status";
import { bytesToBase64 } from "../base64";
import type { StartMap } from "./map-startup";
import { openMapStorage, PUBLISHED_MAP_PREFIX } from "./map-storage";

export interface PublishedStarter {
  bytesUrl: string;
  hash: string;
  mapId: string;
  metadata: MapMeta;
  revision: number;
  size: number;
}

/** One immutable revision in the starter's rollback history. */
export interface MapRevisionSummary {
  createdAt?: string;
  hash: string;
  mapId: string;
  metadata: MapMeta;
  revision: number;
  size: number;
}

export interface StarterCatalog {
  current: PublishedStarter | null;
  revisions: MapRevisionSummary[];
}

export const mapProvenanceOf = (entry: Pick<MapRevisionSummary, "hash" | "mapId" | "revision">): MapProvenance => ({
  hash: entry.hash, mapId: entry.mapId, revision: entry.revision
});

/** SHA-256 hex of map file bytes (published starters and campaign map files). */
export const hashMapBytes = async (bytes: Uint8Array) => {
  const copy = bytes.slice();
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
};

const isRevision = (value: unknown): value is MapRevisionSummary => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<MapRevisionSummary>;
  return typeof entry.hash === "string" && /^[0-9a-f]{64}$/.test(entry.hash) &&
    typeof entry.mapId === "string" && Number.isSafeInteger(entry.revision) && entry.revision! > 0 &&
    typeof entry.size === "number" && Boolean(entry.metadata) && typeof entry.metadata?.name === "string";
};

const isStarter = (value: unknown): value is PublishedStarter => {
  if (!isRevision(value)) return false;
  return typeof (value as Partial<PublishedStarter>).bytesUrl === "string";
};

const isCatalog = (value: unknown): value is StarterCatalog => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<StarterCatalog>;
  return (entry.current === null || isStarter(entry.current)) && Array.isArray(entry.revisions) &&
    entry.revisions.every(isRevision);
};

/** A current administrator token and the backend, or a clear error for the editor hint line. */
export const catalogSession = async () => {
  const backend = await detectBackend();
  if (!backend) throw new Error("The shared map catalog needs the online account service");
  const identity = createIdentityClient({ identityUrl: backend.identityUrl });
  const account = await identity.resume();
  if (!account || account.role !== "admin") throw new Error("Administrator access required");
  return { backend, identity, token: await identity.accessToken() };
};

const catalogFetch = async (path: string, init: RequestInit, errorText: string) => {
  const session = await catalogSession();
  const response = await fetch(`${session.backend.apiUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...init.headers, Authorization: `Bearer ${session.token}` }
  });
  if (response.status === 401) throw new Error("Administrator access required");
  if (response.status === 409) throw new Error("The shared starter changed meanwhile. Reload its history and try again.");
  if (!response.ok) throw new Error(errorText);
  return await response.json() as unknown;
};

const fetchStarterMetadata = async (apiUrl: string) => {
  const response = await fetch(`${apiUrl}/v1/maps/starter`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The shared starter map is unavailable");
  const value: unknown = await response.json();
  if (!isStarter(value)) throw new Error("The shared starter map response is invalid");
  return value;
};

/**
 * A published map named by its immutable content hash: this browser's verified copy, else the fetched bytes,
 * checked against the hash and kept. The cache key alone is not proof: only the exact bytes the hash names are
 * valid. `damaged` is the error of fetched bytes with another hash.
 */
export const loadHashedMap = async (
  hash: string, fetchBytes: () => Promise<Uint8Array>, damaged: string
): Promise<LoadedMap> => {
  const storage = await openMapStorage(), slotId = `${PUBLISHED_MAP_PREFIX}${hash}`;
  const cached = await storage?.read(slotId);
  if (cached) {
    try {
      if (await hashMapBytes(cached) === hash) return await readMapFile(cached);
    } catch { /* refetch the authoritative bytes below */ }
    await storage?.delete(slotId).catch(() => undefined);
  }
  const bytes = await fetchBytes();
  if (await hashMapBytes(bytes) !== hash) throw new Error(damaged);
  const loaded = await readMapFile(bytes);
  await storage?.write({ id: slotId, name: loaded.meta.name, savedAt: loaded.meta.savedAt, size: bytes.length },
    bytes);
  return loaded;
};

const fetchStarterBytes = async (apiUrl: string, starter: PublishedStarter) => {
  const response = await fetch(new URL(starter.bytesUrl.replace(/^\//, ""), `${apiUrl}/`), { cache: "no-store" });
  if (!response.ok) throw new Error("The shared starter map bytes are unavailable");
  return new Uint8Array(await response.arrayBuffer());
};

/** The current published starter's encoded map; validates its content hash before using it. */
export const loadPublishedStarterMap = async (): Promise<StartMap | null> => {
  const backend = await detectBackend();
  if (!backend) return null;
  try {
    const starter = await fetchStarterMetadata(backend.apiUrl);
    if (!starter) return null;
    const loaded = await loadHashedMap(starter.hash, () => fetchStarterBytes(backend.apiUrl, starter),
      "The shared starter map is damaged");
    return { error: "", loaded, provenance: mapProvenanceOf(starter) } satisfies StartMap;
  } catch (error) {
    console.warn("[map catalog] starter map unavailable; using a generated island", error);
    return null;
  }
};

/** History of immutable starter revisions; administrator-only, like publishing and rollback. */
export const fetchStarterHistory = async (): Promise<StarterCatalog | null> => {
  const backend = await detectBackend();
  if (!backend) return null;
  const value = await catalogFetch("/v1/maps/starter/history", { method: "GET" },
    "The shared map history is unavailable");
  if (!isCatalog(value)) throw new Error("The shared map history response is invalid");
  return value;
};

/** Publishes the current editor world as the shared starter (the API enforces the admin role). */
export const publishStarterMap = async (
  bytes: Uint8Array, expectedHash: string | null, mapId?: string
) => {
  const loaded = await readMapFile(bytes);
  const value = await catalogFetch("/v1/maps/starter", {
    body: JSON.stringify({ bytes: bytesToBase64(bytes), expectedHash, ...(mapId ? { mapId } : {}),
      metadata: loaded.meta }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  }, "The starter map could not be published");
  if (!isRevision(value)) throw new Error("The published map response is invalid");
  return value;
};

/** Restores the starter pointer to a prior immutable revision without rewriting it. */
export const rollbackStarterMap = async (
  mapId: string, revision: number, expectedHash: string | null
) => {
  const value = await catalogFetch("/v1/maps/starter/rollback", {
    body: JSON.stringify({ expectedHash, mapId, revision }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  }, "The starter map could not be rolled back");
  if (!isRevision(value)) throw new Error("The rolled-back map response is invalid");
  return value;
};
