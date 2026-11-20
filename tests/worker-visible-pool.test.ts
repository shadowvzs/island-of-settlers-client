import { describe, expect, it, vi } from "vitest";

import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createVisibleWorkerPool } from "../src/render-common/workers/worker-visible-pool";

const frame = (id: number, visible = true) => ({
  actorId: id, nation: "roman", variant: "man", visible
}) as WorkerFrame;
const member = () => ({ dispose: vi.fn(), setColor: vi.fn(), update: vi.fn() });

it("loads only visible bodies and releases their models when stored", async () => {
  const model = member();
  const load = vi.fn(async () => model);
  const attach = vi.fn();
  const pool = createVisibleWorkerPool({ load, attach, onError: vi.fn() });
  pool.update(Array.from({ length: 100 }, (_, i) => frame(i, false)));
  expect(load).not.toHaveBeenCalled();
  const visible = frame(10099);
  pool.update([visible]);
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(1);
  expect(attach).toHaveBeenCalledWith(model);
  expect(pool.stats()).toEqual({ active: 1, pending: 0, retained: 0 });
  pool.update([]);
  expect(model.dispose).toHaveBeenCalledTimes(1);
  expect(pool.stats()).toEqual({ active: 0, pending: 0, retained: 0 });
});

it("disposes late arrivals without resurrecting a stored actor", async () => {
  let finish!: (value: ReturnType<typeof member>) => void;
  const attach = vi.fn();
  const pool = createVisibleWorkerPool({
    load: () => new Promise(resolve => { finish = resolve; }), attach, onError: vi.fn()
  });
  pool.update([frame(1)]);
  pool.update([]);
  const model = member();
  finish(model);
  await Promise.resolve();
  expect(attach).not.toHaveBeenCalled();
  expect(model.dispose).toHaveBeenCalledTimes(1);
});

it("preserves stable identities through compact frame reordering and appearance changes", async () => {
  const models = [member(), member(), member()];
  let next = 0;
  const pool = createVisibleWorkerPool({
    load: async () => models[next++]!, attach: vi.fn(), onError: vi.fn()
  });
  pool.setColor("#123456");
  pool.update([frame(10), frame(20)]);
  await Promise.resolve();
  pool.update([frame(20), frame(10)]);
  expect(next).toBe(2);
  expect(models[0]!.setColor).toHaveBeenCalledWith("#123456");
  pool.update([{ ...frame(10), variant: "woman" }, frame(20)]);
  await Promise.resolve();
  expect(models[0]!.dispose).toHaveBeenCalledTimes(1);
  expect(next).toBe(3);
  pool.dispose();
  expect(models[1]!.dispose).toHaveBeenCalledTimes(1);
  expect(models[2]!.dispose).toHaveBeenCalledTimes(1);
});

it("forwards a camera-jump refresh to every loaded body (C11)", async () => {
  const loaded = { ...member(), refreshDetail: vi.fn() };
  const pool = createVisibleWorkerPool({
    load: async () => loaded, attach: vi.fn(), onError: vi.fn()
  });
  pool.update([frame(1)]);
  await Promise.resolve();
  pool.refreshDetail();
  expect(loaded.refreshDetail).toHaveBeenCalledTimes(1);
  pool.dispose();
});

it("waits for visible replacement bodies before declaring the crowd ready", async () => {
  let finish!: (value: ReturnType<typeof member>) => void;
  const pool = createVisibleWorkerPool({
    load: () => new Promise(resolve => { finish = resolve; }), attach: vi.fn(), onError: vi.fn()
  });
  pool.update([frame(1)]);
  let ready = false;
  const waiting = pool.whenReady().then(() => { ready = true; });
  await Promise.resolve();
  expect(ready).toBe(false);
  finish(member());
  await waiting;
  expect(ready).toBe(true);
  expect(pool.stats()).toEqual({ active: 1, pending: 0, retained: 0 });
  pool.dispose();
});

