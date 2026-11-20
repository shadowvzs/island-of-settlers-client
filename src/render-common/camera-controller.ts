import { clamp } from "../shared/world/noise";
import {
  cameraDragDeadZone,
  type CameraDragMode,
  cameraDragMode,
  DEFAULT_MOUSE_ROTATION,
  type MouseRotation
} from "./camera-drag-mapping";
import { createCameraEdgeCursor } from "./camera-edge-cursor";
import { isPrimaryDragSelecting, isShiftDragSelecting } from "./camera-input-mode";
import { type CameraState,clampCamera, rotateAroundUp } from "./camera-state";
import { projectToScreen, unprojectToPlane } from "./iso-projection";
import {
  getPinchZoomFactor,
  measurePinch,
  type PinchFrame,
  type PointerPoint
} from "./pointer-gestures";

const KEY_PAN_SPEED = 900;
/** CSS pixels from the viewport edge where the pointer scrolls the map (army selection mode). */
const EDGE_SCROLL_MARGIN = 18;
/** Radians per second while Q / E are held, and per CSS pixel of a rotate drag. */
const KEY_ROTATE_SPEED = 1.4;
const DRAG_ROTATE_SPEED = 0.006;
const WHEEL_ZOOM_STEP = 1.0015;
const IOS_GESTURE_EVENTS = ["gesturestart", "gesturechange"] as const;
const PAN_KEYS: Record<string, [number, number]> = {
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1]
};

interface ControllerOptions {
  camera: CameraState;
  cellsX: number;
  cellsZ: number;
  element: HTMLElement;
  /** False while a presentation mode owns the pointer; no camera listener captures it. */
  enabled?: () => boolean;
  /** Settings "Mouse rotation", read at each press (default: middle drag). */
  mouseRotation?: () => MouseRotation;
  /** Turn direction of a held key code (1 left, -1 right, 0 none): the rebindable Q / E hotkeys. */
  rotateKeyTurn?: (code: string) => number;
  /** The map surface inside `element`: only touches that start on it pinch (not the panels). */
  surface: HTMLElement;
}

/**
 * Moves the camera by a screen space offset in CSS pixels: the offset in the unrotated iso view,
 * turned by the camera's yaw, so dragging always follows the screen.
 */
export const panByScreen = (camera: CameraState, deltaX: number, deltaY: number) => {
  const centre = projectToScreen(camera.centerX, 0, camera.centerZ);
  const moved = unprojectToPlane(
    centre.screenX + deltaX / camera.zoom,
    centre.screenY + deltaY / camera.zoom,
    0
  );
  const turned = rotateAroundUp(moved.x - camera.centerX, moved.z - camera.centerZ, camera.yaw);
  camera.centerX += turned.x;
  camera.centerZ += turned.z;
};

const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** -1, 0 or 1 per axis: the pointer rests within `margin` of that edge of `bounds`. */
export const edgeScrollDirection = (
  bounds: Pick<DOMRect, "bottom" | "left" | "right" | "top">, point: PointerPoint, margin = EDGE_SCROLL_MARGIN
) => {
  const axis = (value: number, low: number, high: number) => {
    if (value < low || value > high) return 0;
    if (value <= low + margin) return -1;
    return value >= high - margin ? 1 : 0;
  };
  return { x: axis(point.x, bounds.left, bounds.right), y: axis(point.y, bounds.top, bounds.bottom) };
};

/** Zooms so the ground point under the cursor stays under the cursor. */
const zoomAt = (
  camera: CameraState,
  factor: number,
  offsetX: number,
  offsetY: number,
  limits: [number, number]
) => {
  const before = camera.zoom;
  camera.zoom *= factor;
  clampCamera(camera, limits[0], limits[1]);
  const applied = camera.zoom / before;
  panByScreen(camera, offsetX * (applied - 1), offsetY * (applied - 1));
};

/** One + / - button press zooms by this factor (holding a button zooms on smoothly). */
export const BUTTON_ZOOM_STEP = 1.25;

/** Zooms around the screen centre (the + / - buttons): the wheel's zoom and limits. */
export const zoomAroundCentre = (
  camera: CameraState,
  factor: number,
  limits: [number, number]
) => zoomAt(camera, factor, 0, 0, limits);

/**
 * One pinch step: the ground under the previous finger midpoint moves to the new midpoint
 * (two-finger pan), then zooms by the spread around it, so it stays under the fingers.
 * `centre` is the viewport centre (client CSS pixels).
 */
export const applyPinch = (
  camera: CameraState,
  from: PinchFrame,
  to: PinchFrame,
  centre: PointerPoint,
  limits: [number, number]
) => {
  panByScreen(camera, from.midX - to.midX, from.midY - to.midY);
  const offsetX = to.midX - centre.x;
  const offsetY = to.midY - centre.y;
  zoomAt(camera, getPinchZoomFactor(from, to), offsetX, offsetY, limits);
  clampCamera(camera, limits[0], limits[1]);
};

