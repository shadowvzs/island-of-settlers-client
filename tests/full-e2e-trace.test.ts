import type { BrowserContext } from "playwright-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { startTraceWindow } from "../tools/e2e/full/trace";

const setup = () => ({ start: vi.fn(async () => {}), stop: vi.fn(async () => {}) });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("stops case tracing after eight seconds without DOM snapshots or source copies", async () => {
  const tracing = setup();
  const window = await startTraceWindow(tracing as unknown as BrowserContext["tracing"], "/tmp", "long-case");
  expect(tracing.start).toHaveBeenCalledWith({ screenshots: true, snapshots: false, sources: false });
  await vi.advanceTimersByTimeAsync(8000);
  expect(window.active).toBe(false);
  expect(await window.stop()).toEqual({ filename: "long-case.trace.zip" });
  expect(tracing.stop).toHaveBeenCalledOnce();
  expect(tracing.stop).toHaveBeenCalledWith({ path: "/tmp/long-case.trace.zip" });
});

it("stops early-completed cases immediately and makes cleanup idempotent", async () => {
  const tracing = setup();
  const window = await startTraceWindow(tracing as unknown as BrowserContext["tracing"], "/tmp", "fast-case");
  await window.stop();
  await vi.advanceTimersByTimeAsync(9000);
  await window.stop();
  expect(tracing.stop).toHaveBeenCalledOnce();
});

it("retains trace-export failures as errors instead of declaring an artifact", async () => {
  const tracing = setup();
  tracing.stop.mockRejectedValue(new Error("trace disk full"));
  const window = await startTraceWindow(tracing as unknown as BrowserContext["tracing"], "/tmp", "failed-case", 3);
  await vi.advanceTimersByTimeAsync(3000);
  expect(await window.stop()).toEqual({ error: "Error: trace disk full" });
});
