/**
 * Exact shared-catalog revision a world was started from. The map bytes stay authoritative; this
 * only records which immutable published revision the copy came from, so a save or export can be
 * traced without regenerating or guessing from its seed.
 */
export interface MapProvenance {
  /** Stable catalog identity of the published map. */
  mapId: string;
  /** Immutable revision within that map identity. */
  revision: number;
  /** SHA-256 of the exact published bytes. */
  hash: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

export const validMapProvenance = (value: unknown): value is MapProvenance => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<MapProvenance>;
  return typeof entry.mapId === "string" && UUID.test(entry.mapId) &&
    Number.isSafeInteger(entry.revision) && entry.revision! > 0 &&
    typeof entry.hash === "string" && HASH.test(entry.hash);
};
