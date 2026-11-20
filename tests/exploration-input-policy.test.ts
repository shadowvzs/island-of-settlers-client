import { describe, expect, it, vi } from "vitest";

import {
  createExplorationInputGate,
  EMPTY_NORMALIZED_INPUT
} from "../src/app/exploration/input/gate";
import {
  clampMovement,
  combineMovement,
  isTextEntryTarget,
  joystickMovement,
  keyboardMovement,
  movementForKey,
  ZERO_MOVEMENT
} from "../src/app/exploration/input/joystick";

describe("exploration input gate", () => {
  it("follows the frozen phase policy and exposes the coordinator hooks", () => {
    const gate = createExplorationInputGate();
    expect(gate.snapshot()).toMatchObject({
      entryReady: true, leave: false, look: false, move: false, spyglass: false, suppressNormal: false
    });
    expect(gate.hooks.hoverAllowed()).toBe(true);
    expect(gate.hooks.pickingAllowed()).toBe(true);
    expect(gate.hooks.shortcutAllowed()).toBe(true);

    gate.setPhase("entering");
    expect(gate.snapshot()).toMatchObject({
      entryReady: false, leave: true, look: false, move: false, spyglass: false, suppressNormal: true
    });
    expect(gate.hooks.hoverAllowed()).toBe(false);
    expect(gate.hooks.pickingAllowed()).toBe(false);
    expect(gate.hooks.shortcutAllowed()).toBe(false);

    gate.setPhase("possessed");
    expect(gate.snapshot()).toMatchObject({ leave: true, look: true, move: true, spyglass: true });
    gate.setPhase("cooldown");
    expect(gate.snapshot()).toMatchObject({
      entryReady: false, leave: false, look: false, move: false, spyglass: false, suppressNormal: false
    });
    expect(gate.hooks.hoverAllowed()).toBe(true);
  });

  it("composes entry readiness with normalized placement, modal, editor and map gestures", () => {
    const gate = createExplorationInputGate();
    gate.setNormalizedState({ placementGesture: true });
    expect(gate.hooks.entryReady()).toBe(false);
    gate.setNormalizedState({ ...EMPTY_NORMALIZED_INPUT, modalOpen: true });
    expect(gate.hooks.entryReady()).toBe(false);
    gate.setNormalizedState({ ...EMPTY_NORMALIZED_INPUT, editorGesture: true });
    expect(gate.hooks.entryReady()).toBe(false);
    gate.setNormalizedState({ ...EMPTY_NORMALIZED_INPUT, mapPointerActive: true });
    expect(gate.hooks.entryReady()).toBe(false);
    gate.setNormalizedState({ ...EMPTY_NORMALIZED_INPUT, gesture: "drag" });
    expect(gate.hooks.entryReady()).toBe(false);
    gate.setNormalizedState({ ...EMPTY_NORMALIZED_INPUT, pointerType: "touch" });
    expect(gate.hooks.entryReady()).toBe(true);
    expect(gate.snapshot().normalized.pointerType).toBe("touch");
  });

  it("notifies hover/shortcut owners only when the composed suppression changes", () => {
    const gate = createExplorationInputGate();
    const listener = vi.fn();
    gate.subscribe(listener);
    gate.setPhase("preparing");
    expect(listener).toHaveBeenCalledTimes(1);
    gate.setPhase("possessed");
    expect(listener).toHaveBeenCalledTimes(2);
    gate.setNormalizedState({ pointerType: "mouse" });
    expect(listener).toHaveBeenCalledTimes(2);
    gate.setPhase("idle");
    expect(listener).toHaveBeenCalledTimes(3);
    const secondListener = vi.fn();
    const unsubscribe = gate.subscribe(secondListener);
    unsubscribe();
    gate.setPhase("possessed");
    expect(listener).toHaveBeenCalledTimes(4);
    expect(secondListener).not.toHaveBeenCalled();
  });

  it("keeps a pointer that began in FPS from becoming a normal click on release", () => {
    const gate = createExplorationInputGate("possessed", () => 1_000);
    expect(gate.hooks.beginPointer(7, "touch")).toBe(false);
    expect(gate.hooks.pointerBlocked(7)).toBe(true);
    gate.setPhase("cooldown");
    expect(gate.hooks.endPointer(7)).toBe(false);
    expect(gate.hooks.pointerBlocked(7)).toBe(false);
    expect(gate.hooks.clickAllowed(1_100)).toBe(false);
    expect(gate.hooks.clickAllowed(1_200)).toBe(true);
  });

  it("also blocks a normal press that crosses into an active phase before release", () => {
    const gate = createExplorationInputGate("idle", () => 2_000);
    expect(gate.hooks.beginPointer(3, "mouse")).toBe(true);
    gate.setPhase("preparing");
    gate.setPhase("entering");
    expect(gate.hooks.endPointer(3)).toBe(false);
    expect(gate.hooks.clickAllowed(2_050)).toBe(false);
  });

  it("lets normal idle presses and clicks through and expires a stale blocked click", () => {
    const gate = createExplorationInputGate("idle", () => 5_000);
    expect(gate.hooks.beginPointer(2, "mouse")).toBe(true);
    expect(gate.hooks.endPointer(2)).toBe(true);
    expect(gate.hooks.clickAllowed(5_000)).toBe(true);

    gate.setPhase("possessed");
    gate.hooks.beginPointer(9);
    gate.setPhase("idle");
    gate.hooks.endPointer(9);
    expect(gate.hooks.clickAllowed(9_000)).toBe(true);
  });

  it("disposes idempotently and ignores later phases/subscriptions", () => {
    const gate = createExplorationInputGate("possessed");
    const listener = vi.fn();
    gate.subscribe(listener);
    gate.dispose();
    gate.dispose();
    gate.setPhase("idle");
    gate.setNormalizedState({ modalOpen: true });
    expect(gate.snapshot()).toMatchObject({ entryReady: false, suppressNormal: false });
    expect(listener).not.toHaveBeenCalled();
    const unsubscribe = gate.subscribe(listener);
    unsubscribe();
  });
});

