import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CapturedGame } from "../src/app/save-store/captured-game";
import {
  createSaveCoordinator, createTickBoundary, SAVE_DEBOUNCE_MS, type SaveReason
} from "../src/app/save-store/save-coordinator";
import { createSaveEventWatch, watchPageHide } from "../src/app/save-store/save-events";
import { createSaveStatus } from "../src/app/save-store/save-status";
import { bindSettlementSaving } from "../src/app/save-store/settlement-saving";
import { createHeldFrameJobs } from "../src/app/settlement/held-frame-jobs";
import { createSettlementSaveController } from "../src/app/settlement/settlement-save";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { createMemorySaveStore } from "./memory-save-store";

const MINUTE = 60_000;

/** A coordinator over a fake save: records reasons; `gate` holds a save open until released. */
const coordinated = (minutes = 0) => {
  const reasons: SaveReason[] = [];
  let release: (() => void) | null = null, holding = false, result = true;
  const saving = createSaveCoordinator({ minutes });
  saving.attach({
    betweenTicks: async () => undefined,
    save: async reason => {
      reasons.push(reason);
      if (holding) await new Promise<void>(resolve => { release = resolve; });
      return result;
    }
  });
  return {
    fail: () => { result = false; },
    hold: () => { holding = true; },
    reasons,
    release: () => { holding = false; release?.(); },
    saving
  };
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("save coordinator maximum dirty age (D-S6)", () => {
  /** A runner whose idle moment never comes (input never rests) and records its aborts. */
  const busyInput = (options: { maxDirtyAgeMinutes?: number } = {}) => {
    const reasons: SaveReason[] = [];
    let aborted = 0;
    const saving = createSaveCoordinator({ minutes: 2, ...options });
    saving.attach({
      betweenTicks: async () => undefined,
      idleMoment: signal => new Promise<void>(resolve => {
        signal?.addEventListener("abort", () => { aborted++; resolve(); }, { once: true });
      }),
      save: async reason => { reasons.push(reason); return true; }
    });
    return { aborted: () => aborted, reasons, saving };
  };

  it("keeps waiting for an idle moment before the limit and saves at the limit", async () => {
    const { aborted, reasons, saving } = busyInput();
    saving.markDirty();
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    await vi.advanceTimersByTimeAsync(7 * MINUTE);
    expect(reasons).toEqual([]);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(reasons).toEqual(["interval"]);
    expect(aborted()).toBe(1);
    saving.dispose();
  });

  it("counts the age from the first change, not from the latest one", async () => {
    const { reasons, saving } = busyInput();
    saving.markDirty();
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    for (let minute = 0; minute < 7; minute++) {
      saving.markDirty();
      await vi.advanceTimersByTimeAsync(MINUTE);
    }
    expect(reasons).toEqual([]);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(reasons).toEqual(["interval"]);
    saving.dispose();
  });

  it("can be switched off", async () => {
    const { reasons, saving } = busyInput({ maxDirtyAgeMinutes: 0 });
    saving.markDirty();
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(reasons).toEqual([]);
    saving.dispose();
  });
});

describe("save coordinator triggers", () => {
  it("allows only the current transition checkpoint while ordinary saves are suspended",async()=>{
    const { reasons,saving }=coordinated();
    saving.setSuspended(true);
    expect(await saving.flush("manual")).toBe(false);
    expect(await saving.flushTransition(()=>false)).toBe(false);
    expect(reasons).toEqual([]);
    expect(await saving.flushTransition(()=>true)).toBe(true);
    expect(reasons).toEqual(["manual"]);
    expect(await saving.flush("manual")).toBe(false);
    saving.dispose();
  });
  it("saves on the automatic interval only while the game changed", async () => {
    const { reasons, saving } = coordinated(1);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(reasons).toEqual([]);
    saving.markDirty();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(reasons).toEqual(["interval"]);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(reasons).toEqual(["interval"]);
    const off = coordinated(0);
    off.saving.markDirty();
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(off.reasons).toEqual([]);
  });

  it("coalesces key events inside the debounce window into one save", async () => {
    const { reasons, saving } = coordinated();
    saving.request();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS / 2);
    saving.request();
    saving.request();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS / 2);
    expect(reasons).toEqual(["event"]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);
    expect(reasons).toEqual(["event"]);
  });

  it("flushes on tab hide and close even with Autosave off; Save game always saves", async () => {
    const { reasons, saving } = coordinated(0);
    expect(await saving.flush("hidden")).toBe(false);
    saving.markDirty();
    expect(await saving.flush("hidden")).toBe(true);
    saving.markDirty();
    const target = new EventTarget();
    watchPageHide(saving, target as unknown as Window);
    target.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(await saving.flush("manual")).toBe(true);
    expect(reasons).toEqual(["hidden", "pagehide", "manual"]);
  });

  it("keeps the game dirty after a failed save so the next trigger retries", async () => {
    const { fail, reasons, saving } = coordinated();
    fail();
    saving.markDirty();
    expect(await saving.flush("logout")).toBe(false);
    expect(await saving.flush("logout")).toBe(false);
    expect(reasons).toEqual(["logout", "logout"]);
  });

  it("pauses events and intervals, and stops for good before a page handoff", async () => {
    const { reasons, saving } = coordinated(1);
    saving.setPaused(true);
    saving.request();
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(reasons).toEqual([]);
    saving.setPaused(false);
    saving.stop();
    saving.markDirty();
    expect(await saving.flush("pagehide")).toBe(false);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(reasons).toEqual([]);
  });
});

