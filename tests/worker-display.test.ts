import { describe, expect, it, vi } from "vitest";

import { createWorkerDisplay } from "../src/render-common/workers/worker-display";

const appearance = { nation: "roman", variant: "roman-man-white" } as const;
const resource = () => ({ dispose: vi.fn() });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("live worker replacement", () => {
  it("keeps the current display until the replacement is ready", async () => {
    const old = resource(),
      next = resource(),
      pending = deferred<typeof next>();
    const attach = vi.fn();
    const display = createWorkerDisplay(old, () => pending.promise, attach);
    const loading = display.replace(appearance);
    expect(display.current).toBe(old);
    expect(old.dispose).not.toHaveBeenCalled();
    pending.resolve(next);
    expect(await loading).toBe(true);
    expect(display.current).toBe(next);
    expect(attach.mock.calls.map(([worker]) => worker)).toEqual([old, next]);
    expect(old.dispose).toHaveBeenCalledOnce();
    display.dispose();
    expect(next.dispose).toHaveBeenCalledOnce();
  });

  it("keeps the last requested nation when loads finish out of order", async () => {
    const old = resource(),
      slow = resource(),
      fast = resource();
    const first = deferred<typeof slow>(),
      second = deferred<typeof fast>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const display = createWorkerDisplay(old, load);
    const a = display.replace(appearance),
      b = display.replace({ ...appearance, nation: "japanese" });
    second.resolve(fast);
    expect(await b).toBe(true);
    first.resolve(slow);
    expect(await a).toBe(false);
    expect(display.current).toBe(fast);
    expect(slow.dispose).toHaveBeenCalledOnce();
    expect(old.dispose).toHaveBeenCalledOnce();
    display.dispose();
  });

  it("preserves the current worker if the new model cannot load", async () => {
    const old = resource();
    const display = createWorkerDisplay(old, async () => {
      throw new Error("offline");
    });
    await expect(display.replace(appearance)).rejects.toThrow("offline");
    expect(display.current).toBe(old);
    expect(old.dispose).not.toHaveBeenCalled();
    display.dispose();
  });

  it("disposes a late load after the renderer closes", async () => {
    const old = resource(),
      next = resource(),
      pending = deferred<typeof next>();
    const display = createWorkerDisplay(old, () => pending.promise);
    const loading = display.replace(appearance);
    display.dispose();
    pending.resolve(next);
    expect(await loading).toBe(false);
    expect(next.dispose).toHaveBeenCalledOnce();
    expect(display.current).toBeNull();
  });
  it("prepares without publishing and can discard an unpaid replacement", async () => {
    const old = resource(), next = resource(), attach = vi.fn();
    const display = createWorkerDisplay(old,async()=>next,attach);
    const prepared = await display.prepare(appearance);
    expect(display.current).toBe(old);
    expect(attach).toHaveBeenCalledTimes(1);
    prepared!.dispose();
    expect(display.current).toBe(old);
    expect(next.dispose).toHaveBeenCalledOnce();
    expect(old.dispose).not.toHaveBeenCalled();
    expect(prepared!.commit()).toBe(false);
    display.dispose();
  });
  it("publishes a prepared paid replacement once without another asynchronous load", async () => {
    const old = resource(), next = resource(), load = vi.fn(async()=>next);
    const display = createWorkerDisplay(old,load);
    const prepared = await display.prepare(appearance);
    expect(prepared!.commit()).toBe(true);
    expect(prepared!.commit()).toBe(false);
    expect(display.current).toBe(next);
    expect(load).toHaveBeenCalledOnce();
    expect(old.dispose).toHaveBeenCalledOnce();
    prepared!.dispose();
    expect(next.dispose).not.toHaveBeenCalled();
    display.dispose();
  });

  it("keeps prepared colour/hover current while waiting and disposes retained resources on teardown", async () => {
    const old = resource(), next = { ...resource(),setColor:vi.fn(),setHover:vi.fn() };
    const display = createWorkerDisplay(old,async()=>next);
    const prepared = await display.prepare(appearance);
    display.setColor("#123456"); display.setHover(9);
    expect(next.setColor).toHaveBeenLastCalledWith("#123456");
    expect(next.setHover).toHaveBeenLastCalledWith(9);
    display.dispose();
    expect(next.dispose).toHaveBeenCalledOnce();
    prepared!.dispose();
    expect(prepared!.commit()).toBe(false);
    expect(next.dispose).toHaveBeenCalledOnce();
  });

  it("releases every resource once across repeated prepare, reject, commit and teardown cycles", async () => {
    const owned = [];
    for (let cycle = 0; cycle < 50; cycle++) {
      const old = resource(), unpaid = resource(), paid = resource();
      owned.push(old, unpaid, paid);
      const load = vi.fn().mockResolvedValueOnce(unpaid).mockResolvedValueOnce(paid);
      const display = createWorkerDisplay(old, load);
      const first = await display.prepare(appearance);
      first!.dispose(); first!.dispose();
      const second = await display.prepare(appearance);
      expect(second!.commit()).toBe(true);
      second!.dispose(); display.dispose(); display.dispose();
      expect(display.current).toBeNull();
    }
    expect(owned).toHaveLength(150);
    for (const item of owned) expect(item.dispose).toHaveBeenCalledOnce();
  });
});
