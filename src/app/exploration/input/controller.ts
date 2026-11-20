/* oxlint-disable max-lines -- one input owner keeps both touch sticks and the shared listener lifecycle together. */
import { COMMANDER_HOTKEY_ACTIONS, type CommanderHotkeyAction, HOTKEY_DEFAULTS, hotkeyEventAllowed, hotkeySettings,
  isCommanderHotkeyAction, possessedActionForCode } from "../../settings/hotkeys/bindings";
import { hotkeyHintVisibility } from "../../settings/hotkeys/hint-visibility";
import type { ExplorationInputPolicy } from "../contracts";
import {
  combineMovement,
  JOYSTICK_DEADZONE,
  joystickMovement,
  keyboardMovement,
  movementEquals,
  type MovementIntent,
  ZERO_MOVEMENT
} from "./joystick";
import { bindExplorationInputListeners } from "./listeners";

/** Default look sensitivity in radians per CSS pixel of drag or pointer-lock movement. */
const EXPLORATION_LOOK_SENSITIVITY = 0.0024;
/** Keyboard toggle for the spyglass while possessed. */
export const EXPLORATION_SPYGLASS_KEY = HOTKEY_DEFAULTS.spyglass.code;
/** Keyboard toggle for browser fullscreen while possessed. */
export const EXPLORATION_FULLSCREEN_KEY = HOTKEY_DEFAULTS.fullscreen.code;
/** Held arrow-key turn rate. Arrow up/down walk; left/right turn without touching the mouse. */
export const EXPLORATION_KEYBOARD_TURN_RATE = (110 * Math.PI) / 180;
/** Full-deflection look-stick turn rate, matching the keyboard's 110°/s. */
export const EXPLORATION_LOOK_STICK_RATE = (110 * Math.PI) / 180;

export interface ExplorationInputCallbacks {
  onCommanderAction?: (action: CommanderHotkeyAction, held: boolean) => void;
  /** Escape released pointer lock or the explorer asked for the Leave affordance. */
  onEscape: () => void;
  onLeave: () => void;
  /** Radians per second; the controller applies it for the frame's delta. */
  onLook: (yawPerSecond: number, pitchPerSecond: number) => void;
  onMovement: (forward: number, right: number) => void;
  onJump?: () => void;
  onPointerLockChange?: (locked: boolean) => void;
  onSpyglass: () => void;
  /** +1 zooms the active spyglass in, -1 zooms out. */
  onSpyglassZoom?: (direction: 1 | -1) => void;
}

export interface ExplorationInputTargets {
  joystick: HTMLElement;
  joystickKnob?: HTMLElement | null;
  look: HTMLElement;
  /** Visible coarse-pointer portrait look stick; independent from the drag-look surface. */
  lookStick?: HTMLElement | null;
  lookStickKnob?: HTMLElement | null;
}

export interface ExplorationInputOptions {
  callbacks: ExplorationInputCallbacks;
  document?: Document;
  hotkeys?: typeof hotkeySettings;
  joystickRadius?: number;
  lookSensitivity?: number;
  lookStickRadius?: number;
  window?: Window;
}

export interface ExplorationInput {
  attach: (targets: ExplorationInputTargets) => () => void;
  clearHeldInputs: () => void;
  dispose: () => void;
  isPointerLocked: () => boolean;
  setPolicy: (policy: ExplorationInputPolicy) => void;
  /**
   * CIN3: a campaign cinematic suspends the view without leaving it. Every action (including Back) is off and
   * held input is cleared; resuming re-applies the latest requested policy.
   */
  setSuspended: (suspended: boolean) => void;
  update: (deltaSeconds: number) => void;
}

const DEFAULT_POLICY: ExplorationInputPolicy = Object.freeze({
  leave: false,
  look: false,
  move: false,
  spyglass: false,
  suppressNormal: false
});

const SUSPENDED_POLICY: ExplorationInputPolicy = Object.freeze({ ...DEFAULT_POLICY, suppressNormal: true });

const isPrimaryButton = (event: PointerEvent) => event.button === 0;
const pointerLookSensitivity = (value: number) => Math.max(0.0005, Math.min(0.01, value));
const releasePointerCapture = (element: HTMLElement, pointerId: number) => {
  if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
};
const pointerLockElementIs = (look: HTMLElement | undefined, doc: Document | null) =>
  Boolean(look && doc?.pointerLockElement === look);
