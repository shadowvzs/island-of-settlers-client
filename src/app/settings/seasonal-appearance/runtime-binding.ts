import type { ReadableStore } from "../../components/ui-store";
import {
  getSeasonRuntimeState,
  isSameSeasonRuntime,
  type SeasonalAppearanceSnapshot,
  type SeasonRuntimeState
} from "./store";

interface SeasonalRuntimeOptions {
  /** The season state the current island runtime was built with. */
  applied: () => SeasonRuntimeState;
  busy: () => boolean;
  refresh: () => Promise<boolean>;
  store: ReadableStore<SeasonalAppearanceSnapshot>;
  onFailure: () => void;
}

/** Coalesce season changes outside the frame loop and wait for an existing island transition. */
export const bindSeasonalRuntime = ({ applied, busy, onFailure, refresh, store }: SeasonalRuntimeOptions) => {
  let disposed = false, applying = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const isApplied = () => isSameSeasonRuntime(getSeasonRuntimeState(store.getSnapshot()), applied());
  const schedule = () => {
    if (disposed || retry !== undefined) return;
    retry = setTimeout(() => { retry = undefined; void update(); }, 250);
  };
  const update = async () => {
    if (disposed || applying || isApplied()) return;
    if (busy()) { schedule(); return; }
    applying = true;
    let succeeded = false;
    try { succeeded = await refresh(); }
    catch { /* Keep the existing island; the established handoff owns recovery after commit. */ }
    finally { applying = false; }
    if (disposed) return;
    if (!succeeded) { onFailure(); return; }
    if (!isApplied()) schedule();
  };
  const unsubscribe = store.subscribe(() => { void update(); });
  void update();
  return () => {
    disposed = true;
    unsubscribe();
    if (retry !== undefined) clearTimeout(retry);
  };
};
