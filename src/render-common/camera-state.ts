import { DMath } from "../shared/math/deterministic-math";
import { clamp } from "../shared/world/noise";
import { PIXELS_PER_UNIT } from "./iso-projection";

/** The camera: the ground point at the screen centre and a zoom factor. */
export interface CameraState {
  centerX: number;
  centerZ: number;
  /** 1 = a cell diamond is 64 px wide; also multiplied by the device pixel ratio. */
  zoom: number;
  viewportHeight: number;
  viewportWidth: number;
  /**
   * Orbit around the screen centre (radians, 0 = the iso view).
   */
  yaw: number;
  /**
   * Extra pitch (radians) on top of the view's own: positive looks down more steeply, negative
   * flatter; the renderer clamps it so the camera stays above the ground.
   */
  tilt: number;
}

/** Pitch limits of a tilted camera: never flatter than 12 degrees, never past 85. */
export const MIN_PITCH = (12 * Math.PI) / 180;
export const MAX_PITCH = (85 * Math.PI) / 180;

/** Zoom out limit on a 128 x 128 map; bigger maps may zoom out further (getMinZoom). */
const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;
/** The farthest zoom out on any map: the whole 1024 x 1024 world fits a 1600 px wide view. */
const MIN_ZOOM_FLOOR = 0.025;
const MIN_ZOOM_REFERENCE_CELLS = 128;

/** Zoom out limit for a map size: the same overview reach (in screens) up to 512 x 512. */
export const getMinZoom = (cellsX: number, cellsZ: number) => {
  const scaled = (MIN_ZOOM * MIN_ZOOM_REFERENCE_CELLS) / Math.max(cellsX, cellsZ);
  return Math.min(MIN_ZOOM, Math.max(MIN_ZOOM_FLOOR, scaled));
};

export const createCamera = (centerX: number, centerZ: number, zoom: number): CameraState => ({
  centerX,
  centerZ,
  viewportHeight: 1,
  tilt: 0,
  viewportWidth: 1,
  yaw: 0,
  zoom
});

/** Rotates a horizontal vector around the up axis (the same sense as the camera orbit). */
export const rotateAroundUp = (x: number, z: number, yaw: number) => ({
  x: x * DMath.cos(yaw) + z * DMath.sin(yaw),
  z: -x * DMath.sin(yaw) + z * DMath.cos(yaw)
});

export const clampCamera = (camera: CameraState, cellsX: number, cellsZ: number) => {
  camera.zoom = clamp(camera.zoom, getMinZoom(cellsX, cellsZ), MAX_ZOOM);
  camera.centerX = clamp(camera.centerX, 0, cellsX);
  camera.centerZ = clamp(camera.centerZ, 0, cellsZ);
};

/** Zoom differences below this count as being at a limit (float noise of the clamp). */
const ZOOM_LIMIT_EPSILON = 1e-6;

/** Whether the camera can still zoom in (direction 1) or out (-1) on a map of this size. */
export const canZoom = (camera: CameraState, direction: 1 | -1, cellsX: number, cellsZ: number) => {
  if (direction > 0) return camera.zoom < MAX_ZOOM - ZOOM_LIMIT_EPSILON;
  return camera.zoom > getMinZoom(cellsX, cellsZ) + ZOOM_LIMIT_EPSILON;
};

/** Visible half extent in world units along the screen axes (for Three's ortho frustum). */
export const getViewHalfExtent = (camera: CameraState) => ({
  halfHeight: camera.viewportHeight / 2 / (PIXELS_PER_UNIT * camera.zoom),
  halfWidth: camera.viewportWidth / 2 / (PIXELS_PER_UNIT * camera.zoom)
});
