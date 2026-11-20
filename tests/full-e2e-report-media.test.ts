import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createReport } from "../tools/e2e/full/report";
import * as video from "../tools/e2e/full/video";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "e2e-report-media-")); vi.useFakeTimers(); });
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await rm(directory, { force: true, recursive: true }); });
const setup = () => {
  const tracing = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
  const page = {
    context: () => ({ tracing }),
    evaluate: async () => ({ snapshot: { buildings: [] }, status: [], url: "https://probe.test" }),
    screenshot: vi.fn(async () => {})
  } as unknown as Page;
  return { page, tracing };
};

it("preserves a late action failure and state while retaining bounded prefix and failure traces", async () => {
  const { page, tracing } = setup();
  const report = await createReport(directory, {});
  await report.runCase(page, { trace: true, video: false })("late-failure", "Late failure", async () => {
    await vi.advanceTimersByTimeAsync(9000);
    throw new Error("actual game assertion failed");
  });
  expect(report.cases[0]).toMatchObject({
    outcome: "fail", trace: "late-failure.trace.zip", failureTrace: "late-failure-failure.trace.zip",
    state: "late-failure.state.json", screenshot: "late-failure.png"
  });
  expect(report.cases[0]?.error).toContain("actual game assertion failed");
  expect(tracing.start).toHaveBeenCalledTimes(2);
  expect(tracing.stop).toHaveBeenCalledTimes(2);
  expect(JSON.parse(await readFile(join(directory, "late-failure.state.json"), "utf8")))
    .toMatchObject({ snapshot: { buildings: [] } });
});

it("preserves media opt-out without starting CDP or tracing", async () => {
  const { page, tracing } = setup();
  const report = await createReport(directory, {});
  await report.runCase(page, { trace: false, video: false })("no-media", "No media", async () => ({ observed: true }));
  expect(report.cases[0]).toMatchObject({ outcome: "pass", evidence: { observed: true } });
  expect(report.cases[0]?.trace).toBeUndefined();
  expect(report.cases[0]?.video).toBeUndefined();
  expect(tracing.start).not.toHaveBeenCalled();
});

it("retains trace-export errors without losing the original case failure", async () => {
  const { page, tracing } = setup();
  tracing.stop.mockRejectedValue(new Error("disk full"));
  const report = await createReport(directory, {});
  await report.runCase(page, { trace: true })("trace-error", "Trace error", async () => {
    throw new Error("underlying failure");
  });
  expect(report.cases[0]?.outcome).toBe("fail");
  expect(report.cases[0]?.error).toContain("underlying failure");
  expect(report.cases[0]?.trace).toBeUndefined();
  expect(report.logs).toContainEqual({ kind: "trace-failed", id: "trace-error", window: "trace", error: "Error: disk full" });
});

it("starts the case trace before real-frame clip startup", async () => {
  const { page, tracing } = setup();
  const order: string[] = [];
  tracing.start.mockImplementation(async () => { order.push("trace"); });
  vi.spyOn(video, "startClip").mockImplementation(async () => {
    order.push("clip");
    return { stop: async () => ({ filename: "ordered.webm", frames: 1 }) };
  });
  const report = await createReport(directory, {});
  await report.runCase(page, { trace: true, video: true })("ordered", "Ordered media", async () => {
    order.push("action"); return {};
  });
  expect(order).toEqual(["trace", "clip", "action"]);
  expect(report.cases[0]).toMatchObject({ outcome: "pass", video: "ordered.webm", trace: "ordered.trace.zip" });
});
