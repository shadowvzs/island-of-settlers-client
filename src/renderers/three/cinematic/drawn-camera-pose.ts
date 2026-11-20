import { type Camera, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";

import { type CameraState, getViewHalfExtent } from "../../../render-common/camera-state";
import { orbitEye, poseToOrbit } from "../../../render-common/cinematic/camera-orbit";
import type { CinematicPoint, DrawnCameraPose } from "../../../render-common/cinematic/cinematic-frame";
import { ISO_PITCH } from "../../../render-common/iso-projection";
import { clampPitch, PERSPECTIVE_FOV_RADIANS } from "../three-camera";

type GroundHeight = (x: number, z: number) => number;

/** On-demand ground search along the look ray of an eye camera without a known focus. */
const RAY_STEP = 2;
const RAY_REACH = 400;
const FALLBACK_FOCUS = 30;

const direction = new Vector3();

const rayFocus = (camera: Camera, groundHeight: GroundHeight) => {
  camera.getWorldDirection(direction);
  if (direction.y >= 0) return FALLBACK_FOCUS;
  const { x, y, z } = camera.position;
  for (let distance = RAY_STEP; distance <= RAY_REACH; distance += RAY_STEP) {
    const pointY = y + direction.y * distance;
    if (pointY <= groundHeight(x + direction.x * distance, z + direction.z * distance)) return distance;
  }
  return FALLBACK_FOCUS;
};

const isoPose = (state: Readonly<CameraState>, target: Readonly<CinematicPoint>): DrawnCameraPose => {
  const fov = PERSPECTIVE_FOV_RADIANS;
  const orbit = {
    distance: getViewHalfExtent(state).halfHeight / Math.tan(fov / 2),
    fov,
    pitch: clampPitch(ISO_PITCH + state.tilt),
    targetX: target.x,
    targetY: target.y,
    targetZ: target.z,
    yaw: state.yaw
  };
  return { eye: orbitEye(orbit), orbit, projection: "orthographic" };
};

const perspectivePose = (camera: PerspectiveCamera, focus: number): DrawnCameraPose => {
  camera.getWorldDirection(direction);
  const { x, y, z } = camera.position;
  const orbit = poseToOrbit({ fov: (camera.fov * Math.PI) / 180, pitch: Math.asin(direction.y),
    x, y, yaw: Math.atan2(direction.x, direction.z), z }, focus);
  return { eye: { x, y, z }, orbit, projection: "perspective" };
};

/**
 * Remembers what the last frame drew (no per-frame allocation) and converts it to the shared pose
 * form only when asked (`TerrainRenderer.currentCameraPose`).
 */
export const createDrawnCameraPose = (groundHeight: GroundHeight) => {
  let lastCamera: Camera | null = null;
  let lastFocus: number | null = null;
  let lastState: Readonly<CameraState> | null = null;
  const lastTarget: CinematicPoint = { x: 0, y: 0, z: 0 };

  /** `focus` null: unknown pivot (possessed eye), searched along the look ray on demand. */
  const record = (camera: Camera, focus: number | null, state: Readonly<CameraState>, target: CinematicPoint) => {
    lastCamera = camera;
    lastFocus = focus;
    lastState = state;
    lastTarget.x = target.x;
    lastTarget.y = target.y;
    lastTarget.z = target.z;
  };

  const read = (): DrawnCameraPose | null => {
    if (!lastCamera || !lastState) return null;
    if (lastCamera instanceof OrthographicCamera) return isoPose(lastState, lastTarget);
    if (!(lastCamera instanceof PerspectiveCamera)) return null;
    return perspectivePose(lastCamera, lastFocus ?? rayFocus(lastCamera, groundHeight));
  };

  return { read, record };
};
