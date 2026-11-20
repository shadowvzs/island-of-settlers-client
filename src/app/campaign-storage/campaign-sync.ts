import type {
  CampaignMap, CampaignStoredRecord
} from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type {
  CampaignRecordHead, CampaignRecordRepository, CampaignRepositories
} from "../../../../island-of-settlers-shared/src/campaign/campaign-repository";
import {
  type CampaignSyncBase, type CampaignSyncDecision, type CampaignSyncKind,
  decideComparedSync, decideFileSync, decideRecordSync
} from "./campaign-sync-plan";
import { CAMPAIGN_SYNC_KINDS } from "./constants";

/** What identifies a map's file on either side: the record id (server) and its slot (this browser). */
export type CampaignMapFileOwner = Pick<CampaignMap, "id" | "mapFile" | "name">;

/** One side of the sync: its records and the map files of its campaign maps. */
export interface CampaignSyncSide {
  deleteMapFile(map: CampaignMapFileOwner): Promise<void>;
  /** SHA-256 hex of each stored map file by map id (maps without a file are absent). */
  mapFileHashes(maps: readonly CampaignMapFileOwner[]): Promise<ReadonlyMap<string, string>>;
  readMapFile(map: CampaignMapFileOwner): Promise<Uint8Array | null>;
  repositories: Pick<CampaignRepositories, CampaignSyncKind>;
  writeMapFile(map: CampaignMapFileOwner, bytes: Uint8Array): Promise<void>;
}

/** Where the sync keeps the revisions it last saw equal (per browser and server). */
export interface CampaignSyncBaseStore {
  read(): CampaignSyncBase;
  write(base: CampaignSyncBase): void;
}

/** A record both sides changed: which copy was kept. */
export interface CampaignSyncConflict {
  id: string;
  kept: "local" | "server";
  kind: CampaignSyncKind;
  /** The kept record's English name, or its id when it has none. */
  name: string;
}

export interface CampaignSyncReport {
  conflicts: CampaignSyncConflict[];
  /** Records and map files copied to this browser. */
  received: number;
  /** Records deleted on one side because the other side deleted them. */
  removed: number;
  /** Records and map files copied to the server. */
  sent: number;
}

export interface CampaignSyncOptions {
  baseStore: CampaignSyncBaseStore;
  local: CampaignSyncSide;
  remote: CampaignSyncSide;
}

type AnyRepository = CampaignRecordRepository<CampaignStoredRecord>;

/** One record's state during a sync: its heads, and the documents once they were read. */
interface RecordSync {
  id: string;
  kind: CampaignSyncKind;
  local: AnyRepository;
  localHead: CampaignRecordHead | undefined;
  remote: AnyRepository;
  remoteHead: CampaignRecordHead | undefined;
}

interface SyncRun {
  base: CampaignSyncBase;
  options: CampaignSyncOptions;
  receivedMapIds: Set<string>;
  report: CampaignSyncReport;
}

const nameOf = (record: CampaignStoredRecord) => {
  const name = (record as { name?: { en?: string } }).name?.en;
  return name || record.id;
};

/** Stores `record` on the side whose current head is `targetHead` (absent: creates it); answers the stored copy. */
const copyRecord = (target: AnyRepository, targetHead: CampaignRecordHead | undefined, record: CampaignStoredRecord) =>
  targetHead ? target.update({ ...record, revision: targetHead.revision }) : target.create(record);

/** `compare` reads both documents and becomes `keep`, `send` or `receive`. */
const settledDecision = async (record: RecordSync, first: CampaignSyncDecision): Promise<CampaignSyncDecision> => {
  if (first.step !== "compare") return first;
  const [local, remote] = await Promise.all([record.local.get(record.id), record.remote.get(record.id)]);
  if (!local || !remote) return decideRecordSync(local ?? undefined, remote ?? undefined, undefined);
  return decideComparedSync(local, remote);
};

const noteConflict = (run: SyncRun, record: RecordSync, kept: "local" | "server", stored: CampaignStoredRecord) =>
  run.report.conflicts.push({ id: record.id, kept, kind: record.kind, name: nameOf(stored) });

const sendRecord = async (run: SyncRun, record: RecordSync, conflict: boolean) => {
  const document = await record.local.get(record.id);
  if (!document) return;
  const stored = await copyRecord(record.remote, record.remoteHead, document);
  run.base[record.kind][record.id] = { local: document.revision, remote: stored.revision };
  run.report.sent++;
  if (conflict) noteConflict(run, record, "local", stored);
};

