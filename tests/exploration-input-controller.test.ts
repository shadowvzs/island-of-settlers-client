import { describe, expect, it, vi } from "vitest";

import { explorationInputPolicy } from "../src/app/exploration/contracts";
import {
  createExplorationInput,
  EXPLORATION_FULLSCREEN_KEY,
  EXPLORATION_KEYBOARD_TURN_RATE,
  EXPLORATION_LOOK_STICK_RATE,
  EXPLORATION_SPYGLASS_KEY,
  type ExplorationInputCallbacks
} from "../src/app/exploration/input/controller";
import { createHotkeySettings } from "../src/app/settings/hotkeys/bindings";
import { hotkeyHintVisibility } from "../src/app/settings/hotkeys/hint-visibility";

type Listener = (event: Record<string, unknown>) => void;

/** A listener-only fake; the controller never needs a real DOM to be exercised. */
class FakeTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }

  dispatch(type: string, properties: Record<string, unknown> = {}) {
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: this,
      type,
      ...properties
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
}

class FakeElement extends FakeTarget {
  captured = new Set<number>();
  pointerLockRequests = 0;
  rect = { bottom: 132, height: 132, left: 0, right: 132, top: 0, width: 132 };
  style = { transform: "" };

  getBoundingClientRect() {
    return this.rect;
  }

  hasPointerCapture(pointerId: number) {
    return this.captured.has(pointerId);
  }

  releasePointerCapture(pointerId: number) {
    this.captured.delete(pointerId);
  }

  requestFullscreen = () => Promise.resolve();

  requestPointerLock = () => {
    this.pointerLockRequests++;
    return Promise.resolve();
  };

  setPointerCapture(pointerId: number) {
    this.captured.add(pointerId);
  }
}

class FakeDocument extends FakeTarget {
  hidden = false;
  pointerLockElement: FakeElement | null = null;
  fullscreenElement: FakeElement | null = null;
  fullscreenRequests = 0;
  exitFullscreenRequests = 0;
  readonly documentElement = new FakeElement();

  constructor() {
    super();
    this.documentElement.requestFullscreen = () => {
      this.fullscreenRequests++;
      this.fullscreenElement = this.documentElement;
      this.dispatch("fullscreenchange");
      return Promise.resolve();
    };
  }

  exitPointerLock = () => {
    this.pointerLockElement = null;
    this.dispatch("pointerlockchange");
  };

  exitFullscreen = () => {
    this.exitFullscreenRequests++;
    this.fullscreenElement = null;
    this.dispatch("fullscreenchange");
    return Promise.resolve();
  };
}

class FakeWindow extends FakeTarget {
  readonly screen = { orientation: new FakeTarget() };

  constructor(readonly document: FakeDocument) {
    super();
  }
}

interface Harness {
  callbacks: ExplorationInputCallbacks & {
    onCommanderAction: ReturnType<typeof vi.fn>;
    onEscape: ReturnType<typeof vi.fn>;
    onLeave: ReturnType<typeof vi.fn>;
    onLook: ReturnType<typeof vi.fn>;
    onMovement: ReturnType<typeof vi.fn>;
    onJump: ReturnType<typeof vi.fn>;
    onPointerLockChange: ReturnType<typeof vi.fn>;
    onSpyglass: ReturnType<typeof vi.fn>;
    onSpyglassZoom: ReturnType<typeof vi.fn>;
  };
  doc: FakeDocument;
  input: ReturnType<typeof createExplorationInput>;
  joystick: FakeElement;
  look: FakeElement;
  lookStick: FakeElement;
  lookStickKnob: FakeElement;
  win: FakeWindow;
}

const ACTIVE_POLICY = Object.freeze({
  leave: true,
  look: true,
  move: true,
  spyglass: true,
  suppressNormal: true
});

