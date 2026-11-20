import type { CameraState } from "../../render-common/camera-state";
import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { createCameraFollow, type ObservationSubject } from "../camera-follow";
import { createLazyReactContent } from "../components/lazy-react-content";
import { createExternalStore, isShallowEqual } from "../components/ui-store";
import { createWindowFrame } from "../components/window/window-frame-controller";
import { createSelectedRouteOverlay } from "../selected-route-overlay";
import { appendToLayer, isolatePointer } from "../window-layer";
import {
  getObservationView, isCameraKey, isTap, isTypingKey, OBSERVATION_HEADING, type ObservationPickKind
} from "./helpers";

type Resolve = () => ObservationSubject | null;
interface ObservationOptions {
  camera: CameraState;
  canvas: HTMLCanvasElement;
  mapSize: readonly [number, number];
  height: (x: number, z: number) => number;
  pickWorker: (x: number, y: number) => Resolve | null;
  pickShip: (id: string) => Resolve | null;
  renderer: Pick<TerrainRenderer, "pickShip" | "projectToViewport">;
  viewport: HTMLElement;
}

const REFRESH_SECONDS = 0.5;
const ISOLATED_EVENTS = ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu"];

/**
 * Explicit inspection mode never selects units or issues a simulation/military command. Picking (capture
 * listeners that intercept canvas presses), follow and the route overlay stay here; the window body is
 * React, loaded on the first open and fed by a view store refreshed every 0.5 s while open.
 */
export const createObservationPanel = (options: ObservationOptions) => {
  const follower = createCameraFollow(options.camera, options.mapSize);
  const overlay = createSelectedRouteOverlay({ viewport: options.viewport,
    height: options.height, project: options.renderer.projectToViewport, subject: follower.subject });
  let picking: ObservationPickKind | null = null;
  let start: { id: number; x: number; y: number } | null = null;
  const pointers = new Set<number>();
  let routeEnabled = false;
  let uiAge = 0;
  const view = createExternalStore(getObservationView({ following: false, picking, routeEnabled, subject: null }));
  const resetRoute = () => { routeEnabled = false; overlay.setEnabled(false); };
  const content = document.createElement("div");
  content.className = "settlement-ui__overview";
  const frame = createWindowFrame({
    className: "settlement-ui__observation-window", content, heading: OBSERVATION_HEADING, id: "observation-title",
    onClose: () => { picking = null; start = null; pointers.clear(); follower.clear(); resetRoute(); }
  });
  const refresh = () => {
    const subject = follower.subject();
    if (!subject) resetRoute();
    const next = getObservationView({ following: follower.following(), picking, routeEnabled, subject });
    frame.setTitle(next.title);
    if (!isShallowEqual(next, view.getSnapshot())) view.set(next);
  };
  const body = createLazyReactContent(content, OBSERVATION_HEADING, async () =>
    (await import("./mount")).createObservationMount({
      store: view,
      onFollow: () => { follower.follow(); refresh(); },
      onRoute: () => { routeEnabled = !routeEnabled; overlay.setEnabled(routeEnabled); refresh(); },
      onStop: () => { follower.stop(); refresh(); }
    }));
  const open = () => { frame.open(); body.mount(); };
  const choose = (kind: ObservationPickKind) => {
    resetRoute(); start = null; pointers.clear(); follower.clear(); picking = kind; refresh(); open();
  };
  const pickAt = (x: number, y: number): Resolve | null => {
    if (picking === "worker") return options.pickWorker(x, y);
    const id = options.renderer.pickShip?.(x, y);
    return id == null ? null : options.pickShip(id);
  };
  const onDown = (event: PointerEvent) => {
    if (event.target !== options.canvas) return;
    follower.stop();
    if (!picking) return;
    pointers.add(event.pointerId);
    start = null;
    if (pointers.size === 1 && event.button === 0)
      start = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const onUp = (event: PointerEvent) => {
    if (!picking || !pointers.delete(event.pointerId)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const down = start; start = null;
    if (!down || down.id !== event.pointerId) return;
    if (!isTap(down, { x: event.clientX, y: event.clientY })) return;
    const bounds = options.viewport.getBoundingClientRect();
    const resolve = pickAt(event.clientX - bounds.left, event.clientY - bounds.top);
    if (!resolve || !follower.inspect(resolve)) return;
    picking = null; refresh(); open();
  };
  const onCancel = () => { start = null; pointers.clear(); };
  const onContext = (event: MouseEvent) => {
    if (!picking || event.target !== options.canvas) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const onWheel = (event: WheelEvent) => { if (event.target === options.canvas) follower.stop(); };
  /** Escape cancels picking first, else closes the window when focus is inside it (document capture). */
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return false;
    const focusInside = frame.isOpen() && event.target instanceof Node && frame.contains(event.target);
    if (!picking && !focusInside) return false;
    picking = null; frame.close(); event.preventDefault(); event.stopImmediatePropagation();
    return true;
  };
  const onKey = (event: KeyboardEvent) => {
    if (isTypingKey(event) || closeOnEscape(event)) return;
    if (isCameraKey(event.key)) follower.stop();
  };
  options.viewport.addEventListener("pointerdown", onDown, true);
  options.viewport.addEventListener("pointerup", onUp, true);
  options.viewport.addEventListener("pointercancel", onCancel, true);
  options.viewport.addEventListener("wheel", onWheel, true);
  options.viewport.addEventListener("contextmenu", onContext, true);
  document.addEventListener("keydown", onKey, true);
  const root = appendToLayer(options.viewport, frame.root, "settlement-ui");
  isolatePointer(root, ISOLATED_EVENTS);
  return {
    follower, afterRender: overlay.update,
    followShip: (resolve: Resolve) => {
      frame.close();
      if (!follower.inspect(resolve)) return false;
      return follower.follow();
    },
    /** Camera panel Watch worker / ship: opens the window in picking mode for that kind. */
    startPicking: choose,
    update: (delta: number) => {
      follower.update(delta);
      if (!frame.isOpen()) return;
      uiAge += delta;
      if (uiAge >= REFRESH_SECONDS) { uiAge = 0; refresh(); }
    },
    dispose: () => {
      follower.clear(); overlay.dispose(); body.unmount(); frame.dispose(); root.remove();
      options.viewport.removeEventListener("pointerdown", onDown, true);
      options.viewport.removeEventListener("pointerup", onUp, true);
      options.viewport.removeEventListener("pointercancel", onCancel, true);
      options.viewport.removeEventListener("wheel", onWheel, true);
      options.viewport.removeEventListener("contextmenu", onContext, true);
      document.removeEventListener("keydown", onKey, true);
    }
  };
};