describe("C02 (c) parked body free list", () => {
  it("reuses the same body when a stored actor becomes visible again", async () => {
    const model = member();
    const attach = vi.fn();
    const retain = vi.fn();
    const load = vi.fn(async () => model);
    const pool = createVisibleWorkerPool({ attach, load, onError: vi.fn(), retain });
    pool.update([frame(1)]);
    await pool.whenReady();
    pool.update([]);
    expect(retain).toHaveBeenCalledWith(model);
    expect(model.dispose).not.toHaveBeenCalled();
    expect(pool.stats()).toEqual({ active: 0, pending: 0, retained: 1 });

    const returning = frame(2);
    pool.update([returning]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledTimes(2);
    expect(model.update).toHaveBeenLastCalledWith(returning);
    expect(pool.stats()).toEqual({ active: 1, pending: 0, retained: 0 });

    pool.setColor("#123456");
    expect(model.setColor).toHaveBeenLastCalledWith("#123456");
    pool.dispose();
    expect(model.dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps the free list bounded per appearance and disposes the rest", async () => {
    const models = [member(), member()];
    let next = 0;
    const pool = createVisibleWorkerPool({
      attach: vi.fn(), load: async () => models[next++]!, maxRetainedPerAppearance: 1,
      onError: vi.fn(), retain: vi.fn()
    });
    pool.update([frame(1), frame(2)]);
    await pool.whenReady();
    pool.update([]);
    expect(pool.stats()).toMatchObject({ retained: 1 });
    expect(models[0]!.dispose).not.toHaveBeenCalled();
    expect(models[1]!.dispose).toHaveBeenCalledTimes(1);
    pool.dispose();
    expect(models[0]!.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a parked body for another appearance", async () => {
    const load = vi.fn(async () => member());
    const pool = createVisibleWorkerPool({
      attach: vi.fn(), load, onError: vi.fn(), retain: vi.fn()
    });
    pool.update([frame(1)]);
    await pool.whenReady();
    pool.update([]);
    pool.update([{ ...frame(2), variant: "woman" }]);
    await pool.whenReady();
    expect(load).toHaveBeenCalledTimes(2);
    pool.dispose();
  });

  it("does not let a stale in-flight load replace a resumed parked body", async () => {
    const parked = member();
    const stale = member();
    let finishStale!: (value: ReturnType<typeof member>) => void;
    const staleLoad = new Promise<ReturnType<typeof member>>(resolve => { finishStale = resolve; });
    const load = vi.fn(async (next: WorkerFrame) => next.variant === "alpha" ? staleLoad : parked);
    const pool = createVisibleWorkerPool({
      attach: vi.fn(), load, onError: vi.fn(), retain: vi.fn()
    });
    // Park a beta body, then ask actor 1 for alpha (still loading) and switch it to beta.
    pool.update([{ ...frame(2), variant: "beta" }]);
    await pool.whenReady();
    pool.update([]);
    expect(pool.stats()).toMatchObject({ active: 0, retained: 1 });
    pool.update([{ ...frame(1), variant: "alpha" }]);
    pool.update([{ ...frame(1), variant: "beta" }]);
    expect(pool.stats().active).toBe(1);
    finishStale(stale);
    await pool.whenReady();
    expect(stale.dispose).toHaveBeenCalledTimes(1);
    expect(pool.get(1)).toBe(parked);
    pool.dispose();
  });

  it("plateaus after 20 in/out cycles: one load and one parked body", async () => {
    const model = member();
    const attach = vi.fn();
    const load = vi.fn(async () => model);
    const pool = createVisibleWorkerPool({ attach, load, onError: vi.fn(), retain: vi.fn() });
    for (let cycle = 0; cycle < 20; cycle++) {
      pool.update([frame(1)]);
      await pool.whenReady();
      pool.update([]);
    }
    expect(load).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledTimes(20);
    expect(pool.stats()).toEqual({ active: 0, pending: 0, retained: 1 });
    expect(model.dispose).not.toHaveBeenCalled();
    pool.dispose();
    expect(model.dispose).toHaveBeenCalledTimes(1);
  });
});
