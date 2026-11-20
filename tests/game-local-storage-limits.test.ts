import { describe, expect, it } from "vitest";

import {
  LOCAL_FALLBACK_MAX_CHARS,
  LOCAL_FALLBACK_TOO_LARGE,
  openLocalStorageGame
} from "../src/app/settlement/game-local-storage";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createMemoryStorage } from "./memory-storage";

const gameOf = (map: string): GameSaveV1 => ({
  format: "island-settlers-game", map, progress: { fog: { length: 0, packed: "" }, surveyed: [] }, savedAt: 1,
  settlement: { storagePools: { nextId: 0, pools: [], version: 1 } } as unknown as GameSaveV1["settlement"],
  version: 4
});

describe("local storage fallback limits", () => {
  it("stores a game below the limit", async () => {
    const storage = createMemoryStorage();
    const database = openLocalStorageGame(storage);
    await database.writeGame("slot", gameOf("small"));
    expect((await database.readGame("slot"))?.map).toBe("small");
  });

  it("refuses an oversize game with an explicit message and keeps the previous save", async () => {
    const storage = createMemoryStorage();
    const database = openLocalStorageGame(storage);
    await database.writeGame("slot", gameOf("previous"));
    await expect(database.writeGame("slot", gameOf("x".repeat(LOCAL_FALLBACK_MAX_CHARS))))
      .rejects.toThrow(LOCAL_FALLBACK_TOO_LARGE);
    expect((await database.readGame("slot"))?.map).toBe("previous");
  });

  it("turns a full storage into the same message and rethrows other errors", async () => {
    const storage = createMemoryStorage();
    const database = openLocalStorageGame(storage);
    const setItem = storage.setItem;
    storage.setItem = () => { throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); };
    await expect(database.writeGame("slot", gameOf("a"))).rejects.toThrow(LOCAL_FALLBACK_TOO_LARGE);
    storage.setItem = () => { throw new Error("denied"); };
    await expect(database.writeGame("slot", gameOf("a"))).rejects.toThrow("denied");
    storage.setItem = setItem;
  });
});
