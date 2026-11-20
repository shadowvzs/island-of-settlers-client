import { describe, expect, it, vi } from "vitest";

import type { LocalAccountRow } from "../src/app/account/local-accounts";
import { REPLAY_REPORT_KEY } from "../src/app/save-store/local-save-store";
import {
  exportLocalAccounts, LOCAL_ACCOUNT_GRACE_MS, markLocalAccountExportOffered,   RECOVERY_MAX_AGE_MS, recoverySlotId,
retireLocalAccounts, runStartupRetention, sweepEndedIslands, sweepRecoveryCopies,
  sweepReplayReports
} from "../src/app/save-store/save-retention";
import { openLocalStorageGame } from "../src/app/settlement/game-local-storage";
import { GUEST_SLOT, slotValueKey } from "../src/app/settlement/game-slot-rows";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { splitGameSave } from "../src/shared/settlement/game-save-rows";
import { createMemoryStorage } from "./memory-storage";
import { completeGame } from "./save-fixtures";

const NOW = Date.UTC(2026, 9, 22);
const DAY = 86_400_000;
const game = (savedAt: number): GameSaveV1 => ({ ...completeGame(), savedAt });
const ACCOUNTS: LocalAccountRow[] = [
  { createdAt: 1, id: "ada0", race: "roman", username: "Ada", usernameKey: "ada" },
  { createdAt: 2, id: "bo00", race: "viking", username: "Bo", usernameKey: "bo" }
];

const browser = () => {
  const storage = createMemoryStorage({ "island-settlers-db.accounts": JSON.stringify(ACCOUNTS) });
  const log: string[] = [];
  return { database: openLocalStorageGame(storage), log: (message: string) => log.push(message), messages: log,
    storage };
};

describe("pending-upload recovery copies", () => {
  it("removes copies older than 7 days and keeps newer ones and every other slot", async () => {
    const { database, log, messages } = browser();
    await database.writeGame(recoverySlotId("a1", "s1"), game(NOW - RECOVERY_MAX_AGE_MS - 1));
    await database.writeGame(recoverySlotId("a1", "s2"), game(NOW - DAY));
    await database.writeGame(GUEST_SLOT, game(NOW - 30 * DAY));
    expect(await sweepRecoveryCopies(database, NOW, log)).toBe(1);
    expect(await database.hasGame(recoverySlotId("a1", "s1"))).toBe(false);
    expect(await database.hasGame(recoverySlotId("a1", "s2"))).toBe(true);
    expect(await database.hasGame(GUEST_SLOT)).toBe(true);
    expect(messages[0]).toMatch(/removed the unconfirmed upload copy cloud-recovery:a1:s1/);
  });
});

describe("ended islands", () => {
  it("deletes island rows no record refers to and never the referenced or active ones", async () => {
    const { database, log, storage } = browser();
    const rows = splitGameSave(completeGame());
    const stale = { ...rows.islands[0]!, id: "colony-9" as const };
    storage.setItem(`island-settlers-db.rows.${GUEST_SLOT}`, JSON.stringify({ ...rows, islands: [...rows.islands, stale] }));
    expect(await sweepEndedIslands(database, log)).toBe(1);
    const kept = JSON.parse(storage.getItem(`island-settlers-db.rows.${GUEST_SLOT}`)!) as typeof rows;
    expect(kept.islands.map(island => island.id).sort()).toEqual(["adventure-5", "colony-2", "home"]);
    expect(await database.readGame(GUEST_SLOT)).toEqual(completeGame());
    expect(await sweepEndedIslands(database, log)).toBe(0);
  });
});

describe("replay reports", () => {
  it("keeps the newest three", async () => {
    const { database, log } = browser();
    for (const [slot, savedAt] of [["a", 1], ["b", 5], ["c", 3], ["d", 4], ["e", 2]] as const)
      await database.writeValue(slotValueKey(slot, REPLAY_REPORT_KEY), JSON.stringify({ baseline: { savedAt } }));
    expect(await sweepReplayReports(database, log)).toBe(2);
    const left = await database.listValues(`/${REPLAY_REPORT_KEY}`);
    expect(left.map(([key]) => key[0]!).sort((a, b) => a.localeCompare(b))).toEqual(["b", "c", "d"]);
  });
});

describe("old local accounts", () => {
  it("offers the export once, then removes the accounts and their saves after 30 days", async () => {
    const { database, log, messages } = browser();
    await database.writeGame("ada0", game(1));
    const first = await retireLocalAccounts(database, NOW, log);
    expect(first).toEqual({ accounts: ACCOUNTS, kind: "offer", removeAfter: NOW + LOCAL_ACCOUNT_GRACE_MS });
    const download = vi.fn();
    expect(await exportLocalAccounts(database, ACCOUNTS, download)).toBe(1);
    expect(download).toHaveBeenCalledWith(game(1), "island-settlers-Ada.json");
    await markLocalAccountExportOffered(database);
    expect(await retireLocalAccounts(database, NOW + DAY, log)).toEqual({ kind: "waiting" });
    expect(await database.hasGame("ada0")).toBe(true);
    expect(await retireLocalAccounts(database, NOW + LOCAL_ACCOUNT_GRACE_MS, log)).toEqual({ kind: "none" });
    expect(await database.listAccounts()).toEqual([]);
    expect(await database.hasGame("ada0")).toBe(false);
    expect(messages).toEqual(["removed 2 retired local account(s) and their saves after the 30-day grace"]);
  });

  it("runs every sweep at startup and does nothing without old accounts", async () => {
    const storage = createMemoryStorage(), database = openLocalStorageGame(storage);
    await database.writeGame(GUEST_SLOT, game(NOW));
    expect(await runStartupRetention(database, NOW, () => undefined)).toEqual({ kind: "none" });
    expect(await database.readGame(GUEST_SLOT)).toEqual(game(NOW));
  });
});
