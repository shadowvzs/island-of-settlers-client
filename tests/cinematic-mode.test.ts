import { describe, expect, it, vi } from "vitest";

import { createCinematicInputLock } from "../src/app/campaign/cinematics/cinematic-input-lock";
import { createCinematicMode } from "../src/app/campaign/cinematics/cinematic-mode";
import { createHudScope, type HudScopeRoot } from "../src/app/hud-scope/hud-scope";
import { createCamera } from "../src/render-common/camera-state";
import type { ViewMode } from "../src/render-common/renderer-contract";

const createRoot = () => {
  const attributes = new Map<string, string>();
  const root: HudScopeRoot = {
    getAttribute: name => attributes.get(name) ?? null,
    removeAttribute: name => { attributes.delete(name); },
    setAttribute: (name, value) => { attributes.set(name, value); }
  };
  return { attributes, root };
};

describe("cinematic mode", () => {
  it("restores the RTS camera bit-identically and the view mode, and resumes suspended views in order", () => {
    const camera = createCamera(40.123456789, 61.987654321, 1.2345);
    camera.yaw = 0.7071067811865476;
    camera.tilt = 0.3333333333333333;
    const before = { ...camera };
    let viewMode: ViewMode = "cinematic";
    const view = { getViewMode: () => viewMode, setViewMode: (mode: ViewMode) => { viewMode = mode; } };
    const calls: string[] = [];
    const possessed = { setSuspended: (on: boolean) => calls.push(`possessed ${on}`) };
    const { attributes, root } = createRoot();
    const lock = { setActive: (on: boolean) => calls.push(`lock ${on}`) };
    const mode = createCinematicMode({ camera, hud: createHudScope("cinematic", root), lock,
      suspendables: () => [possessed, undefined], view });
    mode.enter();
    mode.enter();
    expect(attributes.get("data-cinematic")).toBe("on");
    // Anything that touches the camera or view mode during the sequence is undone.
    camera.centerX += 13;
    camera.zoom *= 2;
    viewMode = "iso";
    mode.exit();
    mode.exit();
    expect(camera).toEqual(before);
    expect(Object.is(camera.yaw, before.yaw)).toBe(true);
    expect(viewMode).toBe("cinematic");
    expect(attributes.size).toBe(0);
    expect(calls).toEqual(["possessed true", "lock true", "lock false", "possessed false"]);
  });
});

class FakeTarget {
  private readonly listeners = new Map<string, EventListener[]>();
  public addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
  }
  public removeEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry => entry !== listener));
  }
  public dispatch(type: string, fields: Record<string, unknown>) {
    const event = { cancelable: true, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), type, ...fields };
    for (const listener of this.listeners.get(type) ?? []) listener(event as unknown as Event);
    return event;
  }
}

describe("cinematic input lock", () => {
  const setup = (advances: boolean) => {
    const target = new FakeTarget();
    const onAdvance = vi.fn(() => advances);
    const onSkipPress = vi.fn();
    const lock = createCinematicInputLock({ onAdvance, onSkipPress, target,
      viewport: { contains: () => true, dispatchEvent: () => true } });
    return { lock, onAdvance, onSkipPress, target };
  };
  const key = (code: string, extra = {}) =>
    ({ altKey: false, code, ctrlKey: false, metaKey: false, repeat: false, ...extra });

  it("passes everything through while inactive", () => {
    const { onSkipPress, target } = setup(false);
    const event = target.dispatch("keydown", key("Escape"));
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(onSkipPress).not.toHaveBeenCalled();
  });

  it("consumes Escape as a skip press so no window closes, and keeps every hotkey from the game", () => {
    const { lock, onAdvance, onSkipPress, target } = setup(false);
    lock.setActive(true);
    const escape = target.dispatch("keydown", key("Escape"));
    expect(escape.stopImmediatePropagation).toHaveBeenCalled();
    expect(escape.preventDefault).toHaveBeenCalled();
    expect(onSkipPress).toHaveBeenCalledTimes(1);
    const hotkey = target.dispatch("keydown", key("KeyB"));
    expect(hotkey.stopImmediatePropagation).toHaveBeenCalled();
    expect(hotkey.preventDefault).not.toHaveBeenCalled();
    target.dispatch("keydown", key("Escape", { repeat: true }));
    expect(onSkipPress).toHaveBeenCalledTimes(1);
    target.dispatch("keydown", key("Enter"));
    expect(onAdvance).toHaveBeenCalledTimes(1);
    // Space without a shown line counts as a skip press.
    target.dispatch("keydown", key("Space"));
    expect(onSkipPress).toHaveBeenCalledTimes(2);
  });

  it("advances a line with Space and swallows map clicks and wheel", () => {
    const { lock, onAdvance, onSkipPress, target } = setup(true);
    lock.setActive(true);
    target.dispatch("keydown", key("Space"));
    expect(onSkipPress).not.toHaveBeenCalled();
    const wheel = target.dispatch("wheel", { target: {} });
    expect(wheel.stopImmediatePropagation).toHaveBeenCalled();
    expect(wheel.preventDefault).toHaveBeenCalled();
    target.dispatch("pointerdown", { button: 0, isPrimary: true, target: {} });
    expect(onAdvance).toHaveBeenCalledTimes(2);
    // Outside the map viewport (no target) nothing is touched.
    expect(target.dispatch("wheel", { target: null }).stopImmediatePropagation).not.toHaveBeenCalled();
    lock.dispose();
    target.dispatch("keydown", key("Space"));
    expect(onAdvance).toHaveBeenCalledTimes(2);
  });
});
