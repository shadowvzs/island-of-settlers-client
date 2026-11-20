import type { SaveStatusSnapshot, SaveStatusStore } from "./save-status";

type SaveStatusSnapshotFields = Omit<SaveStatusSnapshot, "cloud">;

/** Why a save runs: the timer, a key game event, the tab hiding or closing, logging out, or Save game. */
export type SaveReason = "event" | "hidden" | "interval" | "logout" | "manual" | "pagehide";

/** Captures and writes one save through the active SaveStore (the settlement's save controller). */
export interface SaveRunner {
  /** Resolves at a tick boundary whose following frames hold the island's ticks (capture, then reload). */
  betweenTicks: () => Promise<void>;
  /**
   * Interval and event saves wait for an idle moment (camera still, tab hidden, a menu open), so the snapshot
   * reload never lands mid-interaction (D3).
   */
  idleMoment?: (signal?: AbortSignal) => Promise<void>;
  /** One save for `reason`; false when it did not save (the game stays dirty and a later trigger retries). */
  save: (reason: SaveReason) => Promise<boolean>;
}

/** One checkpoint request's result: whether a save ran, whether the local write succeeded and what joined it. */
export interface SaveCheckpoint {
  /** The save's failure (the store threw or reported a refused write); `saved` is false then. */
  error?: unknown;
  /** A save was already running when this checkpoint was requested; the result includes its follow-up. */
  joined: boolean;
  /** A save actually ran. False means the game was clean: the committed save is still current. */
  ran: boolean;
  /** The local save succeeded (a cloud upload may still be pending or failed). */
  saved: boolean;
}

