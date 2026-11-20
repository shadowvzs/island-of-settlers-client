import { describe, expect, it, vi } from "vitest";

import { createHandoffReceipt } from "../src/app/handoff-receipt";
import {
  createIslandHandoff,
  type IslandDestination,
  type IslandHandoffServices
} from "../src/app/island-handoff";
import { createSessionLifecycle } from "../src/app/session-lifecycle";
import type { IslandHandoffTrigger } from "../src/app/settlement/island-handoff-policy";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";

interface Session {
  id: string;
}
interface Prepared {
  id: string;
}

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

const saved = (targetKey = "home"): IslandDestination => ({
  kind: "saved", payload: {} as GameSaveV1, targetKey
});

const setup = () => {
  let current: Session | null = { id: "old" };
  const calls: string[] = [];
  const transition = createSessionLifecycle();
  const receipt = createHandoffReceipt();
  const services: IslandHandoffServices<Prepared, Session> = {
    captureDeparture: vi.fn(async () => {
      calls.push("capture");
      return {} as GameSaveV1;
    }),
    commitDestination: vi.fn(async prepared => { calls.push(`commit:${prepared.id}`); }),
    complete: vi.fn(async () => { calls.push("complete"); }),
    current: () => current,
    dispose: vi.fn(async session => { calls.push(`dispose:${session.id}`); }),
    hideLoading: vi.fn(),
    install: vi.fn(async prepared => {
      calls.push(`install:${prepared.id}`);
      current = { id: prepared.id };
      return current;
    }),
    matches: vi.fn(() => true),
    prepare: vi.fn(async destination => {
      calls.push("prepare");
      return { id: destination.targetKey };
    }),
    receipt,
    sampleResources: vi.fn(() => ({ renderers: 1, workers: 2 })),
    settle: vi.fn(async () => { calls.push("settle"); }),
    showLoading: vi.fn(async () => { calls.push("show-loading"); }),
    transition,
    writeDeparture: vi.fn(async () => { calls.push("write-departure"); })
  };
  return {
    calls,
    get current() { return current; },
    handoff: createIslandHandoff(services),
    receipt,
    services,
    transition
  };
};

const request = (overrides: Partial<{
  destination: IslandDestination;
  key: string;
  saveDeparture: boolean;
  trigger: IslandHandoffTrigger;
}> = {}) => ({
  destination: saved(),
  key: "travel:home",
  saveDeparture: true,
  trigger: "travel-home" as const,
  ...overrides
});