const harness = (hotkeys?: ReturnType<typeof createHotkeySettings>): Harness => {
  const look = new FakeElement();
  const joystick = new FakeElement();
  const lookStick = new FakeElement();
  const lookStickKnob = new FakeElement();
  const doc = new FakeDocument();
  const win = new FakeWindow(doc);
  const callbacks = {
    onCommanderAction: vi.fn(),
    onEscape: vi.fn(),
    onLeave: vi.fn(),
    onLook: vi.fn(),
    onMovement: vi.fn(),
    onJump: vi.fn(),
    onPointerLockChange: vi.fn(),
    onSpyglass: vi.fn(),
    onSpyglassZoom: vi.fn()
  };
  const input = createExplorationInput({
    callbacks,
    document: doc as unknown as Document,
    hotkeys,
    joystickRadius: 50,
    lookSensitivity: 0.002,
    lookStickRadius: 50,
    window: win as unknown as Window
  });
  input.setPolicy({ ...ACTIVE_POLICY });
  input.attach({
    joystick: joystick as unknown as HTMLElement,
    look: look as unknown as HTMLElement,
    lookStick: lookStick as unknown as HTMLElement,
    lookStickKnob: lookStickKnob as unknown as HTMLElement
  });
  return { callbacks, doc, input, joystick, look, lookStick, lookStickKnob, win };
};

const pointer = (pointerId: number, clientX: number, clientY: number, pointerType = "touch") => ({
  button: 0,
  clientX,
  clientY,
  isPrimary: true,
  pointerId,
  pointerType
});