/**
 * Two touches on the map surface pinch: zoom around their midpoint and pan with it. Listens in
 * the capture phase, so it sees every finger even where the map editor keeps a press for itself.
 * `onPinchStart` stops the one finger drag; `onPinchEnd` hands the finger left over to it.
 */
const createPinchInput = (
  options: ControllerOptions,
  onPinchStart: () => void,
  onPinchEnd: (pointerId: number, point: PointerPoint) => void
) => {
  const { camera, cellsX, cellsZ, element, surface } = options;
  const touches = new Map<number, PointerPoint>();
  let pinch: PinchFrame | null = null;

  const readPinch = () => {
    const [first, second] = touches.values();
    return measurePinch(first!, second!);
  };
  const readCentre = () => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  };

  const onPointerDown = (event: PointerEvent) => {
    if (options.enabled?.() === false) return;
    if (event.pointerType !== "touch") return;
    if (event.isPrimary) touches.clear();
    if (event.target !== surface) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size !== 2) return;
    pinch = readPinch();
    onPinchStart();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (options.enabled?.() === false) return;
    const touch = touches.get(event.pointerId);
    if (!touch) return;
    touch.x = event.clientX;
    touch.y = event.clientY;
    if (!pinch || touches.size < 2) return;
    const next = readPinch();
    applyPinch(camera, pinch, next, readCentre(), [cellsX, cellsZ]);
    pinch = next;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (options.enabled?.() === false) { touches.clear(); return; }
    if (!touches.delete(event.pointerId)) return;
    if (!pinch) return;
    if (touches.size >= 2) {
      pinch = readPinch();
      return;
    }
    pinch = null;
    const [remaining] = touches.entries();
    if (remaining) onPinchEnd(...remaining);
  };

  const types = {
    pointercancel: onPointerUp,
    pointerdown: onPointerDown,
    pointermove: onPointerMove,
    pointerup: onPointerUp
  } as const;
  for (const [type, listener] of Object.entries(types)) {
    element.addEventListener(type as keyof typeof types, listener, { capture: true });
  }
  /** iOS Safari's own pinch page zoom (it ignores user-scalable=no). */
  const preventPageZoom = (event: Event) => event.preventDefault();
  for (const type of IOS_GESTURE_EVENTS) element.addEventListener(type, preventPageZoom);
  return {
    isPinching: () => pinch !== null,
    dispose: () => {
      for (const [type, listener] of Object.entries(types)) {
        element.removeEventListener(type as keyof typeof types, listener, { capture: true });
      }
      for (const type of IOS_GESTURE_EVENTS) element.removeEventListener(type, preventPageZoom);
    }
  };
};

/**
 * Pointer drag pans, wheel and two-finger pinch zoom around the cursor / fingers, arrow keys
 * pan; the "Mouse rotation" button drag rotates (sideways) and tilts (up / down), the rotate hotkeys
 * (Q / E) rotate. In army selection mode the left drag selects, the rotation button drag and the
 * screen edges pan instead. A right drag moves the camera only past the tap radius (dead zone).
 * Input only changes the shared CameraState; the renderer reads it every frame.
 */
