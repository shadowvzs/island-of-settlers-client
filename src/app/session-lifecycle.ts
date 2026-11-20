/**
 * One application session generation. Work that outlives the request that started it (worker
 * preparation, model loads, UI results) holds a token and checks `current()` before touching state.
 */
export interface SessionToken {
  readonly generation: number;
  /** False once the transition settled, failed, or a newer session generation was installed. */
  current(): boolean;
}

/** A transition result: success, a coalesced repeat, or a defined refusal. */
export type SessionTransitionResult<T> =
  | { coalesced: boolean; ok: true; value: T }
  | {
      error?: unknown;
      ok: false;
      reason: "busy" | "cancelled" | "failed" | "reload-required" | "stale";
    };

/** Thrown inside a transition that must keep the committed session: nothing was written or replaced. */
export class SessionTransitionCancelled extends Error {
  constructor() {
    super("Session transition cancelled");
    this.name = "SessionTransitionCancelled";
  }
}

/**
 * Thrown after the destination commit when the document still has to reload. The old session is
 * obsolete, so the generation advances and the freeze stays in place; no old-session resume path runs.
 */
export class SessionTransitionReloadRequired extends Error {
  constructor() {
    super("Session transition requires a reload");
    this.name = "SessionTransitionReloadRequired";
  }
}

export interface SessionTransitionRequest<T> {
  /**
   * A coordination-only transition (tab resume) that keeps the current session: the freeze is released
   * on success and no newer generation is installed. Replacement transitions stay frozen for the reload.
   */
  keepSession?: boolean;
  /** Repeats of the same key coalesce; a different key is refused while a transition runs. */
  key: string;
  /**
   * An in-page replacement: after the destination install succeeds, advance the generation and release
   * the freeze so the new island accepts commands. Existing callers that omit it keep the reload
   * behavior (advance the generation and stay frozen).
   */
  replaceSession?: boolean;
  run(token: SessionToken): Promise<T>;
}

interface SessionLifecycleOptions {
  /** True at the start of a transition; false only when it fails and the old session resumes. */
  onFrozen?: (frozen: boolean, key?: string) => void;
}

/**
 * Owns session replacement for the page: one transition at a time, a generation guard for late
 * results, and the disposers a future in-page replacement must run before installing a new island.
 *
 * A successful replacement commits a newer generation and stays frozen because the current callers
 * still hand off through a page reload. A successful `keepSession` transition (tab resume) keeps the
 * generation and releases the freeze, so the same island continues with commands and autosave.
 * A failed or stale preparation keeps the committed session generation and releases the freeze, so
 * the old island resumes without saving a half-built one.
 */
export const createSessionLifecycle = (options: SessionLifecycleOptions = {}) => {
  let generation = 0, frozen = false;
  let active: { key: string; promise: Promise<SessionTransitionResult<unknown>> } | undefined;
  const pageDisposers: (() => void)[] = [];
  const islandDisposers: (() => void)[] = [];

  const setFrozen = (next: boolean, key?: string) => {
    if (next === frozen) return;
    frozen = next;
    options.onFrozen?.(next, key);
  };
  const runDisposers = (disposers: (() => void)[]) => {
    for (const dispose of disposers.splice(0).reverse()) {
      try { dispose(); } catch { /* the remaining owners still release */ }
    }
  };
  const run = <T>(request: SessionTransitionRequest<T>): Promise<SessionTransitionResult<T>> => {
    if (active) {
      if (active.key !== request.key) return Promise.resolve({ ok: false, reason: "busy" });
      return active.promise.then(result => ({ ...result, coalesced: true } as SessionTransitionResult<T>));
    }
    let settled = false;
    const token: SessionToken = {
      generation,
      current: () => !settled && token.generation === generation && active?.key === request.key
    };
    setFrozen(true, request.key);
    const promise = (async (): Promise<SessionTransitionResult<T>> => {
      let committed = false;
      let reloadRequired = false;
      try {
        const value = await request.run(token);
        if (!token.current()) return { ok: false, reason: "stale" };
        settled = true;
        active = undefined;
        if (request.keepSession) setFrozen(false, request.key);
        else {
          generation++;
          if (request.replaceSession) setFrozen(false, request.key);
        }
        committed = true;
        return { coalesced: false, ok: true, value };
      } catch (error) {
        if (error instanceof SessionTransitionReloadRequired) {
          reloadRequired = true;
          // The old session is obsolete even though it cannot be unfrozen; stale workers must not
          // install into it while the document navigates to the committed destination.
          generation++;
          return { error, ok: false, reason: "reload-required" };
        }
        if (error instanceof SessionTransitionCancelled) return { ok: false, reason: "cancelled" };
        return { error, ok: false, reason: "failed" };
      } finally {
        settled = true;
        active = undefined;
        if (!committed && !reloadRequired) setFrozen(false, request.key);
      }
    })();
    active = { key: request.key, promise };
    return promise;
  };
  return {
    /** Installs a newer session in the same document: older work becomes stale; commands run again. */
    activateSession: () => { generation++; setFrozen(false); },
    busy: () => active !== undefined,
    /** Runs every retained owner once, island owners first, newest first; one failure does not block. */
    dispose: () => {
      runDisposers(islandDisposers);
      runDisposers(pageDisposers);
      setFrozen(false);
    },
    /** Runs only the departing island's owners; page-level owners survive an in-page replacement. */
    disposeIsland: () => { runDisposers(islandDisposers); },
    frozen: () => frozen,
    generation: () => generation,
    /**
     * Keeps one island owner's disposer for the next island teardown. Kept as the compatibility alias
     * for `retainIsland`; new page-level owners must use `retainPage`.
     */
    retain: (dispose: () => void) => { islandDisposers.push(dispose); return dispose; },
    /** Keeps an island owner's disposer for the next whole-session replacement. */
    retainIsland: (dispose: () => void) => { islandDisposers.push(dispose); return dispose; },
    /** Keeps a page owner's disposer across island replacements; it runs only on page exit. */
    retainPage: (dispose: () => void) => { pageDisposers.push(dispose); return dispose; },
    run
  };
};

export type SessionLifecycle = ReturnType<typeof createSessionLifecycle>;
