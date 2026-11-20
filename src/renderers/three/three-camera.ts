import { OrthographicCamera, PerspectiveCamera } from "three";

import {
  type CameraState,
  getViewHalfExtent,
  MAX_PITCH,
  MIN_PITCH,
  rotateAroundUp} from "../../render-common/camera-state";
import { ISO_PITCH } from "../../render-common/iso-projection";
import type { ViewMode } from "../../render-common/renderer-contract";
import { clamp, smoothstep } from "../../shared/world/noise";

const ORTHO_DISTANCE = 600;
const PERSPECTIVE_FOV = 30;
/** The perspective view's vertical field of view in radians (the cinematic shots' default). */
export const PERSPECTIVE_FOV_RADIANS = (PERSPECTIVE_FOV * Math.PI) / 180;
const FAR_PITCH = (58 * Math.PI) / 180;
const NEAR_PITCH = (36 * Math.PI) / 180;

export const clampPitch = (pitch: number) => Math.min(MAX_PITCH, Math.max(MIN_PITCH, pitch));

/** Direction towards the camera at a pitch, turned around the up axis by the orbit yaw. */
const getViewDirection = (pitch: number, yaw: number) => {
  const horizontal = Math.cos(pitch) / Math.SQRT2;
  const { x, z } = rotateAroundUp(horizontal, horizontal, yaw);
  return { x, y: Math.sin(pitch), z };
};

/** Minimum clearance of the perspective camera above the ground below it. */
export const GROUND_CLEARANCE = 1.5;
/**
 * The view aims at the ground under the centre, not at sea level (MC-05): a summit in the middle
 * of the screen stays there. The height is a centre-weighted mean of a cross of samples spanning a
 * quarter of the view (panning over a ridge does not bob the view), eased in with this time
 * constant (seconds).
 */
const TARGET_EASING = 0.3;
const TARGET_REACH: [number, number] = [2, 24];
const TARGET_OFFSETS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [.7, .7], [-.7, .7], [.7, -.7], [-.7, -.7]] as const;
/** The centre sample counts this many times (a summit under the centre stays near the middle). */
const CENTRE_WEIGHT = 4;
/** Cinematic line of sight: samples between target and camera, and the largest lift (share of the distance). */
const SIGHT_SAMPLES = 6;
const SIGHT_LIFT_LIMIT = 0.4;

type GroundHeight = (x: number, z: number) => number;

/** Mean ground height over a cross around the view centre (sea level where there is water). */
export const sampleViewGround = (state: CameraState, groundHeight: GroundHeight) => {
  const reach = clamp(getViewHalfExtent(state).halfHeight * 0.25, TARGET_REACH[0], TARGET_REACH[1]);
  let sum = groundHeight(state.centerX, state.centerZ) * (CENTRE_WEIGHT - 1);
  for (const [dx, dz] of TARGET_OFFSETS) sum += groundHeight(state.centerX + dx * reach, state.centerZ + dz * reach);
  return sum / (TARGET_OFFSETS.length + CENTRE_WEIGHT - 1);
};

/**
 * Lift (world units) that keeps the cinematic camera's view of the target clear of the terrain:
 * the ray from the target to the camera rises by `share` of the lift at each sample.
 */
export const getSightLift = (
  target: { x: number; y: number; z: number },
  camera: { x: number; y: number; z: number },
  groundHeight: GroundHeight
) => {
  let lift = 0;
  for (let index = 1; index <= SIGHT_SAMPLES; index += 1) {
    const share = index / (SIGHT_SAMPLES + 1);
    const x = target.x + (camera.x - target.x) * share;
    const z = target.z + (camera.z - target.z) * share;
    const ray = target.y + (camera.y - target.y) * share;
    const blocked = groundHeight(x, z) + GROUND_CLEARANCE - ray;
    if (blocked > 0) lift = Math.max(lift, blocked / share);
  }
  const distance = Math.hypot(camera.x - target.x, camera.y - target.y, camera.z - target.z);
  return Math.min(lift, distance * SIGHT_LIFT_LIMIT);
};