export const createCameraController = (options: ControllerOptions) => {
  const { camera, cellsX, cellsZ, element } = options;
  const edgeCursor = createCameraEdgeCursor(options.surface);
  const pressedKeys = new Set<string>();
  let dragging: CameraDragMode | null = null;
  /** The pointer that drags (a second finger pinches instead). */
  let dragPointerId = -1;
  let lastX = 0;
  let lastY = 0;
  /** CSS pixels the press must still travel before the drag moves the camera. */
  let deadZone = 0;
  /** The mouse over the map (edge scrolling), null once it leaves. */
  let hover: PointerPoint | null = null;

  const startDrag = (mode: CameraDragMode, pointerId: number, point: PointerPoint, minimumMove = 0) => {
    dragging = mode;
    dragPointerId = pointerId;
    lastX = point.x;
    lastY = point.y;
    deadZone = minimumMove;
  };
  /** True while the press is still inside its dead zone; leaving it starts the drag from there. */
  const insideDeadZone = (event: PointerEvent) => {
    if (deadZone <= 0) return false;
    if (Math.hypot(event.clientX - lastX, event.clientY - lastY) <= deadZone) return true;
    deadZone = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    return true;
  };
  const pinchInput = createPinchInput(
    options,
    () => (dragging = null),
    (pointerId, point) => {
      if (!isPrimaryDragSelecting()) startDrag("pan", pointerId, point);
    }
  );

  const onPointerDown = (event: PointerEvent) => {
    if (options.enabled?.() === false) return;
    if (event.pointerType !== "mouse") { hover = null; edgeCursor.clear(); }
    if (pinchInput.isPinching()) return;
    // Army selection mode: the left button (or one finger) draws the selection box instead.
    const rotation = options.mouseRotation?.() ?? DEFAULT_MOUSE_ROTATION;
    const primarySelects = isPrimaryDragSelecting() || isShiftDragSelecting(event);
    const mode = cameraDragMode(event.button, rotation, primarySelects);
    if (!mode) return;
    const point = { x: event.clientX, y: event.clientY };
    startDrag(mode, event.pointerId, point, cameraDragDeadZone(event.button));
    element.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (options.enabled?.() === false) return;
    hover = event.pointerType === "mouse" && event.target === options.surface
      ? { x: event.clientX, y: event.clientY } : null;
    if (!dragging || event.pointerId !== dragPointerId || insideDeadZone(event)) return;
    if (dragging === "rotate") {
      camera.yaw = wrapAngle(camera.yaw + (event.clientX - lastX) * DRAG_ROTATE_SPEED);
      camera.tilt = clamp(camera.tilt + (event.clientY - lastY) * DRAG_ROTATE_SPEED, -0.6, 0.95);
    } else {
      panByScreen(camera, lastX - event.clientX, lastY - event.clientY);
    }
    clampCamera(camera, cellsX, cellsZ);
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId === dragPointerId) dragging = null;
  };
  const onPointerLeave = () => { hover = null; edgeCursor.clear(); };
  /** Right taps order and right drags may rotate: no browser menu on the map. */
  const onContextMenu = (event: MouseEvent) => event.preventDefault();
  const onWheel = (event: WheelEvent) => {
    if (options.enabled?.() === false) return;
    event.preventDefault();
    const bounds = element.getBoundingClientRect();
    const offsetX = event.clientX - bounds.left - bounds.width / 2;
    const offsetY = event.clientY - bounds.top - bounds.height / 2;
    zoomAt(camera, Math.pow(WHEEL_ZOOM_STEP, -event.deltaY), offsetX, offsetY, [cellsX, cellsZ]);
  };
  const clearPressedKeys = () => pressedKeys.clear();
  const onBlur = () => { clearPressedKeys(); dragging = null; onPointerLeave(); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (options.enabled?.() === false) return;
    const target = event.target;
    const editing = target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));
    if (event.defaultPrevented || editing) return;
    pressedKeys.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent) => pressedKeys.delete(event.code);

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);
  element.addEventListener("pointerleave", onPointerLeave);
  if (options.surface !== element) options.surface.addEventListener("pointerleave", onPointerLeave);
  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focusin", clearPressedKeys);

  /** In army selection mode the mouse at a screen edge pans (left drag selects there). */
  const updateEdgeScroll = (deltaSeconds: number) => {
    if (!hover || dragging || pinchInput.isPinching() || !isPrimaryDragSelecting()) {
      edgeCursor.clear(); return;
    }
    const direction = edgeScrollDirection(element.getBoundingClientRect(), hover);
    edgeCursor.update(direction);
    if (!direction.x && !direction.y) return;
    const step = KEY_PAN_SPEED * deltaSeconds * camera.zoom;
    panByScreen(camera, direction.x * step, direction.y * step);
    clampCamera(camera, cellsX, cellsZ);
  };

  /** Applies held keys and edge scrolling; call once per frame. */
  const update = (deltaSeconds: number) => {
    updateEdgeScroll(deltaSeconds);
    if (pressedKeys.size === 0) return;
    let moveX = 0;
    let moveY = 0;
    let turn = 0;
    for (const code of pressedKeys) {
      turn += options.rotateKeyTurn?.(code) ?? 0;
      const direction = PAN_KEYS[code];
      if (!direction) continue;
      moveX += direction[0];
      moveY += direction[1];
    }
    const step = KEY_PAN_SPEED * deltaSeconds * camera.zoom;
    panByScreen(camera, moveX * step, moveY * step);
    if (turn !== 0) {
      camera.yaw = wrapAngle(camera.yaw + turn * KEY_ROTATE_SPEED * deltaSeconds);
    }
    clampCamera(camera, cellsX, cellsZ);
  };

  const dispose = () => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointercancel", onPointerUp);
    element.removeEventListener("pointerleave", onPointerLeave);
    if (options.surface !== element) options.surface.removeEventListener("pointerleave", onPointerLeave);
    element.removeEventListener("wheel", onWheel);
    element.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focusin", clearPressedKeys);
    pinchInput.dispose();
    edgeCursor.clear();
  };

  return { dispose, update };
};
