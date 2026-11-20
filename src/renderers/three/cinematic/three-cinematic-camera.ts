import {
  type Camera,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3
} from "three";

import { type CameraState, getMinZoom, MAX_ZOOM } from "../../../render-common/camera-state";
import { clampOrbitPitch, orbitEye, poseToOrbit } from "../../../render-common/cinematic/camera-orbit";
import type {
  CameraOrbit,
  CinematicFrame,
  CinematicPoint,
  CinematicShake,
  CinematicViewLimits
} from "../../../render-common/cinematic/cinematic-frame";
import { PIXELS_PER_UNIT } from "../../../render-common/iso-projection";
import { clamp, lerp } from "../../../shared/world/noise";
import { GROUND_CLEARANCE, PERSPECTIVE_FOV_RADIANS } from "../three-camera";

type GroundHeight = (x: number, z: number) => number;

export interface CinematicCameraOptions {
  cellsX: number;
  cellsZ: number;
  groundHeight: GroundHeight;
  limits: Readonly<CinematicViewLimits>;
}

export interface CinematicCameraSample {
  /** Eased weight of the override over the underlying camera (0..1). */
  blend: number;
  camera: PerspectiveCamera;
  /** Pivot distance of the drawn pose (the framed point lies this far along the look ray). */
  focusDistance: number;
  /**
   * Level-of-detail stand-in for the RTS camera while the override draws: the centre at the framed
   * point and the zoom that frames the same half height. Never written back to the gameplay camera.
   */
  lodCamera: CameraState;
}

/** Near plane share of the focus distance, and its limits (world units). */
const NEAR_SHARE = 0.02;
const NEAR_LIMITS: [number, number] = [0.1, 4];
/** Far plane: the RTS cinematic rig's rule (a multiple of the distance plus a horizon margin). */
const FAR_SHARE = 6;
const FAR_MARGIN = 400;
const MIN_FAR_TO_NEAR = 50;

const toTarget = new Vector3();
const underPosition = new Vector3();
const underQuaternion = new Quaternion();

const nearFor = (focus: number) => clamp(focus * NEAR_SHARE, NEAR_LIMITS[0], NEAR_LIMITS[1]);

/** The perspective equivalent of an orthographic view: the same aim, framing the same half height. */
const isoEquivalent = (camera: OrthographicCamera, target: CinematicPoint, fov: number) => {
  const halfHeight = (camera.top - camera.bottom) / 2 / camera.zoom;
  const distance = halfHeight / Math.tan(fov / 2);
  camera.getWorldDirection(toTarget);
  underPosition.set(target.x, target.y, target.z).addScaledVector(toTarget, -distance);
  underQuaternion.copy(camera.quaternion);
  return distance;
};

const lodZoom = (viewportHeight: number, focus: number, fov: number) =>
  viewportHeight / (2 * PIXELS_PER_UNIT * Math.max(1e-3, focus * Math.tan(fov / 2)));

/** Applies a shake offset in camera space; every rig rebuilds its camera each frame, so nothing accumulates. */
export const applyCameraShake = (camera: Camera, shake: Readonly<CinematicShake> | null | undefined) => {
  if (!shake) return;
  if (shake.x === 0 && shake.y === 0 && shake.yaw === 0 && shake.pitch === 0) return;
  camera.translateX(shake.x);
  camera.translateY(shake.y);
  camera.rotateY(shake.yaw);
  camera.rotateX(shake.pitch);
  camera.updateMatrixWorld();
};

/**
 * The campaign cinematic camera (CIN2): draws `FrameState.cinematic.camera` with the top priority
 * (cinematic > exploration > RTS rig). The orbit pitch is clamped per detail level about the framed
 * point, the eye kept above the ground, and the far plane capped (Minimal). No render target, no pass.
 */