/** The iso view (iso-projection.ts) plus rotation and tilt: orthographic, yaw 45, pitch 30. */
const applyIso = (camera: OrthographicCamera, state: CameraState, targetHeight: number) => {
  const view = getViewDirection(clampPitch(ISO_PITCH + state.tilt), state.yaw);
  const { halfHeight, halfWidth } = getViewHalfExtent(state);
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.position.set(
    state.centerX + view.x * ORTHO_DISTANCE,
    targetHeight + view.y * ORTHO_DISTANCE,
    state.centerZ + view.z * ORTHO_DISTANCE
  );
  camera.lookAt(state.centerX, targetHeight, state.centerZ);
  camera.updateProjectionMatrix();
};

/**
 * Perspective camera: steep when zoomed out (map reading), flatter and closer when
 * zoomed in (scenery). Frames about the same ground area as the iso view at the same zoom.
 */
const applyCinematic = (
  camera: PerspectiveCamera,
  state: CameraState,
  groundHeight: GroundHeight,
  targetHeight: number
) => {
  const { halfHeight } = getViewHalfExtent(state);
  const closeness = smoothstep(0.5, 2.6, state.zoom);
  const pitch = clampPitch(FAR_PITCH + (NEAR_PITCH - FAR_PITCH) * closeness + state.tilt);
  const distance = (halfHeight / Math.tan((PERSPECTIVE_FOV * Math.PI) / 360)) * 1.05;
  const view = getViewDirection(pitch, state.yaw);
  camera.aspect = state.viewportWidth / state.viewportHeight;
  camera.near = Math.max(0.1, distance * 0.05);
  camera.far = distance * 6 + 400;
  const x = state.centerX + view.x * distance;
  const z = state.centerZ + view.z * distance;
  const y = Math.max(targetHeight + view.y * distance, groundHeight(x, z) + GROUND_CLEARANCE);
  const target = { x: state.centerX, y: targetHeight, z: state.centerZ };
  camera.position.set(x, y + getSightLift(target, { x, y, z }, groundHeight), z);
  camera.lookAt(state.centerX, targetHeight, state.centerZ);
  camera.updateProjectionMatrix();
};

/** Seconds after which the eased target jumps instead (first frame, return from a long pause). */
const TARGET_RESET = 1;

/**
 * Holds both cameras; the app switches between the iso and the cinematic view. `now` (ms) eases the
 * target height between frames.
 */
export const createThreeCameraRig = (groundHeight: GroundHeight, now = () => performance.now()) => {
  const iso = new OrthographicCamera(-1, 1, 1, -1, 1, ORTHO_DISTANCE * 3);
  const cinematic = new PerspectiveCamera(PERSPECTIVE_FOV, 1, 1, 1000);
  let mode: ViewMode = "iso";
  let targetHeight = 0;
  let lastTime = Number.NEGATIVE_INFINITY;

  const easeTarget = (state: CameraState) => {
    const wanted = sampleViewGround(state, groundHeight);
    const time = now();
    const seconds = (time - lastTime) / 1000;
    lastTime = time;
    if (!(seconds >= 0 && seconds < TARGET_RESET)) targetHeight = wanted;
    else targetHeight += (wanted - targetHeight) * (1 - Math.exp(-seconds / TARGET_EASING));
  };

  const update = (state: CameraState) => {
    easeTarget(state);
    if (mode === "iso") {
      applyIso(iso, state, targetHeight);
      return iso;
    }
    applyCinematic(cinematic, state, groundHeight, targetHeight);
    return cinematic;
  };

  return {
    getMode: () => mode,
    /** The eased ground height the view aims at (world y of the screen centre's target). */
    getTargetHeight: () => targetHeight,
    setMode: (value: ViewMode) => {
      mode = value;
    },
    update
  };
};
