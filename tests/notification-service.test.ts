import { afterEach, expect, it, vi } from "vitest";

import { createNotificationPreferences } from "../src/app/notifications/preferences";
import { createToastService } from "../src/app/notifications/service";

afterEach(() => vi.useRealTimers());

it("shows only explicitly important messages and expires at4s with a short fade", () => {
  vi.useFakeTimers(); const service = createToastService();
  expect(service.info("Routine delivery")).toBeNull();
  expect(service.success("Purchased", { important: false })).toBeNull();
  service.success("Purchased", { important: true });
  expect(service.getSnapshot()).toMatchObject([{ kind: "success", message: "Purchased", exiting: false }]);
  vi.advanceTimersByTime(3999); expect(service.getSnapshot()[0]!.exiting).toBe(false);
  vi.advanceTimersByTime(1); expect(service.getSnapshot()[0]!.exiting).toBe(true);
  vi.advanceTimersByTime(180); expect(service.getSnapshot()).toEqual([]);
  expect(vi.getTimerCount()).toBe(0); service.dispose();
});

it("merges repeated events, bounds visible messages/timers and releases them on teardown", () => {
  vi.useFakeTimers(); const service = createToastService();
  const first = service.error("Connection failed", { important: true, dedupeKey: "request-1" });
  expect(service.error("Connection failed", { important: true, dedupeKey: "request-1" })).toBe(first);
  expect(service.getSnapshot()).toHaveLength(1); expect(service.getSnapshot()[0]!.count).toBe(2);
  for (let index = 0; index < 100; index++) service.warning(`Important ${index}`, { important: true });
  expect(service.getSnapshot()).toHaveLength(3); expect(vi.getTimerCount()).toBe(3);
  service.dispose(); service.dispose(); expect(vi.getTimerCount()).toBe(0);
  expect(service.getSnapshot()).toEqual([]); expect(service.info("Late", { important: true })).toBeNull();
});

it("persists opt-out and refuses new messages while disabled", () => {
  vi.useFakeTimers(); const persist = vi.fn(), preferences = createNotificationPreferences(null, persist);
  const service = createToastService(preferences.getSnapshot);
  preferences.setEnabled(false);
  expect(persist).toHaveBeenLastCalledWith("disabled");
  expect(createNotificationPreferences("disabled", persist).getSnapshot()).toBe(false);
  expect(service.error("Important", { important: true })).toBeNull();
  preferences.setEnabled(true); expect(service.info("Ship arrived", { important: true })).not.toBeNull();
  service.clear(); expect(vi.getTimerCount()).toBe(0); service.dispose();
});

it("bounds requested duration and supports early dismissal", () => {
  vi.useFakeTimers(); const service = createToastService();
  const id = service.info("Awaited expedition returned", { important: true, durationMs: 1 })!;
  vi.advanceTimersByTime(2999); expect(service.getSnapshot()[0]!.exiting).toBe(false);
  service.dismiss(id); service.dismiss(id); expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(180); expect(service.getSnapshot()).toEqual([]); service.dispose();
});
