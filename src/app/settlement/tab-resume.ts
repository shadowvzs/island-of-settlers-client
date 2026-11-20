import { OFFLINE_CATCH_UP_CAP_SECONDS } from "../../shared/balance/offline";
import type { SaveCheckpoint } from "../save-store/save-coordinator";

/** The page session a retained tab resume belongs to. */
export interface TabResumeContext {
  /** The signed-in account, or null for guest/browser play. */
  accountId: string | null;
  /** The page's session generation; a replacement hands the job back to the reload path. */
  generation: number;
  /** The island on screen (colony/adventure id, null at home). */
  islandId: number | null;
  location: "account" | "browser";
  /** The cloud save slot, or null for the browser save. */
  slotId: string | null;
  worldSeed: number;
}

/** Whether the visible page is still the session that recorded the hide boundary. */
export const sameTabResumeContext = (left: TabResumeContext, right: TabResumeContext) =>
  left.accountId === right.accountId && left.generation === right.generation &&
  left.islandId === right.islandId && left.location === right.location &&
  left.slotId === right.slotId && left.worldSeed === right.worldSeed;

/** Whole real seconds elapsed since the hide boundary; a backward clock never awards time. */
export const hiddenSecondsBetween = (gameNow: number, now: number) =>
  Number.isFinite(gameNow) && Number.isFinite(now) ? Math.max(0, (now - gameNow) / 1000) : 0;

export interface HiddenReconcileResult {
  /** Exact game seconds replayed by `apply` (never more than the catch-up cap). */
  appliedSeconds: number;
  /** Seconds beyond the cap: only the clock advances, matching the reload reference. */
  skippedSeconds: number;
}

/**
 * Replays a hidden interval once, in bounded chunks. The callback owns the simulation lane; time
 * beyond the cap is parked on the clock, never silently dropped and never simulated twice.
 */
export const reconcileHiddenTime = async (
  seconds: number,
  apply: (seconds: number) => void,
  options: {
    advanceClock?: (seconds: number) => void;
    capSeconds?: number;
    maxChunkSeconds?: number;
    yieldEveryMs?: number;
  } = {}
): Promise<HiddenReconcileResult> => {
  const requested = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const applied = Math.min(requested, options.capSeconds ?? OFFLINE_CATCH_UP_CAP_SECONDS);
  const maxChunk = Math.max(1e-6, options.maxChunkSeconds ?? 1);
  const yieldEveryMs = options.yieldEveryMs ?? 50;
  let remaining = applied, sliceAt = performance.now();
  while (remaining > 1e-9) {
    const chunk = Math.min(maxChunk, remaining);
    apply(chunk);
    remaining -= chunk;
    if (performance.now() - sliceAt < yieldEveryMs) continue;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    sliceAt = performance.now();
  }
  const skipped = requested - applied;
  if (skipped > 0) options.advanceClock?.(skipped);
  return { appliedSeconds: applied, skippedSeconds: skipped };
};

/**
 * A retained tab return under a catch-up skip (offline mode or a map skip, plan §10, rev I10): the hidden interval is
 * not simulated and game time moves to the hide boundary plus it, without ticks. A reopened tab reloads the skipped
 * save at the same time, so both end in the same state. Whole milliseconds, as every session clock reads.
 */
export const skipHiddenTime = (
  seconds: number, clock: { gameNow(): number; rebaseClock(time: number): void }
): HiddenReconcileResult => {
  const skipped = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  clock.rebaseClock(Math.round(clock.gameNow() + skipped * 1000));
  return { appliedSeconds: 0, skippedSeconds: skipped };
};

/**
 * The correctness checks for a retained resume, in order: session/island identity, lease, authoritative
 * revision. Duration only chooses the catch-up strategy after those pass; it is never a safety gate.
 * A browser save is its own authority; an account follows the server revision and lease.
 */
export type TabResumeAuthority =
  | { kind: "browser" }
  | {
    kind: "account";
    lease: "current" | "lost" | "unknown";
    revision: "current" | "newer" | "unknown";
    upload: "confirmed" | "failed" | "none" | "pending";
  };

export type TabResumeSaveState = "clean" | "failed" | "in-flight" | "pending-upload" | "saved";

/** The background checkpoint classification shown to the resume decision and its tests. */
export const tabResumeSaveState = (save: SaveCheckpoint, pendingUpload: boolean): TabResumeSaveState => {
  if (!save.ran) return "clean";
  if (!save.saved) return "failed";
  if (save.joined) return "in-flight";
  return pendingUpload ? "pending-upload" : "saved";
};

export type TabResumeReloadReason =
  | "lease-lost"
  | "lease-unknown"
  | "long-absence"
  | "newer-snapshot"
  | "revision-unknown"
  | "session-changed"
  | "unsupported";

export type TabResumeDecision =
  | { cappedSeconds: number; hiddenSeconds: number; mode: "retained"; save: TabResumeSaveState }
  | { mode: "reload"; reason: TabResumeReloadReason; save: TabResumeSaveState };

export interface TabResumeInput {
  authority: TabResumeAuthority;
  /** The session/island identity changed while hidden. */
  contextChanged: boolean;
  hiddenSeconds: number;
  /**
   * The longest hidden interval the retained exact-tick path may replay. Longer intervals use the
   * existing reload/catch-up reference (performance strategy, after every correctness check).
   */
  maxLiveSeconds?: number;
  save: SaveCheckpoint;
  /** The retained path can own the whole current timeline (no archived island needs the worker replay). */
  supported: boolean;
}

/** About half a minute of exact fixed ticks: bounded, and short enough for a responsive tab return. */
export const TAB_RESUME_MAX_LIVE_SECONDS = 30;

/** Long or archived returns use the saved-destination handoff when authority is still safe. */
export const usesSavedTabResumeHandoff = (input: {
  authoritySafe: boolean;
  decision: TabResumeDecision;
  handoffEnabled: boolean;
}) =>
  input.handoffEnabled && input.authoritySafe && input.decision.mode === "reload" &&
  (input.decision.reason === "long-absence" || input.decision.reason === "unsupported");

export const decideTabResume = (input: TabResumeInput): TabResumeDecision => {
  const {
    authority, contextChanged, hiddenSeconds, maxLiveSeconds = TAB_RESUME_MAX_LIVE_SECONDS, save, supported
  } = input;
  const seconds = Math.max(0, hiddenSeconds);
  const pendingUpload = authority.kind === "account" && authority.upload === "pending";
  const saveState = tabResumeSaveState(save, pendingUpload);
  if (!supported) return { mode: "reload", reason: "unsupported", save: saveState };
  if (contextChanged) return { mode: "reload", reason: "session-changed", save: saveState };
  if (authority.kind === "account") {
    if (authority.lease === "lost") return { mode: "reload", reason: "lease-lost", save: saveState };
    if (authority.lease === "unknown") return { mode: "reload", reason: "lease-unknown", save: saveState };
    if (authority.revision === "newer") return { mode: "reload", reason: "newer-snapshot", save: saveState };
    if (authority.revision === "unknown") return { mode: "reload", reason: "revision-unknown", save: saveState };
  }
  if (seconds > maxLiveSeconds) return { mode: "reload", reason: "long-absence", save: saveState };
  return {
    cappedSeconds: Math.min(seconds, OFFLINE_CATCH_UP_CAP_SECONDS),
    hiddenSeconds: seconds,
    mode: "retained",
    save: saveState
  };
};
