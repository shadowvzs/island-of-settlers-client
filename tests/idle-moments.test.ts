import { describe, expect, it, vi } from "vitest";

import { createIdleMoments, IDLE_STILL_MS } from "../src/app/save-store/idle-moments";

/** A camera, input target and switches the test drives; time follows the fake timers. */
const idleWorld = () => {
  const camera = { centerX: 10, centerZ: 10, tilt: 0, yaw: 0, zoom: 1 };
  const state = { hidden: false, interacting: false, menu: false };
  const target = new EventTarget();
  const moments = createIdleMoments({ camera, isHidden: () => state.hidden, isInteracting: () => state.interacting,
    isMenuOpen: () => state.menu, now: () => Date.now(), target });
  let idle = false;
  const wait = () => { idle = false; void moments.whenIdle().then(() => { idle = true; }); };
  return { camera, isIdle: () => idle, state, target, wait };
};

describe("idle moments for the snapshot reload (D3)", () => {
  it("releases input listeners and every pending poll when its island is disposed", async () => {
    vi.useFakeTimers();
    try {
      const target = new EventTarget();
      const remove = vi.spyOn(target, "removeEventListener");
      const moments = createIdleMoments({
        camera: { centerX: 0, centerZ: 0, tilt: 0, yaw: 0, zoom: 1 },
        isHidden: () => false, isInteracting: () => true, isMenuOpen: () => false, target
      });
      const pending = [moments.whenIdle(), moments.whenIdle()];
      expect(vi.getTimerCount()).toBe(2);
      moments.dispose();
      await Promise.all(pending);
      expect(vi.getTimerCount()).toBe(0);
      expect(remove.mock.calls.map(([type]) => type)).toEqual(["keydown", "pointerdown", "pointermove", "wheel"]);
      await moments.whenIdle();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("waits until the camera and input rest, restarting on every move", async () => {
    vi.useFakeTimers();
    const world = idleWorld();
    world.wait();
    await vi.advanceTimersByTimeAsync(IDLE_STILL_MS - 200);
    world.camera.centerX += 1;
    await vi.advanceTimersByTimeAsync(IDLE_STILL_MS - 100);
    expect(world.isIdle()).toBe(false);
    world.target.dispatchEvent(new Event("pointermove"));
    await vi.advanceTimersByTimeAsync(IDLE_STILL_MS - 100);
    expect(world.isIdle()).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(world.isIdle()).toBe(true);
    vi.useRealTimers();
  });

  it("is idle at once with a menu open or the tab hidden, never while placing", async () => {
    vi.useFakeTimers();
    const world = idleWorld();
    world.state.interacting = true;
    world.wait();
    await vi.advanceTimersByTimeAsync(IDLE_STILL_MS * 3);
    expect(world.isIdle()).toBe(false);
    world.state.menu = true;
    await vi.advanceTimersByTimeAsync(150);
    expect(world.isIdle()).toBe(true);
    world.state.menu = false;
    world.state.hidden = true;
    world.wait();
    await vi.advanceTimersByTimeAsync(0);
    expect(world.isIdle()).toBe(true);
    vi.useRealTimers();
  });
});