const receiveRecord = async (run: SyncRun, record: RecordSync, conflict: boolean) => {
  const document = await record.remote.get(record.id);
  if (!document) return;
  const stored = await copyRecord(record.local, record.localHead, document);
  run.base[record.kind][record.id] = { local: stored.revision, remote: document.revision };
  run.report.received++;
  if (record.kind === "maps") run.receivedMapIds.add(record.id);
  if (conflict) noteConflict(run, record, "server", stored);
};

/** Follows the server's deletion; a map's file in this browser goes with its record. */
const deleteLocalRecord = async (run: SyncRun, record: RecordSync) => {
  const document = await record.local.get(record.id);
  if (!document) return;
  await record.local.delete(record.id, document.revision);
  if (record.kind === "maps") await run.options.local.deleteMapFile(document as CampaignMap);
  run.report.removed++;
};

/** Follows this browser's deletion (the server removes a map's file with its record). */
const deleteRemoteRecord = async (run: SyncRun, record: RecordSync) => {
  if (!record.remoteHead) return;
  await record.remote.delete(record.id, record.remoteHead.revision);
  run.report.removed++;
};

const syncRecord = async (run: SyncRun, record: RecordSync) => {
  const bases = run.base[record.kind];
  const { conflict, step } = await settledDecision(record,
    decideRecordSync(record.localHead, record.remoteHead, bases[record.id]));
  if (step === "send") return sendRecord(run, record, conflict);
  if (step === "receive") return receiveRecord(run, record, conflict);
  delete bases[record.id];
  if (step === "deleteLocal") return deleteLocalRecord(run, record);
  if (step === "deleteRemote") return deleteRemoteRecord(run, record);
  if (step === "keep" && record.localHead && record.remoteHead)
    bases[record.id] = { local: record.localHead.revision, remote: record.remoteHead.revision };
};

const syncKind = async (run: SyncRun, kind: CampaignSyncKind) => {
  const local = run.options.local.repositories[kind] as AnyRepository;
  const remote = run.options.remote.repositories[kind] as AnyRepository;
  const [localHeads, remoteHeads] = await Promise.all([local.heads(), remote.heads()]);
  const localById = new Map(localHeads.map(head => [head.id, head]));
  const remoteById = new Map(remoteHeads.map(head => [head.id, head]));
  const ids = new Set([...localById.keys(), ...remoteById.keys(), ...Object.keys(run.base[kind])]);
  for (const id of ids)
    await syncRecord(run, { id, kind, local, localHead: localById.get(id), remote, remoteHead: remoteById.get(id) });
};

/** After the map records agree: copies each map's file to the side that lacks it or holds another one. */
const syncMapFiles = async (run: SyncRun) => {
  const { local, remote } = run.options;
  const maps = await local.repositories.maps.list();
  const [localHashes, remoteHashes] = await Promise.all([local.mapFileHashes(maps), remote.mapFileHashes(maps)]);
  for (const map of maps) {
    const step = decideFileSync(map.mapFile.hash, localHashes.get(map.id) ?? null, remoteHashes.get(map.id) ?? null,
      run.receivedMapIds.has(map.id));
    if (step === "none") continue;
    const [from, to] = step === "upload" ? [local, remote] : [remote, local];
    const bytes = await from.readMapFile(map);
    if (!bytes) continue;
    await to.writeMapFile(map, bytes);
    run.report[step === "upload" ? "sent" : "received"]++;
  }
};

/**
 * Brings this browser's campaign records and map files and the server's to the same state: new and changed
 * records are copied to the other side, deletions are followed, and a record changed on both sides keeps its
 * newest copy (reported as a conflict). The base is stored even when a step fails, so finished records stay done.
 */
export const syncCampaignRecords = async (options: CampaignSyncOptions): Promise<CampaignSyncReport> => {
  const run: SyncRun = {
    base: structuredClone(options.baseStore.read()), options, receivedMapIds: new Set(),
    report: { conflicts: [], received: 0, removed: 0, sent: 0 }
  };
  try {
    for (const kind of CAMPAIGN_SYNC_KINDS) await syncKind(run, kind);
    await syncMapFiles(run);
  } finally {
    options.baseStore.write(run.base);
  }
  return run.report;
};
