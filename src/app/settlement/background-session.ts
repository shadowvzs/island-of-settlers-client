import type { I18n, MessageDescriptor, Values } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { errorMessage } from "../helpers";
import type { SaveCheckpoint } from "../save-store/save-coordinator";
import { SESSION_MESSAGES } from "../session-messages";
import { sameTabResumeContext, type TabResumeContext } from "./tab-resume";

export interface BackgroundResumeAttempt {
  /** Real/monotonic time when the tab became visible again. */
  at: number;
  /** The session identity and game time recorded once at hide. */
  context: TabResumeContext;
  gameNow: number;
  /** The hide checkpoint: clean/no-write, saved, failed, and whether an in-flight save joined it. */
  save: SaveCheckpoint;
}

/** `handled`: another transition owns the freeze, so the background owner leaves autosave alone. */
export type BackgroundResumeResult = "handled" | "reloaded" | "retained";

interface BackgroundSessionOptions {
  /** The session identity at hide; a changed context falls back to the reload recovery. */
  context?: () => TabResumeContext;
  document?: Pick<Document, "addEventListener" | "hidden" | "removeEventListener">;
  /** The island's game time: the hide boundary used by the resume decision and the reload reference. */
  gameNow?: () => number;
  /** Active interface language; absent keeps the English source copy (tests and non-UI callers). */
  i18n?: I18n;
  notify(message: string): void;
  now?: () => number;
  /** The window events (`pagehide`/`pageshow.persisted`); the window by default. */
  page?: Pick<Window, "addEventListener" | "removeEventListener">;
  pauseAutosave(paused: boolean): void;
  /** The existing committed-save reload recovery. */
  reload?: () => Promise<void> | void;
  /** Resets the render loop's frame and service time origins after visibility changes. */
  resetFrameTime?: () => void;
  resume(attempt: BackgroundResumeAttempt): Promise<BackgroundResumeResult | void> | BackgroundResumeResult | void;
  /** Defaults to comparing with `context()`. */
  sameContext?: (context: TabResumeContext) => boolean;
  save(): Promise<SaveCheckpoint>;
}

const EMPTY_CONTEXT: TabResumeContext = {
  accountId: null, generation: 0, islandId: null, location: "browser", slotId: null, worldSeed: 0
};

/**
 * Keeps the tab's game alive across hide/show: one hide boundary/checkpoint, one resume at a time, and
 * the same autosave pause released exactly once. Repeated visibility changes join the running resume;
 * a hide during it records the next interval, which reconciles after the first finishes.
 */
export const createBackgroundSession = (options: BackgroundSessionOptions) => {
  const target = options.document ?? document, page = options.page ?? window;
  const t = (descriptor: MessageDescriptor, values?: Values) =>
    translateMessage(options.i18n, descriptor, values);
  const now = options.now ?? Date.now;
  let boundary: { at: number; context: TabResumeContext; gameNow: number } | undefined;
  let checkpoint: Promise<SaveCheckpoint> | undefined;
  let backgroundPausedAutosave = false, resuming = false, leaveAutosavePaused = false;

  const pauseAutosave = () => {
    backgroundPausedAutosave = true;
    options.pauseAutosave(true);
  };
  const releaseAutosave = () => {
    backgroundPausedAutosave = false;
    options.pauseAutosave(false);
  };
  const saveCheckpoint = () => Promise.resolve().then(options.save).catch(error => ({
    error, joined: false, ran: true, saved: false
  }));
  const rememberBoundary = () => {
    boundary ??= {
      at: now(),
      context: options.context?.() ?? EMPTY_CONTEXT,
      gameNow: (options.gameNow ?? now)()
    };
  };
  const fallback = async (message: string): Promise<BackgroundResumeResult> => {
    options.notify(message);
    if (!options.reload) return "retained";
    try {
      await options.reload();
      return "reloaded";
    } catch (error) {
      options.notify(errorMessage(error, t(SESSION_MESSAGES.background.resumeFailed)));
      return "retained";
    }
  };
  const resumeOne = async (current: NonNullable<typeof boundary>, saved: Promise<SaveCheckpoint>) => {
    const result = await saved;
    const sameContext = options.sameContext ?? (context => sameTabResumeContext(context, current.context));
    if (!sameContext(current.context))
      return fallback(t(SESSION_MESSAGES.background.changedElsewhere));
    if (result.ran && !result.saved)
      options.notify(t(SESSION_MESSAGES.background.saveFailed));
    return await options.resume({ ...current, at: now(), save: result }) ?? "retained";
  };
  const run = async () => {
    if (resuming) return;
    resuming = true;
    leaveAutosavePaused = false;
    try {
      while (!target.hidden && boundary) {
        const current = boundary, saved = checkpoint ?? saveCheckpoint();
        boundary = undefined; checkpoint = undefined;
        if (!backgroundPausedAutosave) pauseAutosave();
        options.resetFrameTime?.();
        let result: BackgroundResumeResult;
        try { result = await resumeOne(current, saved); }
        catch (error) { result = await fallback(errorMessage(error, t(SESSION_MESSAGES.background.resumeFailed))); }
        options.resetFrameTime?.();
        if (result === "handled") { leaveAutosavePaused = true; backgroundPausedAutosave = false; return; }
        if (result === "reloaded") return;
      }
    } finally {
      resuming = false;
      if (!target.hidden) {
        if (boundary && !leaveAutosavePaused) {
          queueMicrotask(() => { if (!target.hidden && boundary && !resuming) void run(); });
        } else if (!leaveAutosavePaused) {
          releaseAutosave();
        }
      }
    }
  };
  const change = () => {
    if (target.hidden) {
      rememberBoundary();
      if (!backgroundPausedAutosave) pauseAutosave();
      checkpoint ??= saveCheckpoint();
      return;
    }
    options.resetFrameTime?.();
    if (checkpoint || boundary) void run();
  };
  const pageHide = () => { rememberBoundary(); };
  const pageShow = () => {
    if (target.hidden) return;
    options.resetFrameTime?.();
    if (checkpoint || boundary) void run();
  };
  target.addEventListener("visibilitychange", change);
  page.addEventListener("pagehide", pageHide);
  page.addEventListener("pageshow", pageShow);
  return {
    dispose: () => {
      target.removeEventListener("visibilitychange", change);
      page.removeEventListener("pagehide", pageHide);
      page.removeEventListener("pageshow", pageShow);
    }
  };
};