describe("save line", () => {
  it("reports a running save, then when it finished or that it failed", async () => {
    const status = createSaveStatus(), seen: boolean[] = [];
    status.subscribe(() => seen.push(status.getSnapshot().saving));
    let result = true;
    const saving = createSaveCoordinator({ minutes: 0, now: () => 4242, status });
    saving.attach({ betweenTicks: async () => undefined, save: async () => result });
    await saving.flush("manual");
    expect(seen).toEqual([true, false]);
    expect(status.getSnapshot()).toMatchObject({ failed: false, lastSavedAt: 4242, saving: false });
    result = false;
    await saving.flush("manual");
    expect(status.getSnapshot()).toMatchObject({ failed: true, lastSavedAt: 4242 });
  });
});

describe("single flight", () => {
  it("runs one follow-up save for every trigger that arrived during a save", async () => {
    const { hold, reasons, release, saving } = coordinated();
    hold();
    saving.markDirty();
    const first = saving.flush("manual");
    await vi.advanceTimersByTimeAsync(0);
    saving.markDirty();
    const second = saving.flush("hidden"), third = saving.flush("logout");
    expect(reasons).toEqual(["manual"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(await third).toBe(true);
    expect(reasons).toEqual(["manual", "logout"]);
  });
});

describe("hide checkpoint", () => {
  it("suspends checkpoints and explicit saves during a transition and preserves dirty state", async () => {
    const { reasons, saving } = coordinated();
    saving.markDirty();
    saving.setSuspended(true);
    expect(await saving.checkpoint("hidden")).toMatchObject({ ran: false });
    expect(await saving.flush("pagehide")).toBe(false);
    expect(await saving.flush("manual")).toBe(false);
    expect(reasons).toEqual([]);
    saving.setSuspended(false);
    expect(await saving.checkpoint("hidden")).toMatchObject({ ran: true, saved: true });
    expect(reasons).toEqual(["hidden"]);
  });

  it("drains an accepted write but suppresses its queued follow-up during a transition", async () => {
    const { hold, reasons, release, saving } = coordinated();
    hold();
    const first = saving.flush("manual");
    await vi.advanceTimersByTimeAsync(0);
    const follow = saving.flush("pagehide");
    saving.setSuspended(true);
    let settled = false;
    const draining = saving.whenIdle().then(() => settled = true);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    release();
    await first;
    await follow;
    await draining;
    expect(reasons).toEqual(["manual"]);
    expect(settled).toBe(true);
  });

  it("cancels an accepted save still waiting at the tick boundary when suspended", async () => {
    let release: () => void = () => undefined;
    const saving = createSaveCoordinator({ minutes: 0 });
    const save = vi.fn(async () => true);
    saving.attach({ betweenTicks: () => new Promise<void>(resolve => { release = resolve; }), save });
    const pending = saving.flush("manual");
    saving.setSuspended(true);
    release();
    expect(await pending).toBe(false);
    await saving.whenIdle();
    expect(save).not.toHaveBeenCalled();
  });

  it("distinguishes clean, saved and failed local writes", async () => {
    const clean = coordinated();
    expect(await clean.saving.checkpoint("hidden")).toEqual({ joined: false, ran: false, saved: false });
    const saved = coordinated();
    saved.saving.markDirty();
    expect(await saved.saving.checkpoint("hidden")).toEqual({ joined: false, ran: true, saved: true });
    const failed = coordinated();
    failed.fail();
    failed.saving.markDirty();
    expect(await failed.saving.checkpoint("hidden")).toEqual({ joined: false, ran: true, saved: false });
  });

  it("reports that it joined an in-flight save and waits for the follow-up", async () => {
    const { hold, reasons, release, saving } = coordinated();
    hold();
    saving.markDirty();
    const running = saving.flush("manual");
    await vi.advanceTimersByTimeAsync(0);
    saving.markDirty();
    const checkpoint = saving.checkpoint("hidden");
    expect(reasons).toEqual(["manual"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    release();
    expect(await running).toBe(true);
    expect(await checkpoint).toEqual({ joined: true, ran: true, saved: true });
    expect(reasons).toEqual(["manual", "hidden"]);
  });
});

describe("tick boundary", () => {
  it("captures in a held frame that does not tick, and without frames after the idle wait", async () => {
    const jobs = createHeldFrameJobs(() => false), ticks = createTickBoundary(jobs), order: string[] = [];
    const saving = createSaveCoordinator({ minutes: 0 });
    saving.attach({ betweenTicks: ticks.betweenTicks, save: async () => { order.push("capture"); return true; } });
    saving.markDirty();
    const pending = saving.flush("manual");
    await vi.advanceTimersByTimeAsync(10);
    expect(jobs.holding()).toBe(true);
    expect(jobs.frameSeconds(.02)).toBe(0);
    await pending;
    expect(order).toEqual(["capture"]);
    // The held frame's time is simulated in the next one.
    expect(jobs.frameSeconds(.02)).toBeCloseTo(.04);
    saving.markDirty();
    const idle = saving.flush("logout");
    await vi.advanceTimersByTimeAsync(250);
    expect(await idle).toBe(true);
    expect(order).toEqual(["capture", "capture"]);
    expect(jobs.holding()).toBe(false);
  });

  it("waits for an idle moment before interval and event saves, never before the player's own", async () => {
    let idle: () => void = () => undefined;
    const reasons: string[] = [];
    const saving = createSaveCoordinator({ minutes: 1 });
    saving.attach({ betweenTicks: async () => undefined,
      idleMoment: () => new Promise<void>(resolve => { idle = resolve; }),
      save: async reason => { reasons.push(reason); return true; } });
    saving.markDirty();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(reasons).toEqual([]);
    idle();
    await vi.advanceTimersByTimeAsync(0);
    expect(reasons).toEqual(["interval"]);
    expect(await saving.flush("manual")).toBe(true);
    expect(reasons).toEqual(["interval", "manual"]);
    saving.dispose();
  });

  it("does not wait for a tick when the tab hides or closes", async () => {
    const order: string[] = [];
    const saving = createSaveCoordinator({ minutes: 0 });
    saving.attach({ betweenTicks: () => new Promise(() => undefined),
      save: async reason => { order.push(reason); return true; } });
    saving.markDirty();
    expect(await saving.flush("hidden")).toBe(true);
    expect(order).toEqual(["hidden"]);
  });
});

describe("key events and the settlement binding", () => {
  const building = (construction: number, level = 0) =>
    ({ construction, workshopUpgrade: { level } }) as unknown as SettlementBuilding;

  it("sees finished constructions and upgrades, and ships sailing off or returning", () => {
    const watch = createSaveEventWatch();
    expect(watch([building(1)], [{ phase: "idle" }])).toBe(false);
    expect(watch([building(1)], [{ phase: "idle" }])).toBe(false);
    expect(watch([building(1), building(0.5)], [{ phase: "idle" }])).toBe(false);
    expect(watch([building(1), building(1)], [{ phase: "idle" }])).toBe(true);
    expect(watch([building(1, 1), building(1)], [{ phase: "idle" }])).toBe(true);
    expect(watch([building(1, 1), building(1)], [{ phase: "away" }])).toBe(true);
    expect(watch([building(1, 1), building(1)], [{ phase: "idle" }])).toBe(true);
    expect(watch([building(1, 1)], [{ phase: "idle" }])).toBe(false);
  });

  it("autosaves through the save controller without a status message", async () => {
    const { captures, store } = createMemorySaveStore(), notify = vi.fn();
    let savedAt = 0;
    const controller = createSettlementSaveController({
      captureGame: () => ({ save: [++savedAt] }) as unknown as CapturedGame,
      confirmImport: async () => true,
      captureSession: async () => ({ savedAt }) as unknown as GameSaveV1,
      notify, restoreSession: async () => ({ ok: true }), store
    });
    const saving = createSaveCoordinator({ minutes: 1 });
    const saves = bindSettlementSaving(saving, controller,
      { jobs: createHeldFrameJobs(() => false), page: new EventTarget() as unknown as Window });
    saves.afterTick(false);
    await vi.advanceTimersByTimeAsync(MINUTE + 300);
    expect(captures).toEqual([]);
    saves.afterTick(true);
    await vi.advanceTimersByTimeAsync(MINUTE);
    saves.afterTick(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(captures).toEqual([{ save: [1] }]);
    expect(notify).not.toHaveBeenCalled();
    saves.checkEvents([building(1)], []);
    saves.checkEvents([building(1), building(1)], []);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 300);
    expect(captures).toHaveLength(2);
    saves.stop();
  });
});
