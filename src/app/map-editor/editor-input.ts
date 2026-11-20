import { TAP_MAX_MOVE_PIXELS } from "../../render-common/pointer-gestures";
import { createMapToolCancel } from "../map-tool-cancel";

/** A ground point (world units). */
export interface GroundPoint {
  x: number;
  z: number;
}

export interface EditorInputOptions {
  /** The map canvas: presses on it paint while a tool is active. */
  canvas: HTMLElement;
  /** A tool is active (else the map reacts as usual). */
  isActive: () => boolean;
  /** Deselects the current tool; accepted edits remain in history. */
  onCancel: () => void;
  /** The ground under the cursor (null off the island) and whether Ctrl is held. */
  onHover: (point: GroundPoint | null, ctrl: boolean) => void;
  /** One stamp of the tool at a ground point (`first`: the press itself, Ctrl held or not). */
  onStamp: (point: GroundPoint, press: StampPress) => void;
  onStrokeEnd: () => void;
  /** Ground under a CSS pixel of the canvas (the renderer's picking), or null off the island. */
  pick: (x: number, y: number) => GroundPoint | null;
  /** World distance between the stamps of a drag. */
  spacing: () => number;
}

/** How a stamp came: the press of a stroke or a later point along it, with or without Ctrl. */
export interface StampPress {
  ctrl: boolean;
  first: boolean;
}

/** Stamps along the drag from the last stamp towards `to`, `spacing` apart (no gaps). */
const listStrokeStamps = (from: GroundPoint, to: GroundPoint, spacing: number) => {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const count = Math.floor(distance / spacing);
  return Array.from({ length: count }, (_, index) => {
    const share = ((index + 1) * spacing) / distance;
    return { x: from.x + (to.x - from.x) * share, z: from.z + (to.z - from.z) * share };
  });
};

/** A touch press waiting to become a stroke: a second finger before that makes it a pinch. */
interface PendingTouch {
  ctrl: boolean;
  point: GroundPoint | null;
  x: number;
  y: number;
}

/**
 * Editor pointer input on the map canvas: while a tool is active a left press stamps it and a
 * drag stamps along the way (`spacing` apart); the press never reaches the camera, felling or
 * worker input. Right click cancels the tool; Shift + drag, middle button and keys move the camera. The hover
 * point drives the brush preview (the press sets it too, `refreshHover` picks it again).
 * On touch the stroke starts once the finger moves (or on its release, a tap stamps once), so
 * a second finger landing first turns it into a pinch zoom without painting.
 */
export const createEditorInput = (options: EditorInputOptions) => {
  const { canvas } = options;
  let lastStamp: GroundPoint | null = null;
  let painting = false;
  let pendingTouch: PendingTouch | null = null;
  /** The pointer of the current stroke (-1: none). */
  let strokePointerId = -1;
  /** The pointer over the canvas (CSS pixels), null once it left. */
  let pointer: { ctrl: boolean; x: number; y: number } | null = null;

  const pickEvent = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    pointer = { ctrl: event.ctrlKey, x, y };
    return options.pick(pointer.x, pointer.y);
  };

  /**
   * Picks the ground under the resting pointer again: the ground or the camera moved under it
   * (an edit raised it, a key pan), so the preview and the next stroke see what is shown now.
   */
  const refreshHover = () => {
    if (!pointer || !options.isActive()) return;
    options.onHover(options.pick(pointer.x, pointer.y), pointer.ctrl);
  };

  const beginStroke = (point: GroundPoint | null, ctrl: boolean) => {
    pendingTouch = null;
    painting = true;
    lastStamp = point;
    if (point) options.onStamp(point, { ctrl, first: true });
  };

  /** Ends the stroke (a pending touch that never moved paints nothing). */
  const endStroke = () => {
    if (painting) options.onStrokeEnd();
    painting = false;
    pendingTouch = null;
    lastStamp = null;
    strokePointerId = -1;
  };

  /** Starts the touch stroke once the finger left the tap radius; false while it waits. */
  const isTouchStrokeReady = (event: PointerEvent) => {
    if (!pendingTouch) return true;
    const moved = Math.hypot(event.clientX - pendingTouch.x, event.clientY - pendingTouch.y);
    if (moved <= TAP_MAX_MOVE_PIXELS) return false;
    beginStroke(pendingTouch.point, pendingTouch.ctrl);
    return true;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (strokePointerId !== -1) {
      if (event.pointerType === "touch") endStroke();
      return;
    }
    if (!options.isActive() || event.button !== 0 || event.shiftKey) return;
    event.stopPropagation();
    canvas.setPointerCapture(event.pointerId);
    strokePointerId = event.pointerId;
    const point = pickEvent(event);
    options.onHover(point, event.ctrlKey);
    if (event.pointerType !== "touch") {
      beginStroke(point, event.ctrlKey);
      return;
    }
    pendingTouch = { ctrl: event.ctrlKey, point, x: event.clientX, y: event.clientY };
  };

  const onPointerMove = (event: PointerEvent) => {
    const point = options.isActive() ? pickEvent(event) : null;
    options.onHover(point, event.ctrlKey);
    if (event.pointerId !== strokePointerId) return;
    event.stopPropagation();
    if (!isTouchStrokeReady(event) || !point) return;
    const press = { ctrl: event.ctrlKey, first: !lastStamp };
    if (!lastStamp) {
      lastStamp = point;
      options.onStamp(point, press);
      return;
    }
    for (const stamp of listStrokeStamps(lastStamp, point, options.spacing())) {
      options.onStamp(stamp, press);
      lastStamp = stamp;
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== strokePointerId) return;
    event.stopPropagation();
    if (pendingTouch && event.type === "pointerup") {
      beginStroke(pendingTouch.point, pendingTouch.ctrl);
    }
    endStroke();
  };

  const onPointerLeave = () => {
    pointer = null;
    options.onHover(null, false);
  };

  /** Ctrl pressed or let go over a resting pointer: the preview flips at once (raise / lower). */
  const onControlKey = (event: KeyboardEvent) => {
    if (event.key !== "Control" || !pointer) return;
    pointer.ctrl = event.type === "keydown";
  };
  const keyTarget = canvas.ownerDocument?.defaultView ?? null;
  const stopCancellation = createMapToolCancel({
    active: options.isActive,
    cancel: () => { endStroke(); options.onCancel(); options.onHover(null, false); },
    surface: canvas
  });

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  keyTarget?.addEventListener("keydown", onControlKey);
  keyTarget?.addEventListener("keyup", onControlKey);
  const dispose = () => {
    stopCancellation();
    keyTarget?.removeEventListener("keydown", onControlKey);
    keyTarget?.removeEventListener("keyup", onControlKey);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
  };
  return { dispose, refreshHover };
};
