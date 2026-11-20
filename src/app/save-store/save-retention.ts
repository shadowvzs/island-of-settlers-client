import { DAY_MS } from "../../../../island-of-settlers-shared/src/time/constants";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { LocalAccountRow } from "../account/local-accounts";
import type { GameDatabase } from "../settlement/game-database";
import { GUEST_SLOT } from "../settlement/game-slot-rows";
import { REPLAY_REPORT_KEY } from "./local-save-store";

/**
 * Browser-side retention (owner 2026-10-22), run at startup before any island loads, never during play. It
 * never removes the active save: island rows still referenced by their game stay, and only recovery copies,
 * stale island rows, extra replay reports and retired local accounts go. Every removal is logged.
 */
/** Slot ids of pending-upload copies of cloud saves start with this (one per account and cloud slot). */
const RECOVERY_SLOT_PREFIX = "cloud-recovery:";
export const RECOVERY_MAX_AGE_MS = 7 * DAY_MS;
const REPLAY_REPORTS_KEPT = 3;
/** Old local accounts stay this long after their retirement was first noticed (export offered once). */
export const LOCAL_ACCOUNT_GRACE_MS = 30 * DAY_MS;
const RETIRED_AT_KEY = "local-accounts-retired-at";
const EXPORT_OFFERED_KEY = "local-accounts-export-offered";

type RetentionDatabase = Pick<GameDatabase, "clearGame" | "listAccounts" | "listGameSlots" | "listValues" |
  "pruneIslands" | "readGame" | "readValue" | "removeAccounts" | "removeValue" | "writeValue">;
export type RetentionLog = (message: string) => void;

/** The recovery slot of one account's cloud slot. */
export const recoverySlotId = (accountId: string, cloudSlotId: string) =>
  `${RECOVERY_SLOT_PREFIX}${accountId}:${cloudSlotId}`;

/** Recovery copies the server never confirmed, older than 7 days, are removed. */
export const sweepRecoveryCopies = async (database: RetentionDatabase, now: number, log: RetentionLog) => {
  const stale = (await database.listGameSlots()).filter(slot =>
    slot.slotId.startsWith(RECOVERY_SLOT_PREFIX) && now - slot.savedAt > RECOVERY_MAX_AGE_MS);
  for (const slot of stale) {
    await database.clearGame(slot.slotId);
    log(`removed the unconfirmed upload copy ${slot.slotId} from ${new Date(slot.savedAt).toISOString()}`);
  }
  return stale.length;
};

/** Island rows of expired colonies and finished adventures that outlived their record. */
export const sweepEndedIslands = async (database: RetentionDatabase, log: RetentionLog) => {
  let removed = 0;
  for (const { slotId } of await database.listGameSlots()) {
    const count = await database.pruneIslands(slotId);
    if (count) log(`removed ${count} ended island(s) from slot ${slotId}`);
    removed += count;
  }
  return removed;
};

const reportTime = (text: string) => {
  try {
    return (JSON.parse(text) as { baseline?: Partial<GameSaveV1> }).baseline?.savedAt ?? 0;
  } catch {
    return 0;
  }
};

/** Bug-replay reports: the newest three are kept. */
export const sweepReplayReports = async (database: RetentionDatabase, log: RetentionLog) => {
  const reports = (await database.listValues(`/${REPLAY_REPORT_KEY}`))
    .map(([key, value]) => ({ key, time: reportTime(value) }))
    .sort((a, b) => b.time - a.time);
  const removed = reports.slice(REPLAY_REPORTS_KEPT);
  for (const report of removed) {
    await database.removeValue(report.key);
    log(`removed the replay report ${report.key}`);
  }
  return removed.length;
};

/** What to do with the old local accounts of this browser. */
export type LocalAccountsPlan =
  | { kind: "none" }
  /** Offer the one-time export; the saves go at `removeAfter`. */
  | { accounts: LocalAccountRow[]; kind: "offer"; removeAfter: number }
  | { kind: "waiting" };

/**
 * Old local accounts (no longer shown to guests): the first startup that finds them starts a 30-day grace and
 * offers one export; after the grace the accounts and their saves are removed.
 */
export const retireLocalAccounts = async (
  database: RetentionDatabase, now: number, log: RetentionLog
): Promise<LocalAccountsPlan> => {
  const accounts = (await database.listAccounts()).filter(account => account.id !== GUEST_SLOT);
  if (!accounts.length) return { kind: "none" };
  let retiredAt = Number(await database.readValue(RETIRED_AT_KEY));
  if (!retiredAt) {
    retiredAt = now;
    await database.writeValue(RETIRED_AT_KEY, String(now));
  }
  if (now - retiredAt >= LOCAL_ACCOUNT_GRACE_MS) {
    await database.removeAccounts(accounts.map(account => account.id));
    log(`removed ${accounts.length} retired local account(s) and their saves after the 30-day grace`);
    return { kind: "none" };
  }
  if (await database.readValue(EXPORT_OFFERED_KEY)) return { kind: "waiting" };
  return { accounts, kind: "offer", removeAfter: retiredAt + LOCAL_ACCOUNT_GRACE_MS };
};

/** The export was offered (answered either way): it is never offered again. */
export const markLocalAccountExportOffered = (database: Pick<RetentionDatabase, "writeValue">) =>
  database.writeValue(EXPORT_OFFERED_KEY, "1");

/** Each old account's game as a game file (Import game loads it as a guest); the number exported. */
export const exportLocalAccounts = async (
  database: Pick<RetentionDatabase, "readGame">, accounts: readonly LocalAccountRow[],
  download: (save: GameSaveV1, fileName: string) => void
) => {
  let exported = 0;
  for (const account of accounts) {
    const save = await database.readGame(account.id);
    if (!save) continue;
    download(save, `island-settlers-${account.username}.json`);
    exported++;
  }
  return exported;
};

/** Every startup sweep; resolves with the local accounts plan (the caller may offer the export). */
export const runStartupRetention = async (database: RetentionDatabase, now: number, log: RetentionLog) => {
  await sweepRecoveryCopies(database, now, log);
  await sweepEndedIslands(database, log);
  await sweepReplayReports(database, log);
  return retireLocalAccounts(database, now, log);
};