const actionAllowed = (policy: ExplorationInputPolicy, action: string) => {
  if (action === "toggleHotkeys") return policy.toggleHotkeys === true;
  if (isCommanderHotkeyAction(action)) return policy.commander?.[action] === true;
  if (action === "possessedJump") return policy.jump ?? policy.move;
  if (action === "fullscreen") return policy.fullscreen ?? policy.look;
  if (action === "zoomIn") return policy.zoomIn ?? policy.spyglass;
  if (action === "zoomOut") return policy.zoomOut ?? policy.spyglass;
  if (action === "forward") return policy.forward ?? policy.move;
  if (action === "backward") return policy.backward ?? policy.move;
  if (action === "turnLeft") return policy.turnLeft ?? policy.look;
  if (action === "turnRight") return policy.turnRight ?? policy.look;
  return action === "spyglass" && policy.spyglass;
};

/** F enters fullscreen and captures the mouse; a second F leaves both. */
const toggleFullscreen = (
  doc: Document | null,
  requestPointerLock: () => void,
  exitPointerLock: () => void
) => {
  if (!doc) return;
  if (doc.fullscreenElement) {
    exitPointerLock();
    try {
      const request = doc.exitFullscreen?.();
      if (request && typeof request.catch === "function") void request.catch(() => undefined);
    } catch {
      // The browser already left fullscreen.
    }
    return;
  }
  const element = doc.documentElement;
  if (!element?.requestFullscreen) return;
  // Request pointer lock before the fullscreen transition: both need this key press's user
  // activation, and fullscreen alone must never leave a visible cursor over the look surface.
  requestPointerLock();
  try {
    const request = element.requestFullscreen({ navigationUI: "hide" });
    if (request && typeof request.catch === "function") void request.catch(() => undefined);
  } catch {
    // Unsupported or refused by browser policy; leave the current view unchanged.
  }
};

/**
 * Desktop/mobile exploration input. Movement (arrow keys or the joystick) and look (pointer lock, drag or
 * the right-side look surface) are separate owners: a button press never reaches the look surface and
 * releasing or cancelling one owner only clears that owner. The driver is controller-agnostic; the
 * coordinator forwards its callbacks to `setMovement`, `setLook`, `toggleSpyglass` and
 * `requestLeave`. `update(deltaSeconds)` publishes pointer-lock/drag deltas as radians per second.
 */
