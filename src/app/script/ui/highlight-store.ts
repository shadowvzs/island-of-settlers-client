import type {
  ScriptUiHighlight
} from "../../../../../island-of-settlers-shared/src/script/engine/ui-effects";
import { createExternalStore } from "../../components/ui-store";
import { MS_PER_SECOND, NO_SHOWN_HIGHLIGHTS as NONE } from "./constants";

/** A highlight on screen: the script's highlight plus its presentation deadline (`until: "seconds"`). */
export interface ShownHighlight extends ScriptUiHighlight {
  /** `performance.now()` ms when it disappears; null for `clicked` / `windowClosed`. */
  expiresAt: number | null;
}

const shownOf = (highlight: ScriptUiHighlight, now: number): ShownHighlight => ({
  ...highlight,
  expiresAt: highlight.until === "seconds" && highlight.seconds !== null
    ? now + highlight.seconds * MS_PER_SECOND : null
});

/**
 * The highlights on screen (presentation only, never saved): an immutable list the overlay renders. Waiting ones
 * follow the run state (`syncWaiting`), so a reload, an acknowledgement or a timeout adds or removes them.
 */
export const createHighlightStore = () => {
  const store = createExternalStore<readonly ShownHighlight[]>(NONE);
  const write = (next: readonly ShownHighlight[]) => store.set(next.length ? next : NONE);
  const list = () => store.getSnapshot();
  return {
    add: (highlight: ScriptUiHighlight, now: number) => {
      write([...list().filter(entry => entry.effectId !== highlight.effectId), shownOf(highlight, now)]);
    },
    /** "Clear all highlights": the transient ones; a waiting highlight stays while its run waits. */
    clearTransient: () => write(list().filter(entry => entry.waiting)),
    expire: (now: number) => {
      if (list().some(entry => entry.expiresAt !== null && entry.expiresAt <= now))
        write(list().filter(entry => entry.expiresAt === null || entry.expiresAt > now));
    },
    list,
    remove: (effectId: string) => {
      if (list().some(entry => entry.effectId === effectId))
        write(list().filter(entry => entry.effectId !== effectId));
    },
    store,
    syncWaiting: (waiting: readonly ScriptUiHighlight[], now: number) => {
      const ids = new Set(waiting.map(entry => entry.effectId));
      const kept = list().filter(entry => !entry.waiting || ids.has(entry.effectId));
      const known = new Set(kept.map(entry => entry.effectId));
      const added = waiting.filter(entry => !known.has(entry.effectId)).map(entry => shownOf(entry, now));
      if (kept.length !== list().length || added.length) write([...kept, ...added]);
    }
  };
};

export type HighlightStore = ReturnType<typeof createHighlightStore>;
