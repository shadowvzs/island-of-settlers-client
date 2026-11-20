import { type GameDatabase, openGameDatabase } from "../settlement/game-database";
import { persistCapturedGameInWorker } from "../settlement/game-session-worker";
import {
  GAME_STARTUP_SLOT, GUEST_SLOT, slotValueKey, STORY_PROGRESS_KEY
} from "../settlement/game-slot-rows";
import { type CapturedGame, composeCapturedGame } from "./captured-game";
import { replaceFiledIslandProof } from "./remote-archived-relief";
import type { SaveStore } from "./save-store";
import { storedStoryProgress } from "./story-progress";

/** Boot value of the reproduction report kept across an island visit. */
export const REPLAY_REPORT_KEY = "settlers-reproduction-previous-island";

/**
 * The browser save of one slot: the game maps onto the slot's rows (islands, colonies, adventures, evacuations,
 * player and session), the startup payload and replay report onto the slot's boot values. The slot is the guest
 * slot, or (`slotId`) a cloud slot's local side, whose saved game is its unconfirmed-upload copy.
 */
export const createLocalSaveStore = (database: GameDatabase, localSlotId?: string) => {
  const slotId = localSlotId ?? GUEST_SLOT;
  const valueKey = (key: string) => slotValueKey(slotId, key);
  /** IndexedDB: the worker builds and writes the rows; the localStorage fallback writes from the page. */
  const writeCapturedGame = async (captured: CapturedGame) => {
    if (database.backend === "indexeddb")
      await persistCapturedGameInWorker(captured, { kind: "local", slotId });
    else await database.writeGame(slotId, await composeCapturedGame(captured));
  };
  const store: SaveStore = {
    location: "browser",
    clearStartupGame: () => database.removeValue(valueKey(GAME_STARTUP_SLOT)),
    endRunWithoutHome: async player => {
      await database.writeValue(valueKey(STORY_PROGRESS_KEY), JSON.stringify(player));
      await database.clearGame(slotId);
    },
    readReplayReport: () => database.readValue(valueKey(REPLAY_REPORT_KEY)),
    readSavedGame: () => database.readGame(slotId),
    readStartupGame: () => database.readValue(valueKey(GAME_STARTUP_SLOT)),
    readStoryProgress: async () => storedStoryProgress(await database.readValue(valueKey(STORY_PROGRESS_KEY))),
    writeCapturedGame,
    writeReplayReport: json => database.writeValue(valueKey(REPLAY_REPORT_KEY), json),
    writeArchivedIslandGame: async (save, proof) => {
      // A browser-only commit needs no account attestation; compact only this committed source.
      const canonical = replaceFiledIslandProof(save, proof, true);
      await database.writeGame(slotId, canonical);
      return canonical;
    },
    writeSavedGame: async save => { await database.writeGame(slotId, save); },
    writeStartupGame: json => database.writeValue(valueKey(GAME_STARTUP_SLOT), json)
  };
  return {
    ...store, clearSavedGame: () => database.clearGame(slotId), hasSavedGame: () => database.hasGame(slotId), slotId
  };
};

/** The slot's store over the current browser database. */
export const openLocalSaveStore = async (localSlotId?: string) => {
  const database = await openGameDatabase();
  return createLocalSaveStore(database, localSlotId);
};

/** Development menu: clear every browser save/map base/boot value but keep local accounts. */
export const clearAllLocalGameSaves = async () => (await openGameDatabase()).clearAllGames();

/** Development menu: delete the whole browser game database, including local accounts. */
export const recreateLocalGameDatabase = async () => (await openGameDatabase()).recreateDatabase();