// oxlint-disable-next-line max-lines-per-function -- the input owner is one listener lifecycle
export const createExplorationInput = (options: ExplorationInputOptions): ExplorationInput => {
  const { callbacks } = options;
  const sensitivity = pointerLookSensitivity(options.lookSensitivity ?? EXPLORATION_LOOK_SENSITIVITY);
  let policy: ExplorationInputPolicy = DEFAULT_POLICY;
  let requestedPolicy: ExplorationInputPolicy = DEFAULT_POLICY;
  let suspended = false;
  let targets: ExplorationInputTargets | null = null;
  let windowContext: Window | null = null;
  let documentContext: Document | null = null;
  let unbindListeners: (() => void) | null = null;
  let disposed = false;
  let pointerLocked = false;
  let pointerLockRejected = false;
  const settings = options.hotkeys ?? hotkeySettings;
  const physicalKeys = new Map<string, string>();
  const pressedKeys = new Set<string>();
  const pressedTurnKeys = new Set<string>();
  let keyboard: MovementIntent = { ...ZERO_MOVEMENT };
  let joystick: MovementIntent = { ...ZERO_MOVEMENT };
  let emittedMovement: MovementIntent = { ...ZERO_MOVEMENT };
  let joystickPointerId: number | null = null;
  let joystickCenter = { x: 0, y: 0 };
  let lookStickPointerId: number | null = null;
  let lookStickCenter = { x: 0, y: 0 };
  let lookStickIntent = { pitch: 0, yaw: 0 };
  let lookPointerId: number | null = null;
  let lookX = 0, lookY = 0;
  let pendingLook = { pitch: 0, yaw: 0 }, emittedLook = { pitch: 0, yaw: 0 };
  const emitMovement = () => {
    const combined = combineMovement(keyboard, joystick);
    if (movementEquals(combined, emittedMovement)) return;
    emittedMovement = combined;
    callbacks.onMovement(combined.forward, combined.right);
  };

  const setJoystick = (next: MovementIntent) => {
    joystick = next;
    emitMovement();
  };
  const resetJoystick = () => {
    joystickPointerId = null;
    setJoystick({ ...ZERO_MOVEMENT });
    if (targets?.joystickKnob) targets.joystickKnob.style.transform = "";
  };
  const resetLookStick = () => {
    lookStickPointerId = null;
    lookStickIntent = { pitch: 0, yaw: 0 };
    if (targets?.lookStickKnob) targets.lookStickKnob.style.transform = "";
  };

  const endLook = (notifyStop: boolean) => {
    lookPointerId = null;
    pendingLook = { pitch: 0, yaw: 0 };
    if (!notifyStop) return;
    if (emittedLook.yaw === 0 && emittedLook.pitch === 0) return;
    emittedLook = { pitch: 0, yaw: 0 };
    callbacks.onLook(0, 0);
  };

  const clearHeldInputs = () => {
    for (const action of physicalKeys.values())
      if (isCommanderHotkeyAction(action)) callbacks.onCommanderAction?.(action, false);
    if (targets) {
      if (lookPointerId !== null) releasePointerCapture(targets.look, lookPointerId);
      if (joystickPointerId !== null) releasePointerCapture(targets.joystick, joystickPointerId);
      if (lookStickPointerId !== null && targets.lookStick)
        releasePointerCapture(targets.lookStick, lookStickPointerId);
    }
    physicalKeys.clear();
    pressedKeys.clear();
    pressedTurnKeys.clear();
    keyboard = { ...ZERO_MOVEMENT };
    resetJoystick();
    resetLookStick();
    endLook(true);
    emitMovement();
  };

  const exitLookPointerLock = () => {
    if (!pointerLockElementIs(targets?.look, documentContext)) return;
    try {
      documentContext?.exitPointerLock?.();
    } catch {
      // The browser already released it (for example on Escape or focus loss).
    }
  };

  const onPointerLockChange = () => {
    const locked = pointerLockElementIs(targets?.look, documentContext);
    pointerLocked = locked;
    if (locked) {
      if (lookPointerId !== null && targets) releasePointerCapture(targets.look, lookPointerId);
      endLook(false);
      pointerLockRejected = false;
    } else {
      clearHeldInputs();
    }
    callbacks.onPointerLockChange?.(locked);
  };

  const onPointerLockError = () => {
    pointerLockRejected = true;
    pointerLocked = false;
  };

  /** Requests pointer lock for an explicit user action (mouse press or fullscreen entry). */
  const requestLookPointerLock = (force: boolean) => {
    if (!policy.look || pointerLocked || (!force && pointerLockRejected)) return false;
    const look = targets?.look;
    if (!look) return false;
    try {
      const request = look.requestPointerLock?.();
      if (request && typeof (request as Promise<void>).catch === "function") {
        void (request as Promise<void>).catch(() => { pointerLockRejected = true; });
      }
      return true;
    } catch {
      pointerLockRejected = true;
      return false;
    }
  };

  const onLookPointerDown = (event: PointerEvent) => {
    if (!policy.look || !isPrimaryButton(event)) return;
    if (lookPointerId !== null || pointerLocked) return;
    const look = targets?.look;
    if (!look) return;
    lookPointerId = event.pointerId;
    lookX = event.clientX;
    lookY = event.clientY;
    look.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    if (event.pointerType === "mouse") requestLookPointerLock(false);
  };

  const accumulateLook = (deltaX: number, deltaY: number) => {
    // Positive yaw points towards -X at yaw 0 (the camera looks towards +Z), which is screen-right.
    pendingLook.yaw -= deltaX * sensitivity;
    pendingLook.pitch -= deltaY * sensitivity;
  };

  const onLookPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== lookPointerId || pointerLocked) return;
    accumulateLook(event.clientX - lookX, event.clientY - lookY);
    lookX = event.clientX;
    lookY = event.clientY;
    event.preventDefault();
  };

  const onLookPointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== lookPointerId) return;
    if (targets) releasePointerCapture(targets.look, event.pointerId);
    endLook(true);
  };

  const onDocumentMouseMove = (event: MouseEvent) => {
    if (!pointerLocked) return;
    accumulateLook(event.movementX ?? 0, event.movementY ?? 0);
  };

  const joystickRadius = () => {
    if (options.joystickRadius) return options.joystickRadius;
    const rect = targets?.joystick.getBoundingClientRect();
    if (!rect) return 52;
    return Math.max(24, Math.min(rect.width, rect.height) / 2 - 6);
  };

  const applyJoystickPoint = (clientX: number, clientY: number) => {
    const deltaX = clientX - joystickCenter.x;
    const deltaY = clientY - joystickCenter.y;
    const radius = joystickRadius();
    setJoystick(joystickMovement(deltaX, deltaY, radius, JOYSTICK_DEADZONE));
    const knob = targets?.joystickKnob;
    if (!knob) return;
    const scale = Math.min(1, Math.hypot(deltaX, deltaY) / radius);
    knob.style.transform = `translate(${deltaX * scale}px, ${deltaY * scale}px)`;
  };

  const onJoystickPointerDown = (event: PointerEvent) => {
    if (!policy.move || !isPrimaryButton(event)) return;
    if (joystickPointerId !== null) return;
    const joystickElement = targets?.joystick;
    if (!joystickElement) return;
    joystickPointerId = event.pointerId;
    const rect = joystickElement.getBoundingClientRect();
    joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    joystickElement.setPointerCapture?.(event.pointerId);
    applyJoystickPoint(event.clientX, event.clientY);
    event.preventDefault();
  };

  const onJoystickPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== joystickPointerId) return;
    applyJoystickPoint(event.clientX, event.clientY);
    event.preventDefault();
  };

  const onJoystickPointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== joystickPointerId) return;
    if (targets) releasePointerCapture(targets.joystick, event.pointerId);
    resetJoystick();
  };

  const lookStickRadius = () => {
    if (options.lookStickRadius) return options.lookStickRadius;
    const rect = targets?.lookStick?.getBoundingClientRect();
    if (!rect) return 52;
    return Math.max(24, Math.min(rect.width, rect.height) / 2 - 6);
  };

  const applyLookStickPoint = (clientX: number, clientY: number) => {
    const deltaX = clientX - lookStickCenter.x;
    const deltaY = clientY - lookStickCenter.y;
    const radius = lookStickRadius();
    // Reuse the movement stick's deadzone/rim scaling, then map its axes to bounded look rates.
    const look = joystickMovement(deltaX, deltaY, radius, JOYSTICK_DEADZONE);
    lookStickIntent = { pitch: look.forward, yaw: -look.right };
    const knob = targets?.lookStickKnob;
    if (!knob) return;
    const scale = Math.min(1, Math.hypot(deltaX, deltaY) / radius);
    knob.style.transform = `translate(${deltaX * scale}px, ${deltaY * scale}px)`;
  };

  const onLookStickPointerDown = (event: PointerEvent) => {
    if (!policy.look || !isPrimaryButton(event)) return;
    if (lookStickPointerId !== null) return;
    const lookStick = targets?.lookStick;
    if (!lookStick) return;
    lookStickPointerId = event.pointerId;
    const rect = lookStick.getBoundingClientRect();
    lookStickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    lookStick.setPointerCapture?.(event.pointerId);
    applyLookStickPoint(event.clientX, event.clientY);
    event.preventDefault();
  };

  const onLookStickPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== lookStickPointerId) return;
    applyLookStickPoint(event.clientX, event.clientY);
    event.preventDefault();
  };

  const onLookStickPointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== lookStickPointerId) return;
    if (targets?.lookStick) releasePointerCapture(targets.lookStick, event.pointerId);
    resetLookStick();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const action = possessedActionForCode(event.code, settings.getSnapshot());
    // Shift is needed for the printed + on some layouts; other modified shortcuts stay with the browser.
    const allowed = hotkeyEventAllowed({ altKey: event.altKey, code: event.code,
      ctrlKey: event.ctrlKey, defaultPrevented: event.defaultPrevented, isComposing: event.isComposing,
      metaKey: event.metaKey, repeat: event.repeat, shiftKey: event.shiftKey && action !== "zoomIn",
      target: event.target }, true);
    if (!allowed) return;
    if (action && action !== "back" && !actionAllowed(policy, action)) {
      if (policy.suppressNormal) event.preventDefault();
      return;
    }
    if (isCommanderHotkeyAction(action)) {
      event.preventDefault();
      if (!event.repeat && !physicalKeys.has(event.code)) {
        physicalKeys.set(event.code, action); callbacks.onCommanderAction?.(action, true);
      }
      return;
    }
    if (action === "toggleHotkeys") {
      event.preventDefault();
      if (!event.repeat) hotkeyHintVisibility.toggle();
      return;
    }
    if (action === "possessedJump") {
      event.preventDefault();
      if (!event.repeat && !physicalKeys.has(event.code)) {
        physicalKeys.set(event.code, "jump"); callbacks.onJump?.();
      }
      return;
    }
    if (action === "back") {
      if (!policy.leave && !pointerLocked) return;
      event.preventDefault();
      if (event.repeat) return;
      clearHeldInputs();
      exitLookPointerLock();
      callbacks.onEscape();
      return;
    }
    if (policy.spyglass && action === "spyglass") {
      event.preventDefault();
      if (!event.repeat) callbacks.onSpyglass();
      return;
    }
    if (action === "zoomIn" || action === "zoomOut") {
      event.preventDefault();
      callbacks.onSpyglassZoom?.(action === "zoomIn" ? 1 : -1);
      return;
    }
    if (action === "fullscreen") {
      event.preventDefault();
      if (!event.repeat) toggleFullscreen(documentContext, () => requestLookPointerLock(true), exitLookPointerLock);
      return;
    }
    if (event.repeat && !physicalKeys.has(event.code)) return;
    if (policy.look && (action === "turnLeft" || action === "turnRight")) {
      event.preventDefault();
      const canonical = action === "turnLeft" ? "ArrowLeft" : "ArrowRight";
      physicalKeys.set(event.code, canonical);
      pressedTurnKeys.add(canonical);
      return;
    }
    if (!policy.move || (action !== "forward" && action !== "backward")) return;
    event.preventDefault();
    const canonical = action === "forward" ? "ArrowUp" : "ArrowDown";
    physicalKeys.set(event.code, canonical);
    pressedKeys.add(canonical);
    keyboard = keyboardMovement(pressedKeys);
    emitMovement();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const canonical = physicalKeys.get(event.code);
    if (!canonical) return;
    physicalKeys.delete(event.code);
    if (isCommanderHotkeyAction(canonical)) { callbacks.onCommanderAction?.(canonical, false); return; }
    if (pressedTurnKeys.delete(canonical)) return;
    if (!pressedKeys.delete(canonical)) return;
    keyboard = keyboardMovement(pressedKeys);
    emitMovement();
  };

  // A held old key cannot carry movement across a live settings change.
  const unsubscribeHotkeys = settings.subscribe(clearHeldInputs);

  const onBlur = () => clearHeldInputs();
  const onVisibilityChange = () => {
    if (documentContext?.hidden) clearHeldInputs();
  };
  const onViewportChange = () => clearHeldInputs();

  const detach = () => {
    const look = targets?.look;
    const joystickElement = targets?.joystick;
    const lookStickElement = targets?.lookStick;
    if (look) {
      look.removeEventListener("pointerdown", onLookPointerDown as EventListener);
      look.removeEventListener("pointermove", onLookPointerMove as EventListener);
      look.removeEventListener("pointerup", onLookPointerEnd as EventListener);
      look.removeEventListener("pointercancel", onLookPointerEnd as EventListener);
      look.removeEventListener("lostpointercapture", onLookPointerEnd as EventListener);
    }
    if (joystickElement) {
      joystickElement.removeEventListener("pointerdown", onJoystickPointerDown as EventListener);
      joystickElement.removeEventListener("pointermove", onJoystickPointerMove as EventListener);
      joystickElement.removeEventListener("pointerup", onJoystickPointerEnd as EventListener);
      joystickElement.removeEventListener("pointercancel", onJoystickPointerEnd as EventListener);
      joystickElement.removeEventListener("lostpointercapture", onJoystickPointerEnd as EventListener);
    }
    if (lookStickElement) {
      lookStickElement.removeEventListener("pointerdown", onLookStickPointerDown as EventListener);
      lookStickElement.removeEventListener("pointermove", onLookStickPointerMove as EventListener);
      lookStickElement.removeEventListener("pointerup", onLookStickPointerEnd as EventListener);
      lookStickElement.removeEventListener("pointercancel", onLookStickPointerEnd as EventListener);
      lookStickElement.removeEventListener("lostpointercapture", onLookStickPointerEnd as EventListener);
    }
    if (windowContext && documentContext) unbindListeners?.();
    unbindListeners = null;
    clearHeldInputs();
    targets = null;
    windowContext = null;
    documentContext = null;
    pointerLocked = false;
  };

  const attach = (nextTargets: ExplorationInputTargets) => {
    if (disposed) return () => undefined;
    detach();
    targets = nextTargets;
    const win = options.window ??
      (nextTargets.look.ownerDocument?.defaultView as Window | null) ?? window;
    const doc = options.document ?? nextTargets.look.ownerDocument ?? win.document;
    windowContext = win;
    documentContext = doc;
    nextTargets.look.addEventListener("pointerdown", onLookPointerDown as EventListener);
    nextTargets.look.addEventListener("pointermove", onLookPointerMove as EventListener);
    nextTargets.look.addEventListener("pointerup", onLookPointerEnd as EventListener);
    nextTargets.look.addEventListener("pointercancel", onLookPointerEnd as EventListener);
    nextTargets.look.addEventListener("lostpointercapture", onLookPointerEnd as EventListener);
    nextTargets.joystick.addEventListener("pointerdown", onJoystickPointerDown as EventListener);
    nextTargets.joystick.addEventListener("pointermove", onJoystickPointerMove as EventListener);
    nextTargets.joystick.addEventListener("pointerup", onJoystickPointerEnd as EventListener);
    nextTargets.joystick.addEventListener("pointercancel", onJoystickPointerEnd as EventListener);
    nextTargets.joystick.addEventListener("lostpointercapture", onJoystickPointerEnd as EventListener);
    nextTargets.lookStick?.addEventListener("pointerdown", onLookStickPointerDown as EventListener);
    nextTargets.lookStick?.addEventListener("pointermove", onLookStickPointerMove as EventListener);
    nextTargets.lookStick?.addEventListener("pointerup", onLookStickPointerEnd as EventListener);
    nextTargets.lookStick?.addEventListener("pointercancel", onLookStickPointerEnd as EventListener);
    nextTargets.lookStick?.addEventListener("lostpointercapture", onLookStickPointerEnd as EventListener);
    unbindListeners = bindExplorationInputListeners(win, doc, {
      onBlur,
      onDocumentMouseMove,
      onKeyDown,
      onKeyUp,
      onPointerLockChange,
      onPointerLockError,
      onViewportChange,
      onVisibilityChange
    });
    return detach;
  };

  const applyPolicy = (next: ExplorationInputPolicy) => {
    if ([...COMMANDER_HOTKEY_ACTIONS, "forward", "backward", "turnLeft", "turnRight", "possessedJump",
      "spyglass", "zoomIn", "zoomOut", "fullscreen"]
      .some(action => actionAllowed(policy, action) && !actionAllowed(next, action))) clearHeldInputs();
    policy = { ...next };
    if (!policy.move) {
      for (const [code, action] of physicalKeys) if (action === "jump") physicalKeys.delete(code);
      pressedKeys.clear();
      keyboard = { ...ZERO_MOVEMENT };
      resetJoystick();
      emitMovement();
    }
    if (!policy.look) {
      pressedTurnKeys.clear();
      resetLookStick();
      endLook(true);
      exitLookPointerLock();
    }
  };

  return {
    attach,
    clearHeldInputs,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeHotkeys();
      exitLookPointerLock();
      detach();
    },
    isPointerLocked: () => pointerLocked,
    setPolicy: (next) => {
      requestedPolicy = next;
      applyPolicy(suspended ? SUSPENDED_POLICY : next);
    },
    setSuspended: (next) => {
      if (next === suspended) return;
      suspended = next;
      applyPolicy(next ? SUSPENDED_POLICY : requestedPolicy);
    },
    update: (deltaSeconds) => {
      if (!(deltaSeconds > 0)) return;
      const turn = (pressedTurnKeys.has("ArrowLeft") ? 1 : 0) -
        (pressedTurnKeys.has("ArrowRight") ? 1 : 0);
      const yaw = pendingLook.yaw / deltaSeconds + turn * EXPLORATION_KEYBOARD_TURN_RATE +
        lookStickIntent.yaw * EXPLORATION_LOOK_STICK_RATE;
      const pitch = pendingLook.pitch / deltaSeconds + lookStickIntent.pitch * EXPLORATION_LOOK_STICK_RATE;
      const shouldPublish = yaw !== 0 || pitch !== 0 || emittedLook.yaw !== 0 || emittedLook.pitch !== 0;
      pendingLook = { pitch: 0, yaw: 0 };
      if (!shouldPublish) return;
      emittedLook = { pitch, yaw };
      callbacks.onLook(yaw, pitch);
    }
  };
};
