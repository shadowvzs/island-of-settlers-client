import type { ScriptTraceEntry } from "../../../../../island-of-settlers-shared/src/script/engine/trace";
import { createExternalStore } from "../../components/ui-store";
import { TEST_PLAY_LOG_CAPACITY } from "./constants";

/** One traced engine entry with the game tick it happened in. */
export interface TestPlayLogRecord {
  entry: ScriptTraceEntry;
  id: number;
  tick: number;
}

/**
 * The play-test log (presentation only): `record` is the engine's trace sink and only appends to a buffer;
 * `publish` hands the newest `capacity` lines to the panel's store. Nothing here is read by the simulation.
 */
export const createTestPlayLog = (capacity = TEST_PLAY_LOG_CAPACITY) => {
  const store = createExternalStore<readonly TestPlayLogRecord[]>([]);
  let pending: TestPlayLogRecord[] = [];
  let nextId = 1;
  return {
    clear: () => {
      pending = [];
      store.set([]);
    },
    publish: () => {
      if (pending.length === 0) return;
      store.set([...store.getSnapshot(), ...pending].slice(-capacity));
      pending = [];
    },
    record: (entry: ScriptTraceEntry, tick: number) => {
      if (pending.length >= capacity) pending.shift();
      pending.push({ entry, id: nextId, tick });
      nextId += 1;
    },
    store
  };
};

export type TestPlayLog = ReturnType<typeof createTestPlayLog>;
