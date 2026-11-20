import type { CampaignStoredRecord } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { CampaignRecordHead } from "../../../../island-of-settlers-shared/src/campaign/campaign-repository";
import { canonicalJson } from "../../../../island-of-settlers-shared/src/script/hash";
import type { CAMPAIGN_SYNC_KINDS } from "./constants";

/**
 * The pure rules of the campaign editor's server sync (CAMPAIGN-SERVER-STORAGE). Local (IndexedDB) and server
 * revisions are separate counters, so the sync remembers the pair of revisions it last saw equal (the base) and
 * tells from it which side changed since. Owner rule for a conflict: the newest revision wins, with a notice.
 */

export type CampaignSyncKind = (typeof CAMPAIGN_SYNC_KINDS)[number];

/** The revisions of one record on both sides when they last held the same content. */
export interface CampaignSyncRevisions {
  local: number;
  remote: number;
}

export type CampaignSyncBase = Record<CampaignSyncKind, Record<string, CampaignSyncRevisions>>;

export const emptyCampaignSyncBase = (): CampaignSyncBase => ({ campaigns: {}, images: {}, maps: {} });

/**
 * What to do with one record: `keep` (both sides agree), `send` / `receive` (copy to the server / to this
 * browser), `deleteLocal` / `deleteRemote` (follow the other side's deletion), `forget` (gone on both sides) or
 * `compare` (both changed, or never synced: read both documents first).
 */
export type CampaignSyncStep = "compare" | "deleteLocal" | "deleteRemote" | "forget" | "keep" | "receive" | "send";

export interface CampaignSyncDecision {
  /** Both sides changed: the losing side's change is overwritten and the editor says so. */
  conflict: boolean;
  step: CampaignSyncStep;
}

const decision = (step: CampaignSyncStep, conflict = false): CampaignSyncDecision => ({ conflict, step });

/** A record that exists on one side only: new there, or deleted on the other side since the last sync. */
const decideOneSided = (
  changed: boolean, known: boolean, copy: "receive" | "send", remove: "deleteLocal" | "deleteRemote"
) => {
  if (!known) return decision(copy);
  // Edited here, deleted there: the edit wins and the record is stored on both sides again.
  return changed ? decision(copy, true) : decision(remove);
};

export const decideRecordSync = (
  local: CampaignRecordHead | undefined, remote: CampaignRecordHead | undefined,
  base: CampaignSyncRevisions | undefined
): CampaignSyncDecision => {
  if (!local && !remote) return decision("forget");
  const localChanged = local?.revision !== base?.local, remoteChanged = remote?.revision !== base?.remote;
  if (!remote) return decideOneSided(localChanged, base !== undefined, "send", "deleteLocal");
  if (!local) return decideOneSided(remoteChanged, base !== undefined, "receive", "deleteRemote");
  if (!base || (localChanged && remoteChanged)) return decision("compare");
  if (localChanged) return decision("send");
  return decision(remoteChanged ? "receive" : "keep");
};

const sameBytes = (first: unknown, second: unknown) => {
  if (!(first instanceof Uint8Array) || !(second instanceof Uint8Array)) return first === second;
  return first.length === second.length && first.every((value, index) => value === second[index]);
};

const contentOf = (record: CampaignStoredRecord) =>
  canonicalJson({ ...record, bytes: undefined, revision: 0, updatedAt: 0 });

/** True when two stored copies hold the same document (revision, save time and key order aside). */
export const sameCampaignRecord = (first: CampaignStoredRecord, second: CampaignStoredRecord) =>
  contentOf(first) === contentOf(second) &&
  sameBytes((first as { bytes?: unknown }).bytes, (second as { bytes?: unknown }).bytes);

/** Both sides changed: equal documents need nothing; else the copy saved last wins (a tie keeps the server's). */
export const decideComparedSync = (local: CampaignStoredRecord, remote: CampaignStoredRecord): CampaignSyncDecision => {
  if (sameCampaignRecord(local, remote)) return decision("keep");
  return decision(local.updatedAt > remote.updatedAt ? "send" : "receive", true);
};

export type CampaignFileStep = "download" | "none" | "upload";

/**
 * Which side's map file is copied after the map records agree: the file the record pins (`mapFile.hash`); when
 * neither or no hash is pinned, the server's file for a record received in this sync, else this browser's.
 */
export const decideFileSync = (
  pinnedHash: string | null, localHash: string | null, remoteHash: string | null, received: boolean
): CampaignFileStep => {
  if (localHash === remoteHash) return "none";
  if (localHash === null) return "download";
  if (remoteHash === null) return "upload";
  if (pinnedHash === localHash) return "upload";
  if (pinnedHash === remoteHash) return "download";
  return received ? "download" : "upload";
};
