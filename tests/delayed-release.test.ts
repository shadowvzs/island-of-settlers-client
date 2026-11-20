import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDelayedRelease } from "../src/renderers/three/delayed-release";

describe("delayed release", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("runs every deferred release once after the delay, in one batch", () => {
    const release = createDelayedRelease(2000);
    const first = vi.fn(), second = vi.fn();
    release.defer(first);
    release.defer(second);
    expect(release.pending()).toBe(2);
    vi.advanceTimersByTime(1999);
    expect(first).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(release.pending()).toBe(0);
  });

  it("starts a new batch after the first one ran", () => {
    const release = createDelayedRelease(1000);
    const first = vi.fn(), second = vi.fn();
    release.defer(first);
    vi.advanceTimersByTime(1000);
    release.defer(second);
    vi.advanceTimersByTime(1000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("flushes immediately for teardown and cancels the pending timer", () => {
    const release = createDelayedRelease(5000);
    const early = vi.fn();
    release.defer(early);
    release.flush();
    expect(early).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(early).toHaveBeenCalledTimes(1);
    expect(release.pending()).toBe(0);
  });
});
