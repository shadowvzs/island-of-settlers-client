import { describe, expect, it, vi } from "vitest";

import {
  createSessionLifecycle,
  type SessionToken,
  SessionTransitionCancelled,
  SessionTransitionReloadRequired
} from "../src/app/session-lifecycle";
import { createHeldFrameJobs } from "../src/app/settlement/held-frame-jobs";
import { guardCommandActions, guardPlayerActions } from "../src/app/settlement/settlement-ui-actions";

const deferred = <T>() => {
  let reject: (error: unknown) => void = () => undefined;
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

describe("session transition guard", () => {
  it("coalesces a repeated transition and refuses a competing destination", async () => {
    const lifecycle = createSessionLifecycle(), gate = deferred<string>();
    const run = vi.fn(() => gate.promise);
    const first = lifecycle.run({ key: "travel:7", run });
    const repeated = lifecycle.run({ key: "travel:7", run });
    const competing = lifecycle.run({ key: "travel:8", run });
    expect(run).toHaveBeenCalledTimes(1);
    expect(await competing).toEqual({ ok: false, reason: "busy" });
    gate.resolve("sailed");
    expect(await first).toEqual({ coalesced: false, ok: true, value: "sailed" });
    expect(await repeated).toEqual({ coalesced: true, ok: true, value: "sailed" });
    expect(lifecycle.generation()).toBe(1);
  });

  it("freezes at the start, stays frozen after a commit, and releases after a failure", async () => {
    const frozen = vi.fn(), lifecycle = createSessionLifecycle({ onFrozen: frozen });
    const failed = await lifecycle.run({ key: "import", run: async () => { throw new Error("bad file"); } });
    expect(failed).toMatchObject({ ok: false, reason: "failed" });
    expect(frozen.mock.calls).toEqual([[true, "import"], [false, "import"]]);
    expect(lifecycle.frozen()).toBe(false);
    const committed = await lifecycle.run({ key: "travel:7", run: async () => true });
    expect(committed).toMatchObject({ ok: true, value: true });
    expect(lifecycle.frozen()).toBe(true);
    lifecycle.dispose();
    expect(lifecycle.frozen()).toBe(false);
  });

  it("discards a late worker result after a newer session generation", async () => {
    const lifecycle = createSessionLifecycle(), gate = deferred<void>();
    let token: SessionToken | undefined;
    const pending = lifecycle.run({ key: "import", run: async current => {
      token = current;
      await gate.promise;
      return "staged";
    } });
    expect(token?.current()).toBe(true);
    lifecycle.activateSession();
    expect(token?.current()).toBe(false);
    gate.resolve();
    expect(await pending).toEqual({ ok: false, reason: "stale" });
    expect(lifecycle.frozen()).toBe(false);
  });

  it("keeps the committed generation and resumes the old session after a failed or cancelled transition", async () => {
    const lifecycle = createSessionLifecycle(), generation = lifecycle.generation();
    const failed = await lifecycle.run({ key: "travel:7", run: async () => {
      throw new Error("offline");
    } });
    expect(failed).toMatchObject({ error: new Error("offline"), ok: false, reason: "failed" });
    expect(lifecycle.generation()).toBe(generation);
    expect(lifecycle.frozen()).toBe(false);
    const cancelled = await lifecycle.run({ key: "travel:8", run: async () => {
      throw new SessionTransitionCancelled();
    } });
    expect(cancelled).toEqual({ ok: false, reason: "cancelled" });
    expect(lifecycle.generation()).toBe(generation);
    expect(lifecycle.frozen()).toBe(false);
    expect(lifecycle.busy()).toBe(false);
    const retried = await lifecycle.run({ key: "travel:7", run: async () => true });
    expect(retried).toMatchObject({ ok: true, value: true });
  });

  it("keeps the committed generation and releases the freeze for a retained tab resume", async () => {
    const frozen = vi.fn(), lifecycle = createSessionLifecycle({ onFrozen: frozen }), generation = lifecycle.generation();
    const resumed = await lifecycle.run({ key: "tab-resume", keepSession: true, run: async () => "resumed" });
    expect(resumed).toEqual({ coalesced: false, ok: true, value: "resumed" });
    expect(lifecycle.generation()).toBe(generation);
    expect(lifecycle.frozen()).toBe(false);
    expect(frozen.mock.calls).toEqual([[true, "tab-resume"], [false, "tab-resume"]]);
  });

  it("advances the generation and resumes commands after an in-page replacement", async () => {
    const frozen = vi.fn(), lifecycle = createSessionLifecycle({ onFrozen: frozen }), generation = lifecycle.generation();
    let token: SessionToken | undefined;
    const replaced = await lifecycle.run({ key: "travel:home", replaceSession: true, run: async current => {
      token = current;
      return "installed";
    } });
    expect(replaced).toEqual({ coalesced: false, ok: true, value: "installed" });
    expect(lifecycle.generation()).toBe(generation + 1);
    expect(lifecycle.frozen()).toBe(false);
    expect(token?.current()).toBe(false);
    expect(frozen.mock.calls).toEqual([[true, "travel:home"], [false, "travel:home"]]);
  });

  it("keeps the freeze and invalidates old work when a committed handoff requires reload", async () => {
    const lifecycle = createSessionLifecycle(), generation = lifecycle.generation();
    const result = await lifecycle.run({ key: "travel:7", replaceSession: true, run: async () => {
      throw new SessionTransitionReloadRequired();
    } });
    expect(result).toMatchObject({ ok: false, reason: "reload-required" });
    expect(lifecycle.generation()).toBe(generation + 1);
    expect(lifecycle.frozen()).toBe(true);
    expect(lifecycle.busy()).toBe(false);
    lifecycle.dispose();
    expect(lifecycle.frozen()).toBe(false);
  });

  it("disposes retained session owners once, newest first, even when one fails", () => {
    const lifecycle = createSessionLifecycle(), calls: string[] = [];
    lifecycle.retain(() => calls.push("background"));
    lifecycle.retain(() => { throw new Error("cloud unmount failed"); });
    lifecycle.retain(() => calls.push("latest"));
    lifecycle.dispose();
    lifecycle.dispose();
    expect(calls).toEqual(["latest", "background"]);
    expect(lifecycle.frozen()).toBe(false);
  });

  it("keeps page owners across an island teardown and releases both tiers on page exit", () => {
    const lifecycle = createSessionLifecycle(), calls: string[] = [];
    lifecycle.retainIsland(() => calls.push("old island"));
    lifecycle.retainPage(() => calls.push("page cloud"));
    lifecycle.retainIsland(() => calls.push("new island"));
    lifecycle.disposeIsland();
    expect(calls).toEqual(["new island", "old island"]);
    lifecycle.disposeIsland();
    expect(calls).toEqual(["new island", "old island"]);
    lifecycle.dispose();
    expect(calls).toEqual(["new island", "old island", "page cloud"]);
  });
});

describe("frozen settlement commands", () => {
  it("refuses new commands, keeps queries available and resumes when the freeze ends", () => {
    let canCommand = false;
    const demolish = vi.fn(() => true), start = guardCommandActions({
      onDemolishBuilding: (_uid: number) => demolish(),
      onExpeditionTargets: (_source: number) => [{ rotation: 0, x: 1, z: 2 }],
      onStartColony: (_source: number, _island: number, _troops: unknown) => true as const
    }, () => canCommand);
    expect(start.onDemolishBuilding?.(1)).toBe(false);
    expect(demolish).not.toHaveBeenCalled();
    expect(start.onExpeditionTargets?.(1)).toEqual([]);
    expect(start.onStartColony?.(1, 2, { archer: 0, heavy: 0, shield: 0 })).toMatch(/island is changing/);
    canCommand = true;
    expect(start.onDemolishBuilding?.(1)).toBe(true);
    expect(start.onExpeditionTargets?.(1)).toEqual([{ rotation: 0, x: 1, z: 2 }]);
  });

  it("holds colony travel and quest claims while leaving window focus available", () => {
    const visit = vi.fn(), player = guardPlayerActions({
      onCompleteQuest: (_id: string) => true as const,
      onShowTutorial: (_id: string) => undefined,
      onVisitColony: (id: number) => { visit(id); }
    }, () => false);
    player.onVisitColony?.(7);
    expect(visit).not.toHaveBeenCalled();
    expect(player.onCompleteQuest?.("quest")).toMatch(/island is changing/);
    player.onShowTutorial?.("quest");
  });
});

describe("held frame hold", () => {
  it("freezes time at the boundary and carries it into the next released frame", () => {
    const jobs = createHeldFrameJobs(() => false), release = jobs.hold();
    expect(jobs.holding()).toBe(true);
    expect(jobs.frameSeconds(0.02)).toBe(0);
    expect(jobs.frameSeconds(0.03)).toBe(0);
    release();
    expect(jobs.holding()).toBe(false);
    expect(jobs.frameSeconds(0.02)).toBeCloseTo(0.07);
    release();
    expect(jobs.frameSeconds(0.01)).toBeCloseTo(0.01);
  });

  it("forgets held time already replayed by a tab-resume catch-up", () => {
    const jobs = createHeldFrameJobs(() => false), release = jobs.hold();
    expect(jobs.frameSeconds(0.05)).toBe(0);
    jobs.discardHeldTime();
    release();
    expect(jobs.frameSeconds(0.02)).toBeCloseTo(0.02);
  });
});
