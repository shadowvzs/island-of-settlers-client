import { describe, expect, it, vi } from "vitest";

import type { SaveCheckpoint } from "../src/app/save-store/save-coordinator";
import {
  decideTabResume, hiddenSecondsBetween, reconcileHiddenTime, sameTabResumeContext,
  TAB_RESUME_MAX_LIVE_SECONDS, type TabResumeAuthority, type TabResumeContext, tabResumeSaveState,
  usesSavedTabResumeHandoff
} from "../src/app/settlement/tab-resume";

const SAVED: SaveCheckpoint = { joined: false, ran: true, saved: true };
const CLEAN: SaveCheckpoint = { joined: false, ran: false, saved: false };
const FAILED: SaveCheckpoint = { error: new Error("write failed"), joined: false, ran: true, saved: false };
const ACCOUNT: TabResumeAuthority = { kind: "account", lease: "current", revision: "current", upload: "confirmed" };
const BROWSER: TabResumeAuthority = { kind: "browser" };
const CONTEXT: TabResumeContext = {
  accountId: "a1", generation: 2, islandId: 7, location: "account", slotId: "slot-1", worldSeed: 42
};

describe("hide boundary", () => {
  it("never awards time when the clock is missing or moves backwards", () => {
    expect(hiddenSecondsBetween(1_000, 3_500)).toBe(2.5);
    expect(hiddenSecondsBetween(3_500, 1_000)).toBe(0);
    expect(hiddenSecondsBetween(Number.NaN, 1_000)).toBe(0);
    expect(hiddenSecondsBetween(1_000, Number.NaN)).toBe(0);
  });

  it("replays the interval once in bounded chunks without losing or duplicating time", async () => {
    const chunks: number[] = [], clock: number[] = [];
    const result = await reconcileHiddenTime(2.4, seconds => { chunks.push(seconds); },
      { advanceClock: seconds => { clock.push(seconds); } });
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe(1); expect(chunks[1]).toBe(1); expect(chunks[2]).toBeCloseTo(0.4);
    expect(result).toEqual({ appliedSeconds: 2.4, skippedSeconds: 0 });
    expect(clock).toEqual([]);
    expect(chunks.reduce((sum, seconds) => sum + seconds, 0)).toBeCloseTo(2.4);
  });

  it("parks time beyond the catch-up cap on the clock instead of simulating it", async () => {
    const chunks: number[] = [], clock: number[] = [];
    const result = await reconcileHiddenTime(8, seconds => { chunks.push(seconds); },
      { advanceClock: seconds => { clock.push(seconds); }, capSeconds: 5, maxChunkSeconds: 2 });
    expect(chunks).toEqual([2, 2, 1]);
    expect(result).toEqual({ appliedSeconds: 5, skippedSeconds: 3 });
    expect(clock).toEqual([3]);
  });

  it("treats a missing or past interval as nothing", async () => {
    const apply = vi.fn();
    expect(await reconcileHiddenTime(Number.NaN, apply)).toEqual({ appliedSeconds: 0, skippedSeconds: 0 });
    expect(await reconcileHiddenTime(-2, apply)).toEqual({ appliedSeconds: 0, skippedSeconds: 0 });
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("session identity", () => {
  it("requires the same account, generation, island, store and seed", () => {
    expect(sameTabResumeContext(CONTEXT, { ...CONTEXT })).toBe(true);
    const changed: Partial<TabResumeContext>[] = [
      { accountId: "a2" }, { generation: 3 }, { islandId: null }, { location: "browser" },
      { slotId: "slot-2" }, { worldSeed: 43 }
    ];
    for (const change of changed) expect(sameTabResumeContext(CONTEXT, { ...CONTEXT, ...change })).toBe(false);
  });
});

describe("checkpoint classification", () => {
  it("distinguishes clean, saved, in-flight, pending cloud upload and failed", () => {
    expect(tabResumeSaveState(CLEAN, false)).toBe("clean");
    expect(tabResumeSaveState(SAVED, false)).toBe("saved");
    expect(tabResumeSaveState({ ...SAVED, joined: true }, false)).toBe("in-flight");
    expect(tabResumeSaveState(SAVED, true)).toBe("pending-upload");
    expect(tabResumeSaveState(FAILED, false)).toBe("failed");
    expect(tabResumeSaveState({ ...FAILED, joined: true }, false)).toBe("failed");
    expect(tabResumeSaveState({ ...CLEAN, joined: true }, true)).toBe("clean");
  });
});

describe("retained versus reload", () => {
  const decide = (overrides: Partial<Parameters<typeof decideTabResume>[0]> = {}) => decideTabResume({
    authority: BROWSER, contextChanged: false, hiddenSeconds: 5, save: SAVED, supported: true, ...overrides
  });

  it("retains a brief browser session for clean, failed and pending saves", () => {
    expect(decide({ save: CLEAN })).toEqual({
      cappedSeconds: 5, hiddenSeconds: 5, mode: "retained", save: "clean"
    });
    expect(decide({ save: FAILED })).toMatchObject({ mode: "retained", save: "failed" });
    expect(decide({ authority: { ...ACCOUNT, upload: "pending" } }))
      .toMatchObject({ mode: "retained", save: "pending-upload" });
    expect(decide({ hiddenSeconds: 0 })).toMatchObject({ mode: "retained", hiddenSeconds: 0 });
  });

  it("retains a current account session only with a live lease and unchanged revision", () => {
    expect(decide({ authority: ACCOUNT, hiddenSeconds: TAB_RESUME_MAX_LIVE_SECONDS }))
      .toMatchObject({ mode: "retained" });
    expect(decide({ authority: ACCOUNT, hiddenSeconds: TAB_RESUME_MAX_LIVE_SECONDS + 1 }))
      .toMatchObject({ mode: "reload", reason: "long-absence" });
  });

  it("reloads when authority is lost or a newer snapshot exists, regardless of duration", () => {
    expect(decide({ authority: { ...ACCOUNT, lease: "lost" }, hiddenSeconds: 0 }))
      .toMatchObject({ mode: "reload", reason: "lease-lost" });
    expect(decide({ authority: { ...ACCOUNT, lease: "unknown" }, hiddenSeconds: 1 }))
      .toMatchObject({ mode: "reload", reason: "lease-unknown" });
    expect(decide({ authority: { ...ACCOUNT, revision: "newer" }, hiddenSeconds: 1 }))
      .toMatchObject({ mode: "reload", reason: "newer-snapshot" });
    expect(decide({ authority: { ...ACCOUNT, revision: "unknown" }, hiddenSeconds: 1 }))
      .toMatchObject({ mode: "reload", reason: "revision-unknown" });
  });

  it("reloads a changed session/island and a timeline the retained path cannot own", () => {
    expect(decide({ contextChanged: true })).toMatchObject({ mode: "reload", reason: "session-changed" });
    expect(decide({ supported: false })).toMatchObject({ mode: "reload", reason: "unsupported" });
  });

  it("uses the saved in-page destination only for safe long/archived reload reasons", () => {
    const long = decide({ authority: ACCOUNT, hiddenSeconds: TAB_RESUME_MAX_LIVE_SECONDS + 1 });
    const archived = decide({ supported: false });
    expect(usesSavedTabResumeHandoff({ authoritySafe: true, decision: long, handoffEnabled: true })).toBe(true);
    expect(usesSavedTabResumeHandoff({ authoritySafe: true, decision: archived, handoffEnabled: true })).toBe(true);
    expect(usesSavedTabResumeHandoff({ authoritySafe: false, decision: long, handoffEnabled: true })).toBe(false);
    expect(usesSavedTabResumeHandoff({ authoritySafe: true, decision: long, handoffEnabled: false })).toBe(false);
    expect(usesSavedTabResumeHandoff({
      authoritySafe: true, decision: decide({ authority: { ...ACCOUNT, lease: "lost" } }), handoffEnabled: true
    })).toBe(false);
  });
});
