import { BUTTON_ZOOM_STEP, zoomAroundCentre } from "../../../render-common/camera-controller";
import { type CameraState,canZoom } from "../../../render-common/camera-state";
import { createExternalStore } from "../../components/ui-store";
import { getZoomLimits } from "./helpers";

/** A press held this long starts zooming continuously. */
const HOLD_DELAY_MS = 350;
/** Zoom factor per second while a button is held. */
const HOLD_ZOOM_PER_SECOND = 2.5;
/** Longest frame gap a held button integrates (no jump after a stalled tab). */
const MAX_HOLD_FRAME_SECONDS = 0.1;

export type ZoomDirection = 1 | -1;

interface ZoomControlOptions {
  camera: CameraState;
  cellsX: number;
  cellsZ: number;
  /** The panel hosting the buttons is shown; the frame loop stops while it is hidden. */
  isShown: () => boolean;
}

interface HeldZoom {
  direction: ZoomDirection;
  since: number;
}

/**
 * Zoom in / out of the camera panel, outside React: a press zooms one step around the screen centre (the
 * wheel's zoom and limits), holding keeps zooming smoothly. While the panel is shown one frame loop applies
 * the hold and checks the limits (also after wheel or pinch zooms); `limits` publishes only on a change, so
 * the buttons re-render only when one reaches or leaves its limit.
 */
export const createZoomControl = ({ camera, cellsX, cellsZ, isShown }: ZoomControlOptions) => {
  const readLimits = () => getZoomLimits(canZoom(camera, 1, cellsX, cellsZ), canZoom(camera, -1, cellsX, cellsZ));
  const limits = createExternalStore(readLimits());
  const mapSize: [number, number] = [cellsX, cellsZ];
  let held: HeldZoom | null = null;
  let lastFrame = 0;
  let running = false;
  let disposed = false;
  let frameHandle = 0;
  let shownZoom = Number.NaN;

  const zoomBy = (direction: ZoomDirection, factor: number) =>
    zoomAroundCentre(camera, factor ** direction, mapSize);
  const release = () => { held = null; };
  const applyHold = (now: number) => {
    if (!held || now - held.since < HOLD_DELAY_MS) return;
    if (!canZoom(camera, held.direction, cellsX, cellsZ)) {
      release();
      return;
    }
    const seconds = Math.min((now - lastFrame) / 1000, MAX_HOLD_FRAME_SECONDS);
    zoomBy(held.direction, HOLD_ZOOM_PER_SECOND ** seconds);
  };
  const syncLimits = () => {
    if (camera.zoom === shownZoom) return;
    shownZoom = camera.zoom;
    limits.set(readLimits());
  };
  const frame = (now: number) => {
    if (disposed) return;
    if (!isShown()) {
      running = false;
      release();
      return;
    }
    applyHold(now);
    lastFrame = now;
    syncLimits();
    frameHandle = requestAnimationFrame(frame);
  };

  /** Capture phase: the panel stops pointer events from bubbling to the window. */
  const events = new AbortController();
  for (const type of ["pointerup", "pointercancel"] as const) {
    window.addEventListener(type, release, { capture: true, signal: events.signal });
  }
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      events.abort();
      cancelAnimationFrame(frameHandle);
      running = false;
      release();
    },
    limits,
    /** Keyboard presses (Enter / Space) click without a pointer: one step each. */
    click: (direction: ZoomDirection, detail: number) => {
      if (detail === 0) zoomBy(direction, BUTTON_ZOOM_STEP);
    },
    press: (direction: ZoomDirection, button: number) => {
      if (button !== 0) return;
      zoomBy(direction, BUTTON_ZOOM_STEP);
      held = { direction, since: performance.now() };
    },
    /** Starts the frame loop when the panel opens (it ends itself once the panel is hidden). */
    start: () => {
      if (disposed) return;
      syncLimits();
      if (running) return;
      running = true;
      lastFrame = performance.now();
      frameHandle = requestAnimationFrame(frame);
    }
  };
};

export type ZoomControl = ReturnType<typeof createZoomControl>;
