import { describe, expect, it } from "vitest";

import { createMinimapRefreshScheduler } from "../src/app/minimap/minimap-refresh";

const createHarness = () => {
  let visible = true;
  let version = 0;
  let bakes = 0;
  let bakedVersion = -1;
  const scheduled: (() => void)[] = [];
  const scheduler = createMinimapRefreshScheduler({
    bake: () => {
      bakes += 1;
      bakedVersion = version;
    },
    isVisible: () => visible,
    schedule: (callback) => scheduled.push(callback)
  });
  return {
    bake: () => scheduled.shift()!(),
    get bakedVersion() { return bakedVersion; },
    get bakes() { return bakes; },
    get scheduled() { return scheduled.length; },
    scheduler,
    setVisible: (value: boolean) => { visible = value; },
    setVersion: (value: number) => { version = value; }
  };
};

describe("minimap refresh coalescing", () => {
  it("runs one bake for repeated requests before the frame, on the latest world", () => {
    const harness = createHarness();
    harness.scheduler.request();
    harness.setVersion(1);
    harness.scheduler.request();
    harness.setVersion(2);
    harness.scheduler.request();
    expect(harness.scheduled).toBe(1);
    harness.bake();
    expect(harness.bakes).toBe(1);
    expect(harness.bakedVersion).toBe(2);
    expect(harness.scheduled).toBe(0);
  });

  it("can request again after a frame, but ignores hidden requests", () => {
    const harness = createHarness();
    harness.scheduler.request();
    harness.bake();
    harness.scheduler.request();
    expect(harness.scheduled).toBe(1);
    harness.bake();
    expect(harness.bakes).toBe(2);
    harness.setVisible(false);
    harness.scheduler.request();
    expect(harness.scheduled).toBe(0);
    expect(harness.bakes).toBe(2);
  });

  it("drops a queued bake if the minimap hid before the frame", () => {
    const harness = createHarness();
    harness.scheduler.request();
    harness.setVisible(false);
    harness.bake();
    expect(harness.bakes).toBe(0);
    harness.setVisible(true);
    harness.scheduler.request();
    harness.bake();
    expect(harness.bakes).toBe(1);
  });
});