describe("island handoff ordering", () => {
  it("settles, writes the departure, prepares, commits, disposes and installs in order", async () => {
    const harness = setup();
    const result = await harness.handoff.replace(request());
    expect(result).toMatchObject({
      coalesced: false, ok: true, prepared: { id: "home" }, session: { id: "home" }
    });
    expect(harness.calls).toEqual([
      "show-loading", "settle", "capture", "write-departure", "prepare", "commit:home",
      "dispose:old", "install:home", "complete"
    ]);
    expect(harness.services.showLoading).toHaveBeenCalledOnce();
    expect(harness.services.hideLoading).toHaveBeenCalledOnce();
    expect(harness.current).toEqual({ id: "home" });
    expect(harness.transition.frozen()).toBe(false);
    expect(harness.transition.generation()).toBe(1);
    expect(harness.receipt.snapshot().phases.map(phase => phase.phase)).toEqual([
      "freeze", "settle", "departure-capture", "departure-write", "prepare",
      "destination-commit", "dispose", "install", "activate"
    ]);
  });

  it("keeps the old island when departure or preparation fails before commit", async () => {
    const harness = setup();
    harness.services.prepare = vi.fn(async () => { throw new Error("offline"); });
    const result = await harness.handoff.replace(request());
    expect(result).toMatchObject({ error: new Error("offline"), ok: false, reason: "failed" });
    expect(harness.current).toEqual({ id: "old" });
    expect(harness.services.commitDestination).not.toHaveBeenCalled();
    expect(harness.services.dispose).not.toHaveBeenCalled();
    expect(harness.services.install).not.toHaveBeenCalled();
    expect(harness.transition.frozen()).toBe(false);
    expect(harness.transition.generation()).toBe(0);
    expect(harness.receipt.snapshot().phases.at(-1)?.phase).toBe("resume-old");
    expect(harness.services.showLoading).toHaveBeenCalledOnce();
    expect(harness.services.hideLoading).toHaveBeenCalledOnce();

    const writeFailure = setup();
    writeFailure.services.writeDeparture = vi.fn(async () => { throw new Error("disk full"); });
    const failedWrite = await writeFailure.handoff.replace(request());
    expect(failedWrite).toMatchObject({ ok: false, reason: "failed" });
    expect(writeFailure.services.prepare).not.toHaveBeenCalled();
    expect(writeFailure.current).toEqual({ id: "old" });
  });

  it("keeps the old island when destination commit itself fails", async () => {
    const harness = setup();
    harness.services.commitDestination = vi.fn(async () => { throw new Error("validation failed"); });
    const result = await harness.handoff.replace(request());
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(harness.current).toEqual({ id: "old" });
    expect(harness.services.dispose).not.toHaveBeenCalled();
    expect(harness.services.install).not.toHaveBeenCalled();
    expect(harness.transition.frozen()).toBe(false);
  });

  it("requires a reload, not the old island, after a committed teardown/install failure", async () => {
    for (const stage of ["complete", "dispose", "install"] as const) {
      const harness = setup();
      if (stage === "complete")
        harness.services.complete = vi.fn(async () => { throw new Error("cleanup failed"); });
      else if (stage === "dispose")
        harness.services.dispose = vi.fn(async () => { throw new Error("teardown failed"); });
      else harness.services.install = vi.fn(async () => { throw new Error("install failed"); });
      const result = await harness.handoff.replace(request());
      expect(result).toMatchObject({ ok: false, reason: "reload-required" });
      expect(harness.services.commitDestination).toHaveBeenCalledOnce();
      expect(harness.current).toEqual({ id: stage === "complete" ? "home" : "old" });
      expect(harness.transition.frozen()).toBe(true);
      expect(harness.transition.generation()).toBe(1);
      expect(harness.receipt.snapshot().phases.at(-1)?.phase).toBe("reload-required");
      expect(harness.services.showLoading).toHaveBeenCalledOnce();
      expect(harness.services.hideLoading).not.toHaveBeenCalled();
    }
  });

  it("does not resume the old island when the caught-up destination no longer matches", async () => {
    const harness = setup();
    harness.services.matches = vi.fn(() => false);
    const result = await harness.handoff.replace(request());
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(harness.services.commitDestination).not.toHaveBeenCalled();
    expect(harness.current).toEqual({ id: "old" });
    expect(harness.transition.frozen()).toBe(false);
  });

  it("skips departure capture for import/new destinations and accepts editor loads", async () => {
    const harness = setup();
    const imported = await harness.handoff.replace(request({
      destination: { kind: "import", targetKey: "import", value: {} },
      key: "import",
      saveDeparture: false,
      trigger: "travel-home"
    }));
    expect(imported).toMatchObject({ ok: true });
    expect(harness.services.captureDeparture).not.toHaveBeenCalled();
    expect(harness.services.writeDeparture).not.toHaveBeenCalled();

    const editor = setup();
    const result = await editor.handoff.replace(request({ trigger: "editor-map-load" }));
    expect(result).toMatchObject({ ok: true });
    expect(editor.services.prepare).toHaveBeenCalledOnce();
  });

  it("records a start and an end resource sample for every committed handoff", async () => {
    const harness = setup();
    await harness.handoff.replace(request());
    await harness.handoff.replace(request({ key: "travel:home-2" }));
    const samples = harness.receipt.snapshot().samples;
    expect(samples).toHaveLength(4);
    expect(samples.map(sample => ({ renderers: sample.renderers, workers: sample.workers }))).toEqual([
      { renderers: 1, workers: 2 },
      { renderers: 1, workers: 2 },
      { renderers: 1, workers: 2 },
      { renderers: 1, workers: 2 }
    ]);
  });

  it("coalesces the same destination and refuses a competing one while preparing", async () => {
    const harness = setup();
    const gate = deferred<Prepared>();
    harness.services.prepare = vi.fn(() => gate.promise);
    const first = harness.handoff.replace(request());
    const repeated = harness.handoff.replace(request());
    const competing = await harness.handoff.replace(request({ key: "travel:9", destination: saved("9") }));
    expect(competing).toMatchObject({ ok: false, reason: "busy" });
    gate.resolve({ id: "home" });
    expect(await first).toMatchObject({ coalesced: false, ok: true });
    expect(await repeated).toMatchObject({ coalesced: true, ok: true });
    expect(harness.services.commitDestination).toHaveBeenCalledOnce();
    expect(harness.services.showLoading).toHaveBeenCalledOnce();
    expect(harness.services.hideLoading).toHaveBeenCalledOnce();
  });
});
