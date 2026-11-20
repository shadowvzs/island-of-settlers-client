import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createLocalSaveStore } from "../src/app/save-store/local-save-store";
import { openLocalStorageGame } from "../src/app/settlement/game-local-storage";
import { createMemoryStorage } from "./memory-storage";
import { completeGame } from "./save-fixtures";

const SOURCE = join(__dirname, "../src");

const sourceFiles = () => readdirSync(SOURCE, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && /\.tsx?$/.test(entry.name))
  .map(entry => join(entry.parentPath, entry.name).slice(SOURCE.length + 1));

/**
 * The local store (and its worker write path), the cloud slot's local side, retention, the browser database
 * itself and the account start own the database. Since 2026-11-12 the save-slot repository (SAVE-SLOTS), the
 * administration ports (ADMIN-UI/ADMIN-DEBUG), the settings source (GS3a) and the boot paths that only read the
 * browser backend kind (island runtime, title) own it too.
 */
const DATABASE_OWNERS = new RegExp(`^(${[
  "app/account/", "app/admin/(local-ports|maintenance/browser-maintenance-port)", "app/cloud/cloud-boot",
  "app/game-settings/settings-boot", "app/island-runtime", "app/save-slots/",
  "app/save-store/(local-save-store|captured-game|save-retention)",
  "app/settlement/game-(database|local-storage|session-worker)", "app/title/title-boot",
  "workers/game-session-worker"
].join("|")})`);

describe("LocalSaveStore", () => {
  it("round trips the complete game: islands, expeditions, evacuations, player and session", async () => {
    const store = createLocalSaveStore(openLocalStorageGame(createMemoryStorage()));
    expect(await store.readSavedGame()).toBeNull();
    await store.writeSavedGame(completeGame());
    expect((await store.readSavedGame())!).toEqual(completeGame());
  });

  it("debug clear-saves removes games/boot values and recreate removes the whole local store", async () => {
    const storage = createMemoryStorage(), database = openLocalStorageGame(storage);
    await database.writeGame("guest", completeGame());
    await database.writeValue("startup", "payload");
    await database.clearAllGames();
    expect(await database.readGame("guest")).toBeNull();
    expect(await database.readValue("startup")).toBeNull();
    await database.writeValue("startup", "payload");
    await database.recreateDatabase();
    expect(await database.readValue("startup")).toBeNull();
    expect(await database.listGameSlots()).toEqual([]);
  });

  it("keeps the startup payload and replay report per slot", async () => {
    const database = openLocalStorageGame(createMemoryStorage());
    const guest = createLocalSaveStore(database), ada = createLocalSaveStore(database, "ada");
    await guest.writeStartupGame("guest-startup");
    await ada.writeReplayReport("ada-report");
    expect(await ada.readStartupGame()).toBeNull();
    expect(await guest.readReplayReport()).toBeNull();
    expect(await ada.readReplayReport()).toBe("ada-report");
    await guest.clearStartupGame();
    expect(await guest.readStartupGame()).toBeNull();
  });
});

describe("save paths", () => {
  it("reach the browser database only through the SaveStore", () => {
    const direct = sourceFiles().filter(file => !DATABASE_OWNERS.test(file) &&
      /game-database"|openGameDatabase|openLocalStorageGame/.test(readFileSync(join(SOURCE, file), "utf8")));
    expect(direct).toEqual([]);
  });
});