export const createThreeCinematicCamera = ({ cellsX, cellsZ, groundHeight, limits }: CinematicCameraOptions) => {
  const camera = new PerspectiveCamera(30, 1, 1, 1000);
  camera.name = "campaign-cinematic-camera";
  const lodCamera: CameraState = { centerX: 0, centerZ: 0, tilt: 0, viewportHeight: 1, viewportWidth: 1, yaw: 0,
    zoom: 1 };
  const sample: CinematicCameraSample = { blend: 1, camera, focusDistance: 1, lodCamera };

  /** Places the camera on the clamped orbit; returns the orbit actually drawn. */
  const placeOrbit = (orbit: CameraOrbit) => {
    const eye = orbitEye(orbit);
    eye.y = Math.max(eye.y, groundHeight(eye.x, eye.z) + GROUND_CLEARANCE);
    camera.position.set(eye.x, eye.y, eye.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(orbit.targetX, orbit.targetY, orbit.targetZ);
    return camera.position.distanceTo(toTarget.set(orbit.targetX, orbit.targetY, orbit.targetZ));
  };

  /** Lerps the position and slerps the orientation from the camera underneath (blend < 1). */
  const blendFromUnderlying = (underlying: Camera, rtsTarget: CinematicPoint, blend: number, focus: number) => {
    let underFocus = focus;
    let underFov = camera.fov;
    let underNear = camera.near;
    let underFar = camera.far;
    if (underlying instanceof OrthographicCamera)
      underFocus = isoEquivalent(underlying, rtsTarget, (camera.fov * Math.PI) / 180);
    else {
      underPosition.copy(underlying.position);
      underQuaternion.copy(underlying.quaternion);
      if (underlying instanceof PerspectiveCamera) {
        underFov = underlying.fov;
        underNear = underlying.near;
        underFar = underlying.far;
      }
    }
    camera.position.lerpVectors(underPosition, camera.position, blend);
    camera.quaternion.slerpQuaternions(underQuaternion, camera.quaternion, blend);
    camera.fov = lerp(underFov, camera.fov, blend);
    camera.near = lerp(underNear, camera.near, blend);
    camera.far = lerp(underFar, camera.far, blend);
    return lerp(underFocus, focus, blend);
  };

  /** The framed point of the drawn camera and the zoom that shows the same half height there. */
  const fillLodCamera = (state: Readonly<CameraState>, yaw: number, focus: number) => {
    camera.getWorldDirection(toTarget);
    lodCamera.viewportHeight = state.viewportHeight;
    lodCamera.viewportWidth = state.viewportWidth;
    lodCamera.centerX = clamp(camera.position.x + toTarget.x * focus, 0, cellsX);
    lodCamera.centerZ = clamp(camera.position.z + toTarget.z * focus, 0, cellsZ);
    lodCamera.yaw = yaw;
    lodCamera.tilt = 0;
    lodCamera.zoom = clamp(lodZoom(state.viewportHeight, focus, (camera.fov * Math.PI) / 180),
      getMinZoom(cellsX, cellsZ), MAX_ZOOM);
  };

  /** Null without an override; otherwise the camera to draw with and its LOD stand-in. */
  const update = (
    cinematic: Readonly<CinematicFrame> | undefined,
    state: Readonly<CameraState>,
    underlying: Camera,
    rtsTarget: CinematicPoint
  ): CinematicCameraSample | null => {
    const override = cinematic?.camera;
    if (!override) return null;
    const requested = poseToOrbit(override.pose, cinematic.focusDistance);
    const orbit = clampOrbitPitch(requested, limits.minPitch);
    camera.fov = (clamp(orbit.fov || PERSPECTIVE_FOV_RADIANS, 0.05, 2.6) * 180) / Math.PI;
    let focus = placeOrbit(orbit);
    camera.near = nearFor(focus);
    camera.far = Math.max(camera.near * MIN_FAR_TO_NEAR,
      Math.min(focus * FAR_SHARE + FAR_MARGIN, limits.far, override.pose.viewDistance ?? Infinity));
    const blend = clamp(override.blend, 0, 1);
    if (blend < 1) focus = blendFromUnderlying(underlying, rtsTarget, blend, focus);
    camera.aspect = Math.max(1, state.viewportWidth) / Math.max(1, state.viewportHeight);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    fillLodCamera(state, orbit.yaw, focus);
    sample.blend = blend;
    sample.focusDistance = focus;
    return sample;
  };

  return { camera, update };
};

export type ThreeCinematicCamera = ReturnType<typeof createThreeCinematicCamera>;