describe("movement normalization", () => {
  it("turns joystick pixels into a deadzoned, rim-scaled intent", () => {
    expect(joystickMovement(0, 0, 50)).toEqual(ZERO_MOVEMENT);
    expect(joystickMovement(3, 2, 50)).toEqual(ZERO_MOVEMENT);
    const right = joystickMovement(50, 0, 50);
    expect(right.right).toBeCloseTo(1);
    expect(right.forward).toBeCloseTo(0);
    const up = joystickMovement(0, -50, 50);
    expect(up.forward).toBeCloseTo(1);
    expect(up.right).toBeCloseTo(0);
    const clamped = joystickMovement(200, 200, 50);
    expect(Math.hypot(clamped.forward, clamped.right)).toBeCloseTo(1);
    expect(joystickMovement(10, 0, 0)).toEqual(ZERO_MOVEMENT);
  });

  it("combines arrow keys with the stick and clamps diagonals", () => {
    const pressed = new Set(["ArrowUp"]);
    const keyboard = keyboardMovement(pressed);
    expect(keyboard).toEqual({ forward: 1, right: 0 });
    const combined = combineMovement(keyboard, { forward: 0, right: 1 });
    expect(Math.hypot(combined.forward, combined.right)).toBeCloseTo(1);
    expect(clampMovement({ forward: 4, right: 0 })).toEqual({ forward: 1, right: 0 });
    for (const key of ["KeyW", "KeyA", "KeyS", "KeyD"]) expect(movementForKey(key)).toBeNull();
    expect(movementForKey("ArrowUp")).toEqual({ forward: 1, right: 0 });
    expect(movementForKey("ArrowDown")).toEqual({ forward: -1, right: 0 });
    expect(movementForKey("ArrowLeft")).toBeNull();
    expect(movementForKey("KeyQ")).toBeNull();
  });

  it("leaves text entry targets to the field", () => {
    expect(isTextEntryTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTextEntryTarget({ isContentEditable: true, tagName: "DIV" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
