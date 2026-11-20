import type { CapturedGame } from "../src/app/save-store/captured-game";
import type { SaveStore } from "../src/app/save-store/save-store";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";

/**
 * In-memory SaveStore: `games` holds written saves, `captures` the captured games the coordinator saved,
 * `values` the startup payload and replay report.
 */
export const createMemorySaveStore = () => {
  const values = new Map<"replay" | "startup", string>(), games: GameSaveV1[] = [], captures: CapturedGame[] = [];
  const read = (key: "replay" | "startup") => async () => values.get(key) ?? null;
  const write = (key: "replay" | "startup") => async (json: string) => { values.set(key, json); };
  const store: SaveStore = {
    location: "browser",
    clearStartupGame: async () => { values.delete("startup"); },
    readReplayReport: read("replay"),
    readSavedGame: async () => games.at(-1) ?? null,
    readStartupGame: read("startup"),
    writeReplayReport: write("replay"),
    writeCapturedGame: async captured => { captures.push(captured); },
    writeSavedGame: async save => { games.push(save); },
    writeStartupGame: write("startup")
  };
  return { captures, games, store, values };
};