describe("exploration pointer input", () => {
  it("requests pointer lock for a mouse look press and applies movement deltas as rad/s", () => {
    const { callbacks, doc, input, look } = harness();
    expect(look.requestPointerLock).toBeDefined();
    look.dispatch("pointerdown", pointer(1, 100, 100, "mouse"));
    expect(look.pointerLockRequests).toBe(1);

    doc.pointerLockElement = look;
    doc.dispatch("pointerlockchange");
    expect(callbacks.onPointerLockChange).toHaveBeenLastCalledWith(true);

    doc.dispatch("mousemove", { movementX: 100, movementY: -50 });
    input.update(0.1);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(-2, 1);

    doc.pointerLockElement = null;
    doc.dispatch("pointerlockchange");
    expect(callbacks.onPointerLockChange).toHaveBeenLastCalledWith(false);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(0, 0);
  });

  it("falls back to drag look and clears it on release or cancellation", () => {
    const { callbacks, input, look } = harness();
    look.requestPointerLock = undefined as never;
    look.dispatch("pointerdown", pointer(4, 100, 100, "mouse"));
    expect(look.requestPointerLock).toBeUndefined();
    look.dispatch("pointermove", pointer(4, 150, 80, "mouse"));
    input.update(0.1);
    const [dragYaw, dragPitch] = callbacks.onLook.mock.lastCall!;
    expect(dragYaw).toBeCloseTo(-1);
    expect(dragPitch).toBeCloseTo(0.4);

    look.dispatch("pointercancel", pointer(4, 150, 80, "mouse"));
    expect(callbacks.onLook).toHaveBeenLastCalledWith(0, 0);
    expect(callbacks.onLook).toHaveBeenCalledTimes(2);
  });

  it("ignores pointer presses outside the joystick and look owners (HUD buttons never steer)", () => {
    const { callbacks, input } = harness();
    const button = new FakeElement();
    button.dispatch("pointerdown", pointer(9, 400, 40, "touch"));
    button.dispatch("pointermove", pointer(9, 460, 120, "touch"));
    input.update(0.1);
    expect(callbacks.onLook).not.toHaveBeenCalled();
    expect(callbacks.onMovement).not.toHaveBeenCalled();
  });

  it("keeps joystick movement and look ownership independent and concurrent", () => {
    const { callbacks, input, joystick, look } = harness();
    joystick.dispatch("pointerdown", pointer(1, 116, 66));
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 1);

    look.dispatch("pointerdown", { ...pointer(2, 300, 300), isPrimary: false });
    look.dispatch("pointermove", { ...pointer(2, 350, 300), isPrimary: false });
    input.update(0.1);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(-1, 0);

    joystick.dispatch("pointerup", pointer(1, 116, 66));
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 0);
    look.dispatch("pointermove", pointer(2, 390, 300));
    input.update(0.1);
    const [secondYaw, secondPitch] = callbacks.onLook.mock.lastCall!;
    expect(secondYaw).toBeCloseTo(-0.8);
    expect(secondPitch).toBeCloseTo(0);

    look.dispatch("pointerup", pointer(2, 390, 300));
    expect(callbacks.onLook).toHaveBeenLastCalledWith(0, 0);
  });

  it("turns and pitches with the look stick after its deadzone", () => {
    const { callbacks, input, lookStick, lookStickKnob } = harness();
    lookStick.dispatch("pointerdown", pointer(7, 66, 60));
    input.update(1);
    expect(callbacks.onLook, "inside the deadzone the look stick rests").not.toHaveBeenCalled();

    lookStick.dispatch("pointermove", pointer(7, 116, 66));
    expect(lookStickKnob.style.transform).toBe("translate(50px, 0px)");
    input.update(0.5);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(-EXPLORATION_LOOK_STICK_RATE, 0);

    lookStick.dispatch("pointermove", pointer(7, 66, 116));
    input.update(0.5);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(0, -EXPLORATION_LOOK_STICK_RATE);

    lookStick.dispatch("pointermove", pointer(7, 66, 16));
    input.update(0.5);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(0, EXPLORATION_LOOK_STICK_RATE);

    lookStick.dispatch("pointerup", pointer(7, 66, 16));
    expect(lookStickKnob.style.transform).toBe("");
    input.update(0.5);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(0, 0);

    const calls = callbacks.onLook.mock.calls.length;
    input.setPolicy({ ...ACTIVE_POLICY, look: false });
    lookStick.dispatch("pointerdown", pointer(8, 116, 66));
    input.update(0.5);
    expect(callbacks.onLook, "the look stick is gated by policy.look").toHaveBeenCalledTimes(calls);
  });

  it("keeps movement and look-stick pointers independent and resets the stick on every loss", () => {
    const { callbacks, doc, input, joystick, lookStick, lookStickKnob, win } = harness();
    joystick.dispatch("pointerdown", pointer(1, 116, 66));
    lookStick.dispatch("pointerdown", pointer(2, 66, 66));
    lookStick.dispatch("pointermove", pointer(2, 116, 66));
    input.update(0.5);
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 1);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(-EXPLORATION_LOOK_STICK_RATE, 0);

    lookStick.dispatch("pointerup", pointer(2, 116, 66));
    input.update(0.5);
    expect(callbacks.onLook, "releasing look stops only look").toHaveBeenLastCalledWith(0, 0);
    expect(callbacks.onMovement, "movement keeps running").toHaveBeenLastCalledWith(0, 1);
    expect(lookStickKnob.style.transform).toBe("");

    for (const end of [
      () => win.dispatch("blur"),
      () => win.screen.orientation.dispatch("change"),
      () => {
        doc.hidden = true;
        doc.dispatch("visibilitychange");
        doc.hidden = false;
      },
      () => input.setPolicy({ ...ACTIVE_POLICY, look: false })
    ]) {
      lookStick.dispatch("pointerdown", pointer(3, 116, 66));
      input.update(0.5);
      expect(callbacks.onLook).toHaveBeenLastCalledWith(-EXPLORATION_LOOK_STICK_RATE, 0);
      end();
      expect(callbacks.onLook).toHaveBeenLastCalledWith(0, 0);
      expect(callbacks.onMovement, "a reset clears the movement stick too").toHaveBeenLastCalledWith(0, 0);
      expect(lookStickKnob.style.transform).toBe("");
      input.setPolicy({ ...ACTIVE_POLICY });
    }

    lookStick.dispatch("pointerdown", pointer(4, 116, 66));
    input.update(0.5);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(-EXPLORATION_LOOK_STICK_RATE, 0);
    lookStick.dispatch("pointercancel", pointer(4, 116, 66));
    input.update(0.5);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(0, 0);
    expect(lookStickKnob.style.transform).toBe("");
  });

  it("stops the joystick on pointer cancel and stays at zero", () => {
    const { callbacks, input, joystick } = harness();
    joystick.dispatch("pointerdown", pointer(5, 66, 16));
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(1, 0);
    joystick.dispatch("pointercancel", pointer(5, 66, 16));
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 0);
    input.update(0.1);
    expect(callbacks.onMovement).toHaveBeenCalledTimes(2);
  });

  it("ignores a second joystick pointer and non-enabled policies", () => {
    const { callbacks, input, joystick } = harness();
    joystick.dispatch("pointerdown", pointer(1, 116, 66));
    joystick.dispatch("pointerdown", pointer(2, 16, 66));
    expect(callbacks.onMovement).toHaveBeenCalledTimes(1);
    input.setPolicy({ ...ACTIVE_POLICY, move: false, look: false });
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 0);
    joystick.dispatch("pointermove", pointer(1, 16, 66));
    expect(callbacks.onMovement).toHaveBeenCalledTimes(2);
  });
});

