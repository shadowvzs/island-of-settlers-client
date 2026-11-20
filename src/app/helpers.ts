import { type CameraState,rotateAroundUp } from "../render-common/camera-state";
import { projectToScreen, unprojectToPlane, type ViewportPoint } from "../render-common/iso-projection";

/**
 * Ground corners (world x, z) of what the camera shows: the viewport corners projected onto the
 * ground plane around the centre, turned with the camera orbit; clockwise from top left.
 */
export const getViewOutline = (camera: CameraState) => {
  const centre = projectToScreen(camera.centerX, 0, camera.centerZ);
  const halfWidth = camera.viewportWidth / 2 / camera.zoom;
  const halfHeight = camera.viewportHeight / 2 / camera.zoom;
  const corners: [number, number][] = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight]
  ];
  return corners.map(([dx, dy]) => {
    const ground = unprojectToPlane(centre.screenX + dx, centre.screenY + dy, 0);
    const turned = rotateAroundUp(ground.x - camera.centerX, ground.z - camera.centerZ, camera.yaw);
    return { x: camera.centerX + turned.x, z: camera.centerZ + turned.z };
  });
};

/** Whether a projected point lies inside the view's depth range (debug overlays skip the others). */
export const isOnScreen = (point: ViewportPoint) => Number.isFinite(point.x) && Number.isFinite(point.y) &&
  Number.isFinite(point.depth) && Math.abs(point.depth) <= 1;

/** Sizes an overlay canvas to the viewport at the device pixel ratio; returns the ratio. */
export const fitCanvasToViewport = (canvas: HTMLCanvasElement, viewport: HTMLElement) => {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(viewport.clientWidth * ratio);
  const height = Math.round(viewport.clientHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return ratio;
};

/** A transparent canvas right above the map canvas (drawn over the view, under the panels). */
export const createOverlayCanvas = (viewport: HTMLElement, className: string) => {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  const view = viewport.querySelector("canvas");
  if (view) view.after(canvas);
  else viewport.append(canvas);
  return canvas;
};

/** Width and height in CSS px. */
export interface BoxSize {
  height: number;
  width: number;
}

interface Point {
  x: number;
  y: number;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** A box's top-left `corner` moved so the box stays inside `bounds`, `margin` from each edge. */
export const clampBoxCorner = (corner: Point, size: BoxSize, bounds: BoxSize, margin = 0): Point => ({
  x: clamp(corner.x, margin, bounds.width - size.width - margin),
  y: clamp(corner.y, margin, bounds.height - size.height - margin)
});

/**
 * A plain DOM hover tooltip over the map viewport (scene overlay, below the windows): hidden until moved to
 * its top-left corner; callers keep the corner inside `bounds()` with `clampBoxCorner`.
 */
export const createMapTooltip = (viewport: HTMLElement, className: string) => {
  const element = document.createElement("div");
  element.className = className;
  element.hidden = true;
  viewport.append(element);
  return {
    element,
    bounds: (): BoxSize => ({ height: viewport.clientHeight, width: viewport.clientWidth }),
    hide: () => { element.hidden = true; },
    /** Shows it and reads its rendered size (one layout read; call it after a content change). */
    measure: (): BoxSize => {
      element.hidden = false;
      return { height: element.offsetHeight, width: element.offsetWidth };
    },
    /** Shows it with its top-left corner at `corner` (viewport CSS px). */
    moveTo: (corner: Point) => {
      element.style.transform = `translate(${corner.x}px, ${corner.y}px)`;
      element.hidden = false;
    },
    dispose: () => element.remove()
  };
};

/** The pointer's position relative to the viewport (CSS px). */
export const getViewportPoint = (viewport: HTMLElement, event: PointerEvent): Point => {
  const bounds = viewport.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
};

/** An IndexedDB request as a promise (rejects with the request's error). */
export const requestToPromise = <T>(operation: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });

/** The download keeps its URL a while (some browsers start it late). */
const REVOKE_DELAY_MS = 10_000;

/** Hands a blob to the browser as a file download. */
export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
};

/** Downloads a value as a JSON file (game save, account file). */
export const downloadJson = (value: unknown, fileName: string) =>
  downloadBlob(new Blob([JSON.stringify(value)], { type: "application/json" }), fileName);

/** The message of a thrown Error, else `fallback` (anything else may be thrown). */
export const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
