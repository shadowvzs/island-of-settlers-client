import type { GameSaveV1 } from "../shared/settlement/game-save";
import type { SaveStore } from "./save-store/save-store";
import { SessionTransitionReloadRequired } from "./session-lifecycle";

/** The startup payload is the durable commit point, including a failed or uncertain slot write. */
export const createIslandHandoffStore = (store: Pick<SaveStore,
  "clearStartupGame" | "writeSavedGame" | "writeStartupGame"
>) => ({
  commit: async (save: GameSaveV1) => {
    await store.writeStartupGame(JSON.stringify(save));
    try {
      await store.writeSavedGame(save);
    } catch {
      // Reload consumes the already-durable destination; the old island must remain frozen.
      throw new SessionTransitionReloadRequired();
    }
  },
  commitStartup: (value: unknown) => store.writeStartupGame(JSON.stringify(value)),
  complete: () => store.clearStartupGame(),
  // A departure is a recovery save, never a startup override of future autosaves.
  writeDeparture: (save: GameSaveV1) => store.writeSavedGame(save)
});