describe("exploration keyboard and lifecycle input", () => {
  it("ignores WASD navigation keys", () => {
    const { callbacks, win } = harness();
    for (const code of ["KeyW", "KeyA", "KeyS", "KeyD"]) {
      win.dispatch("keydown", { code, key: code.slice(3).toLowerCase(), target: null });
      win.dispatch("keyup", { code, key: code.slice(3).toLowerCase(), target: null });
    }
    expect(callbacks.onMovement).not.toHaveBeenCalled();
  });

  it("walks with arrow up/down and turns with arrow left/right", () => {
    const { callbacks, input, win } = harness();
    win.dispatch("keydown", { code: "ArrowUp", key: "ArrowUp", target: null });
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(1, 0);
    win.dispatch("keyup", { code: "ArrowUp", key: "ArrowUp", target: null });
    win.dispatch("keydown", { code: "ArrowDown", key: "ArrowDown", target: null });
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(-1, 0);
    win.dispatch("keyup", { code: "ArrowDown", key: "ArrowDown", target: null });

    win.dispatch("keydown", { code: "ArrowRight", key: "ArrowRight", target: null });
    input.update(0.5);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(-EXPLORATION_KEYBOARD_TURN_RATE, 0);
    win.dispatch("keyup", { code: "ArrowRight", key: "ArrowRight", target: null });
    input.update(0.5);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(0, 0);

    win.dispatch("keydown", { code: "ArrowLeft", key: "ArrowLeft", target: null });
    input.update(0.5);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(EXPLORATION_KEYBOARD_TURN_RATE, 0);
  });

  it("toggles the spyglass with Z once per press while possessed", () => {
    const { callbacks, doc, input, win } = harness();
    win.dispatch("keydown", { code: EXPLORATION_SPYGLASS_KEY, key: "z", repeat: false, target: null });
    expect(callbacks.onSpyglass).toHaveBeenCalledTimes(1);
    win.dispatch("keydown", { code: EXPLORATION_SPYGLASS_KEY, key: "z", repeat: true, target: null });
    expect(callbacks.onSpyglass).toHaveBeenCalledTimes(1);
    input.setPolicy({ ...ACTIVE_POLICY, spyglass: false });
    win.dispatch("keydown", { code: EXPLORATION_SPYGLASS_KEY, key: "z", repeat: false, target: null });
    expect(callbacks.onSpyglass).toHaveBeenCalledTimes(1);
    expect(doc.fullscreenRequests).toBe(0);
  });

  it("zooms the spyglass with + and - between the supported steps", () => {
    const { callbacks, input, win } = harness();
    win.dispatch("keydown", { code: "Equal", key: "+", repeat: false, target: null });
    win.dispatch("keydown", { code: "NumpadAdd", key: "+", repeat: false, target: null });
    win.dispatch("keydown", { code: "Equal", key: "+", repeat: true, target: null });
    expect(callbacks.onSpyglassZoom.mock.calls).toEqual([[1], [1], [1]]);
    win.dispatch("keydown", { code: "Minus", key: "-", repeat: false, target: null });
    win.dispatch("keydown", { code: "NumpadSubtract", key: "-", repeat: false, target: null });
    expect(callbacks.onSpyglassZoom.mock.calls).toEqual([[1], [1], [1], [-1], [-1]]);
    input.setPolicy({ ...ACTIVE_POLICY, spyglass: false });
    win.dispatch("keydown", { code: "Equal", key: "+", repeat: false, target: null });
    expect(callbacks.onSpyglassZoom).toHaveBeenCalledTimes(5);
  });

  it("toggles fullscreen with F and captures the mouse on entry", () => {
    const { callbacks, doc, look, win } = harness();
    win.dispatch("keydown", { code: EXPLORATION_FULLSCREEN_KEY, key: "f", repeat: false, target: null });
    expect(doc.fullscreenRequests).toBe(1);
    expect(doc.fullscreenElement).toBe(doc.documentElement);
    expect(look.pointerLockRequests).toBe(1);
    expect(callbacks.onSpyglass).not.toHaveBeenCalled();
    win.dispatch("keydown", { code: EXPLORATION_FULLSCREEN_KEY, key: "f", repeat: true, target: null });
    expect(doc.fullscreenRequests).toBe(1);
    win.dispatch("keydown", { code: EXPLORATION_FULLSCREEN_KEY, key: "f", repeat: false, target: null });
    expect(doc.exitFullscreenRequests).toBe(1);
    expect(doc.fullscreenElement).toBeNull();
  });

  it("clears held movement on orientation, visibility and pointer-lock loss", () => {
    const { callbacks, doc, win } = harness();
    win.dispatch("keydown", { code: "ArrowUp", key: "ArrowUp", target: null });
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(1, 0);
    win.screen.orientation.dispatch("change");
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 0);

    win.dispatch("keydown", { code: "ArrowUp", key: "ArrowUp", target: null });
    doc.hidden = true;
    doc.dispatch("visibilitychange");
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 0);

    doc.hidden = false;
    win.dispatch("keydown", { code: "ArrowUp", key: "ArrowUp", target: null });
    doc.pointerLockElement = null;
    doc.dispatch("pointerlockchange");
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 0);
  });

  it("Escape releases pointer lock, clears held input and asks for the Leave affordance", () => {
    const { callbacks, doc, look, win } = harness();
    doc.pointerLockElement = look;
    doc.dispatch("pointerlockchange");
    win.dispatch("keydown", { code: "ArrowUp", key: "ArrowUp", target: null });
    const escape = win.dispatch("keydown", { code: "Escape", key: "Escape", target: null });
    expect(escape.preventDefault).toHaveBeenCalled();
    expect(doc.pointerLockElement).toBeNull();
    expect(callbacks.onEscape).toHaveBeenCalledTimes(1);
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 0);

    win.dispatch("keydown", { code: "Escape", key: "Escape", target: null });
    expect(callbacks.onEscape).toHaveBeenCalledTimes(2);
  });

  it("CIN3 suspension disables every action, Escape included, and resumes the requested policy", () => {
    const { callbacks, doc, input, look, win } = harness();
    doc.pointerLockElement = look;
    doc.dispatch("pointerlockchange");
    win.dispatch("keydown", { code: "ArrowUp", key: "ArrowUp", target: null });
    input.setSuspended(true);
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 0);
    expect(doc.pointerLockElement).toBeNull();
    win.dispatch("keydown", { code: "Escape", key: "Escape", target: null });
    win.dispatch("keydown", { code: EXPLORATION_SPYGLASS_KEY, key: "z", repeat: false, target: null });
    // A policy published while suspended is remembered, not applied.
    input.setPolicy({ ...ACTIVE_POLICY });
    win.dispatch("keydown", { code: "ArrowDown", key: "ArrowDown", target: null });
    expect(callbacks.onEscape).not.toHaveBeenCalled();
    expect(callbacks.onSpyglass).not.toHaveBeenCalled();
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 0);
    input.setSuspended(false);
    win.dispatch("keydown", { code: EXPLORATION_SPYGLASS_KEY, key: "z", repeat: false, target: null });
    expect(callbacks.onSpyglass).toHaveBeenCalledTimes(1);
  });

  it("detaches every listener and disposes idempotently", () => {
    const { callbacks, doc, input, joystick, look, lookStick, win } = harness();
    expect(look.listenerCount("pointerdown")).toBe(1);
    expect(lookStick.listenerCount("pointerdown")).toBe(1);
    expect(win.listenerCount("keydown")).toBe(1);
    expect(doc.listenerCount("mousemove")).toBe(1);

    input.dispose();
    const movementCalls = callbacks.onMovement.mock.calls.length;
    expect(look.listenerCount("pointerdown")).toBe(0);
    expect(joystick.listenerCount("pointerdown")).toBe(0);
    expect(lookStick.listenerCount("pointerdown")).toBe(0);
    expect(win.listenerCount("keydown")).toBe(0);
    expect(win.listenerCount("blur")).toBe(0);
    expect(doc.listenerCount("visibilitychange")).toBe(0);

    input.dispose();
    win.dispatch("keydown", { code: "ArrowUp", key: "ArrowUp", target: null });
    expect(callbacks.onMovement.mock.calls.length).toBe(movementCalls);
  });
});