export interface SaveTimers {
  clear: (handle: ReturnType<typeof setTimeout>) => void;
  set: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

export interface SaveCoordinatorOptions {
  /** Key events within this window coalesce into one save (milliseconds). */
  debounceMs?: number;
  /**
   * Whether key events schedule a save (default true). False = automatic saving off (plan §7.3): an event only marks
   * the game dirty, and only tab hiding/closing, travel and explicit flushes write.
   */
  events?: boolean;
  /**
   * A dirty game saves at the next tick boundary after this many minutes even while input never rests
   * (owner D-S6); 0 turns the limit off. Default `MAX_DIRTY_AGE_MINUTES`.
   */
  maxDirtyAgeMinutes?: number;
  /** The automatic save interval (0 = no interval saves, for tools/tests). */
  minutes: number;
  /** The menu's save line: a save running, its result and when it finished. */
  status?: Pick<SaveStatusStore, "getSnapshot" | "set">;
  now?: () => number;
  timers?: SaveTimers;
}

interface RunMode {
  transitionCurrent?: () => boolean;
  /** Saves even when nothing changed (Save game). */
  force: boolean;
  /** Skips the tick boundary: the tab is hiding or closing, no further frame may run. */
  immediate: boolean;
  /** Waits for an idle moment first (interval and event saves; the player asked for the others). */
  whenIdle: boolean;
}

const MINUTE_MS = 60_000;
export const SAVE_DEBOUNCE_MS = 3000;
/** Longest an interval or event save waits for an idle moment (owner D-S6). */
export const MAX_DIRTY_AGE_MINUTES = 10;
export const DEFAULT_SAVE_TIMERS: SaveTimers = { clear: handle => clearTimeout(handle), set: (run, ms) => setTimeout(run, ms) };
/** Interval and event saves: only when dirty, captured at a tick boundary. */
const QUEUED: RunMode = { force: false, immediate: false, whenIdle: true };
const FLUSH_MODES: Record<Exclude<SaveReason, "event" | "interval">, RunMode> = {
  hidden: { force: false, immediate: true, whenIdle: false },
  /** Logging out saves even an unchanged game: it reports whether the account's save is current. */
  logout: { force: true, immediate: false, whenIdle: false },
  manual: { force: true, immediate: false, whenIdle: false },
  pagehide: { force: false, immediate: true, whenIdle: false }
};

/**
 * The one owner of WHEN the game saves, for every SaveStore (browser save and cloud slot alike):
 * - triggers: the Autosave interval, key events (debounced), tab hiding/closing, logout and Save game;
 * - dirty tracking: a save runs only when a simulation tick or event changed the game since the last capture
 *   (Save game always saves);
 * - single flight: a trigger during a save waits for it, then all waiting triggers share one follow-up save;
 * - capture at a tick boundary, so a save never sees a half-advanced simulation step.
 * `stop()` ends saving for good before a page handoff that already persisted the game (travel, load, resume).
 */
export const createSaveCoordinator = (options: SaveCoordinatorOptions) => {
  const timers = options.timers ?? DEFAULT_SAVE_TIMERS, debounceMs = options.debounceMs ?? SAVE_DEBOUNCE_MS;
  const eventSaves = options.events ?? true;
  const minutes = options.minutes, maxDirtyAgeMs = (options.maxDirtyAgeMinutes ?? MAX_DIRTY_AGE_MINUTES) * MINUTE_MS;
  let runner: SaveRunner | null = null;
  let dirtySince: number | null = null;
  let dirty = false, paused = false, stopped = false, suspended = false;
  let running: Promise<SaveCheckpoint> | null = null, follow: Promise<SaveCheckpoint> | null = null;
  let followMode: RunMode = QUEUED, followReason: SaveReason = "event";
  let intervalTimer: ReturnType<typeof setTimeout> | undefined, eventTimer: ReturnType<typeof setTimeout> | undefined;

  const now = options.now ?? Date.now;
  const touchDirty = () => {
    if (!dirty) dirtySince = now();
    dirty = true;
  };
  /** Milliseconds until the dirty game may no longer wait for an idle moment (Infinity: no limit). */
  const dirtyAgeLeft = () => dirtySince === null || !maxDirtyAgeMs ? Infinity : maxDirtyAgeMs - (now() - dirtySince);
  /** Waits for the runner's idle moment, but never longer than the maximum dirty age. */
  const waitForIdleMoment = async () => {
    if (!runner?.idleMoment) return;
    const left = dirtyAgeLeft();
    if (left <= 0) return;
    const controller = new AbortController();
    let handle: ReturnType<typeof setTimeout> | undefined;
    const waits = [runner.idleMoment(controller.signal)];
    if (Number.isFinite(left)) waits.push(new Promise<void>(resolve => { handle = timers.set(resolve, left); }));
    try { await Promise.race(waits); }
    finally {
      controller.abort();
      if (handle !== undefined) timers.clear(handle);
    }
  };
  const report = (change: Partial<SaveStatusSnapshotFields>) => {
    if (options.status) options.status.set({ ...options.status.getSnapshot(), ...change });
  };
  const clearTimers = () => {
    if (intervalTimer !== undefined) timers.clear(intervalTimer);
    if (eventTimer !== undefined) timers.clear(eventTimer);
    intervalTimer = eventTimer = undefined;
  };
  const scheduleInterval = () => {
    if (intervalTimer !== undefined) timers.clear(intervalTimer);
    intervalTimer = undefined;
    if (!minutes || !runner || paused || stopped || suspended) return;
    intervalTimer = timers.set(() => { intervalTimer = undefined; void run("interval", QUEUED); },
      minutes * MINUTE_MS);
  };
  const execute = async (reason: SaveReason, mode: RunMode): Promise<SaveCheckpoint> => {
    const permitted=()=>{
      if (stopped) return false;
      if (mode.transitionCurrent) return mode.transitionCurrent();
      return !suspended;
    };
    if (!runner || !permitted() || (!dirty && !mode.force))
      return { joined: false, ran: false, saved: false };
    if (mode.whenIdle) await waitForIdleMoment();
    if (!mode.immediate) await runner.betweenTicks();
    if (!permitted()) return { joined: false, ran: false, saved: false };
    const since = dirtySince;
    dirty = false;
    dirtySince = null;
    report({ saving: true });
    let error: unknown, saved = false;
    try { saved = await runner.save(reason); } catch (caught) { error = caught; }
    if (!saved) {
      dirty = true;
      dirtySince = since ?? now();
    }
    report(saved ? { failed: false, lastSavedAt: now(), saving: false } : { failed: true, saving: false });
    return { ...(error === undefined ? {} : { error }), joined: false, ran: true, saved };
  };
  const start = (reason: SaveReason, mode: RunMode): Promise<SaveCheckpoint> => {
    if (eventTimer !== undefined) timers.clear(eventTimer);
    eventTimer = undefined;
    const current = execute(reason, mode).finally(() => {
      running = null;
      scheduleInterval();
    });
    running = current;
    return current;
  };
  /** Single flight: while a save runs, every new trigger joins one follow-up save (the strongest mode wins). */
  const run = (reason: SaveReason, mode: RunMode): Promise<SaveCheckpoint> => {
    if (!running) return start(reason, mode);
    followMode = follow ? { force: followMode.force || mode.force, immediate: followMode.immediate || mode.immediate,
      whenIdle: followMode.whenIdle && mode.whenIdle,
      transitionCurrent:mode.transitionCurrent ?? followMode.transitionCurrent } : mode;
    followReason = reason;
    follow ??= running.then(() => {
      follow = null;
      return run(followReason, followMode);
    });
    return follow.then(result => ({ ...result, joined: true }));
  };

  return {
    /** Binds the settlement's save once it exists; the interval starts counting then. */
    attach: (next: SaveRunner) => {
      runner = next;
      scheduleInterval();
    },
    /** The tab-hide checkpoint: clean/no-write, saved, failed and whether an in-flight save joined it. */
    checkpoint: (reason: "hidden" | "pagehide") => run(reason, FLUSH_MODES[reason]),
    dispose: clearTimers,
    /** Saves now (tab hiding/closing, logout, Save game), after any running save. */
    flush: (reason: keyof typeof FLUSH_MODES) => run(reason, FLUSH_MODES[reason]).then(result => result.saved),
    /** The current lifecycle owner checkpoints held ticks while ordinary saves remain suspended. */
    flushTransition: (current:()=>boolean) => run("manual",{ ...FLUSH_MODES.manual,
      transitionCurrent:current }).then(result=>result.saved),
    /** A simulation tick ran or the player changed something: the next trigger has work to save. */
    markDirty: touchDirty,
    /** A key event (upgrade done, ship sails, expedition): saves once the debounce window closes. */
    request: () => {
      touchDirty();
      if (!eventSaves || paused || stopped || suspended || eventTimer !== undefined) return;
      eventTimer = timers.set(() => { eventTimer = undefined; void run("event", QUEUED); }, debounceMs);
    },
    /** No interval or event save starts while paused (logging out); flushes still run. */
    setPaused: (next: boolean) => {
      paused = next;
      if (next && eventTimer !== undefined) timers.clear(eventTimer);
      if (next) eventTimer = undefined;
      scheduleInterval();
    },
    /** True while a session transition owns the writes, or saving ended for good (Save to slot is refused then). */
    isSuspended: () => suspended || stopped,
    /** A session transition owns every write; checkpoints and explicit flushes must wait too. */
    setSuspended: (next: boolean) => {
      suspended = next;
      if (next) clearTimers();
      else scheduleInterval();
    },
    stop: () => {
      stopped = true;
      clearTimers();
    },
    /** Drains accepted saves, including a queued follow-up, without starting another write. */
    whenIdle: async () => {
      for (let pending = follow ?? running; pending; pending = follow ?? running) await pending;
    }
  };
};

export type SaveCoordinator = ReturnType<typeof createSaveCoordinator>;

/** The settlement's frame job queue (held-frame-jobs.ts): a queued job runs in a frame that does not tick. */
export interface FrameJobQueue {
  cancel: (job: () => void) => void;
  queue: (job: () => void) => void;
}

/**
 * The simulation's tick boundary: a save waits for a held frame (no tick runs in it, rendering does), so its
 * capture and the in-place reload after it see one state; without frames the wait ends after `idleMs`.
 */
export const createTickBoundary = (jobs: FrameJobQueue, timers: SaveTimers = DEFAULT_SAVE_TIMERS, idleMs = 250) => ({
  betweenTicks: () => new Promise<void>(resolve => {
    let waiting = true;
    const release = () => {
      if (!waiting) return;
      waiting = false;
      jobs.cancel(release);
      resolve();
    };
    jobs.queue(release);
    timers.set(release, idleMs);
  })
});
