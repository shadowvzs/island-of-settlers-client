import { describe, expect, it } from "vitest";

import { createLocalSaveStore } from "../src/app/save-store/local-save-store";
import type { SaveStore } from "../src/app/save-store/save-store";
import { openLocalStorageGame } from "../src/app/settlement/game-local-storage";
import {
  fromSlotRows, toSlotRows
} from "../src/app/settlement/game-slot-rows";
import { createPlayerProgress } from "../src/shared/progression/player-progress";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { splitGameSave } from "../src/shared/settlement/game-save-rows";
import { createMemoryStorage } from "./memory-storage";

const save = (map: string, gems = 0): GameSaveV1 => ({
  format: "island-settlers-game", map, player: { ...createPlayerProgress(1), experience: 10, gems },
  progress: { fog: { length: 0, packed: "" }, surveyed: [] }, savedAt: 10, settlement: { storagePools: { version: 1 as const, nextId: 0, pools: [] } } as unknown as GameSaveV1["settlement"], version: 4
});

const savedMap = async (store: SaveStore) => {
  return (await store.readSavedGame())?.map ?? null;
};

describe("save slots per account", () => {
  it("keeps each account's game, player progress and startup payload apart", async () => {
    const database = openLocalStorageGame(createMemoryStorage());
    const ada = createLocalSaveStore(database, "ada"), bo = createLocalSaveStore(database, "bo");
    await ada.writeSavedGame(save("ada-island", 40));
    expect(await savedMap(bo)).toBeNull();
    await bo.writeSavedGame(save("bo-island", 0));
    expect(await savedMap(ada)).toBe("ada-island");
    expect(await savedMap(bo)).toBe("bo-island");
    expect((await ada.readSavedGame())!.player!.gems).toBe(40);
    expect(await savedMap(createLocalSaveStore(database))).toBeNull();
    await ada.writeStartupGame("ada-startup");
    expect(await bo.readStartupGame()).toBeNull();
    await bo.writeStartupGame("bo-startup");
    await bo.clearStartupGame();
    expect(await bo.readStartupGame()).toBeNull();
    expect(await savedMap(ada)).toBe("ada-island");
    expect(await ada.readStartupGame()).toBe("ada-startup");
  });

  it("stores rows keyed by the slot and reads them back unchanged", () => {
    const rows = splitGameSave(save("home", 3));
    const slotted = toSlotRows("ada", rows);
    expect(slotted.islands.every(row => row.slotId === "ada")).toBe(true);
    expect(slotted.player?.id).toBe("ada");
    expect(slotted.session.id).toBe("ada");
    expect(fromSlotRows(slotted)).toEqual({ ...rows, adventures: [] });
  });
});

describe("evacuations table", () => {
  it("stores current evacuations in their own rows", async () => {
    const storage = createMemoryStorage(), database = openLocalStorageGame(storage);
    const evacuations = [{ cargo: { fish: 2 }, deadline: 9, expeditionId: 5, name: "Heron Key",
      troops: [{ hp: 80, rank: 0, type: "archer" as const }], voyageSeconds: 90 }];
    const archipelago = { active: null, colonies: [], evacuations, version: 1 as const };
    await database.writeGame("ada", { ...save("home"), archipelago });
    expect((await database.readGame("ada"))?.archipelago?.evacuations).toEqual(evacuations);
    const stored = JSON.parse(storage.getItem("island-settlers-db.rows.ada")!);
    expect(stored.session.evacuations).toBeUndefined();
    expect(stored.evacuations).toEqual(evacuations);
    expect(toSlotRows("ada", stored).evacuations).toEqual([{ ...evacuations[0], slotId: "ada" }]);
  });
});

describe("save format reset", () => {
  it("discards previous games and startup payloads while preserving accounts", async () => {
    const storage = createMemoryStorage({
      "island-settlers-db.boot.current-account": "ada",
      "island-settlers-db.boot.startup": "pending",
      "island-settlers-db.rows": JSON.stringify(splitGameSave(save("old", 12))),
      "island-settlers-db.rows.ada": JSON.stringify(splitGameSave(save("old-account", 12))),
      "island-settlers-db.accounts": "[]"
    });
    const database = openLocalStorageGame(storage);
    expect(await createLocalSaveStore(database, "ada").readSavedGame()).toBeNull();
    expect(await createLocalSaveStore(database).readSavedGame()).toBeNull();
    expect(await database.readValue("current-account")).toBe("ada");
    expect(await database.readValue("startup")).toBeNull();
    expect(storage.getItem("island-settlers-db.accounts")).toBe("[]");
    await database.writeGame("ada", save("current", 12));
    const reopened = openLocalStorageGame(storage);
    expect(await savedMap(createLocalSaveStore(reopened, "ada"))).toBe("current");
  });
});