describe("live possessed hotkey changes", () => {
  it("denies independent action flags without surrogate move/look/spyglass permission", () => {
    const { callbacks, doc, input, win } = harness();
    input.setPolicy({ ...ACTIVE_POLICY, jump: false, fullscreen: false, zoomIn: false, zoomOut: false,
      forward: false, backward: false, turnLeft: false, turnRight: false });
    for (const code of ["Space", "KeyF", "Equal", "Minus", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])
      win.dispatch("keydown", { code, target: null });
    input.update(.1);
    expect(callbacks.onJump).not.toHaveBeenCalled(); expect(callbacks.onSpyglassZoom).not.toHaveBeenCalled();
    expect(callbacks.onMovement).not.toHaveBeenCalled(); expect(callbacks.onLook).not.toHaveBeenCalled();
    expect(doc.fullscreenRequests).toBe(0);
    input.setPolicy({ ...ACTIVE_POLICY, move: false, look: false, jump: true, fullscreen: true });
    win.dispatch("keydown", { code: "Space", target: null });
    win.dispatch("keydown", { code: "KeyF", target: null });
    expect(callbacks.onJump).toHaveBeenCalledOnce(); expect(doc.fullscreenRequests).toBe(1);
    input.dispose();
  });

  it("revokes held inputs on actor capability change while emergency Back remains available", () => {
    const { callbacks, input, win } = harness();
    win.dispatch("keydown", { code: "ArrowUp", target: null });
    win.dispatch("keydown", { code: "ArrowLeft", target: null }); input.update(.1);
    input.setPolicy(explorationInputPolicy("possessed", "unknown")); input.update(.1);
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 0);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(0, 0);
    win.dispatch("keydown", { code: "Space", target: null });
    expect(callbacks.onJump).not.toHaveBeenCalled();
    win.dispatch("keydown", { code: "Escape", target: null });
    expect(callbacks.onEscape).toHaveBeenCalledOnce(); input.dispose();
  });
  it("jumps once per physical press and clears bindings, focus and ownership without sticky input", () => {
    const settings = createHotkeySettings(null, vi.fn());
    const { callbacks, input, win } = harness(settings);
    win.dispatch("keydown", { code: "Space", target: null });
    win.dispatch("keydown", { code: "Space", target: null });
    win.dispatch("keydown", { code: "Space", repeat: true, target: null });
    expect(callbacks.onJump).toHaveBeenCalledTimes(1);
    win.dispatch("keyup", { code: "Space", target: null });
    win.dispatch("keydown", { code: "Space", target: null });
    expect(callbacks.onJump).toHaveBeenCalledTimes(2);
    settings.rebind("possessedJump", "KeyJ");
    win.dispatch("keydown", { code: "Space", target: null });
    win.dispatch("keydown", { code: "KeyJ", repeat: true, target: null });
    expect(callbacks.onJump).toHaveBeenCalledTimes(2);
    win.dispatch("keydown", { code: "KeyJ", target: null });
    expect(callbacks.onJump).toHaveBeenCalledTimes(3);
    win.dispatch("blur");
    win.dispatch("keydown", { code: "KeyJ", repeat: true, target: null });
    expect(callbacks.onJump).toHaveBeenCalledTimes(3);
    input.setPolicy({ ...ACTIVE_POLICY, move: false });
    win.dispatch("keydown", { code: "KeyJ", target: null });
    expect(callbacks.onJump).toHaveBeenCalledTimes(3);
    input.setPolicy({ ...ACTIVE_POLICY });
    win.dispatch("keydown", { code: "KeyJ", target: null });
    expect(callbacks.onJump).toHaveBeenCalledTimes(4);
    input.setPolicy({ ...ACTIVE_POLICY, move: false }); input.setPolicy({ ...ACTIVE_POLICY });
    win.dispatch("keydown", { code: "KeyJ", target: null });
    expect(callbacks.onJump).toHaveBeenCalledTimes(5);
    input.dispose(); win.dispatch("keydown", { code: "KeyJ", target: null });
    expect(callbacks.onJump).toHaveBeenCalledTimes(5);
  });
  it("clears held walking/turning on rebind and releases custom keys without sticking", () => {
    const settings = createHotkeySettings(null, vi.fn());
    const { callbacks, input, win } = harness(settings);
    win.dispatch("keydown", { code: "ArrowUp", target: null });
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(1, 0);
    settings.rebind("forward", "KeyW");
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 0);
    win.dispatch("keydown", { code: "ArrowUp", repeat: true, target: null });
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 0);
    win.dispatch("keydown", { code: "KeyW", target: null });
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(1, 0);
    win.dispatch("keyup", { code: "KeyW", target: { tagName: "INPUT" } });
    expect(callbacks.onMovement).toHaveBeenLastCalledWith(0, 0);
    settings.rebind("turnLeft", "KeyA");
    win.dispatch("keydown", { code: "KeyA", target: null });
    input.update(.1);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(EXPLORATION_KEYBOARD_TURN_RATE, 0);
    settings.rebind("spyglass", "KeyV");
    input.update(.1);
    expect(callbacks.onLook).toHaveBeenLastCalledWith(0, 0);
    win.dispatch("keydown", { code: "KeyZ", target: null });
    expect(callbacks.onSpyglass).not.toHaveBeenCalled();
    win.dispatch("keydown", { code: "KeyV", target: null });
    expect(callbacks.onSpyglass).toHaveBeenCalledOnce();
    input.dispose();
  });

  it("gates commander hotkeys by actual capabilities and releases held actions on mode changes", () => {
    const { callbacks, input, win } = harness();
    input.setPolicy(explorationInputPolicy("possessed", "Scout"));
    win.dispatch("keydown", { code: "KeyE", target: null });
    expect(callbacks.onCommanderAction).not.toHaveBeenCalled();
    input.setPolicy(explorationInputPolicy("possessed", "commander"));
    win.dispatch("keydown", { code: "KeyE", target: null });
    win.dispatch("keydown", { code: "KeyE", repeat: true, target: null });
    expect(callbacks.onCommanderAction.mock.calls).toEqual([["attack", true]]);
    win.dispatch("keyup", { code: "KeyE", target: null });
    expect(callbacks.onCommanderAction).toHaveBeenLastCalledWith("attack", false);
    win.dispatch("keydown", { code: "KeyQ", target: null });
    input.setPolicy(explorationInputPolicy("possessed", "Scout"));
    expect(callbacks.onCommanderAction).toHaveBeenLastCalledWith("block", false);
    input.dispose();
  });

  it("toggles hint visibility from its saved key without changing the active input policy", () => {
    const { callbacks, input, win } = harness();
    input.setPolicy(explorationInputPolicy("possessed", "commander"));
    const before = hotkeyHintVisibility.getSnapshot();
    win.dispatch("keydown", { code: "KeyK", target: null });
    expect(hotkeyHintVisibility.getSnapshot()).toBe(!before);
    win.dispatch("keydown", { code: "KeyK", repeat: true, target: null });
    expect(hotkeyHintVisibility.getSnapshot()).toBe(!before);
    win.dispatch("keyup", { code: "KeyK", target: null });
    win.dispatch("keydown", { code: "KeyK", target: null });
    expect(hotkeyHintVisibility.getSnapshot()).toBe(before);
    win.dispatch("keydown", { code: "KeyE", target: null });
    expect(callbacks.onCommanderAction).toHaveBeenLastCalledWith("attack", true);
    input.dispose();
  });

  it("never starts custom movement from typing, composition or modified shortcuts", () => {
    const settings = createHotkeySettings(null, vi.fn());
    settings.rebind("forward", "KeyW");
    const { callbacks, input, win } = harness(settings);
    for (const extra of [{ target: { tagName: "INPUT" } }, { target: { isContentEditable: true } },
      { isComposing: true }, { ctrlKey: true }, { altKey: true }, { repeat: true }])
      win.dispatch("keydown", { code: "KeyW", target: null, ...extra });
    expect(callbacks.onMovement).not.toHaveBeenCalled();
    input.dispose();
  });
});
