import { PerspectiveCamera } from "three";

import type { CameraState } from "../../../render-common/camera-state";
import {
  getViewHalfExtent,
  MAX_PITCH,
  MIN_PITCH,
  rotateAroundUp
} from "../../../render-common/camera-state";
import type {
  ExplorationCameraOverride,
  ExplorationPose
} from "../../../render-common/exploration/exploration-frame";
import { ISO_PITCH } from "../../../render-common/iso-projection";

/** A render-only camera position; never written back to `CameraState`. */
export interface ExplorationCameraPoint {
  x: number;
  y: number;
  z: number;
}

/** The saved RTS view expressed as a perspective start pose for the approach/return blend. */
export interface ExplorationCameraView {
  fov: number;
  position: ExplorationCameraPoint;
  target: ExplorationCameraPoint;
}

export interface ExplorationCameraOptions {
  /** Stable walking eye height above the ground; the appearance adapter measures the rig. */
  eyeHeight?: number;
  /** Lowest permitted eye height; keeps the near plane out of the terrain. */
  minEyeHeight?: number;
  maxEyeHeight?: number;
  /** Look limits in radians from the horizontal (positive looks up). */
  minPitch?: number;
  maxPitch?: number;
  /** Vertical field of view limits in radians. */
  minFov?: number;
  maxFov?: number;
  near?: number;
  far?: number;
  /** Perspective field of view used for the RTS start view when the app does not supply one. */
  rtsFov?: number;
  /** Minimum pull-back distance so a flat/small viewport cannot put the start camera at the target. */
  minRtsDistance?: number;
  /** Keeps the start camera above the terrain. */
  groundClearance?: number;
  /** Transition poses are never put closer than this to the ground. */
  eyeClearance?: number;
  groundHeight: (x: number, z: number) => number;
  /**
   * Optional exact RTS view resolver (01G can forward the current iso/cinematic camera). The default
   * reconstructs the shared isometric target with a perspective projection.
   */
  rtsView?: (saved: Readonly<CameraState>) => ExplorationCameraView;
  /** Ground height the RTS view aims at (the RTS camera rig's eased target); absent aims at sea level. */
  rtsTargetHeight?: () => number;
}

export interface ExplorationCameraSample {
  applied: boolean;
  blend: number;
  eyeHeight: number;
  fov: number;
  pitch: number;
  position: ExplorationCameraPoint;
  target: ExplorationCameraPoint;
  yaw: number;
}

interface ResolvedCameraOptions
  extends Required<Omit<ExplorationCameraOptions, "rtsView" | "groundHeight" | "rtsTargetHeight">> {
  groundHeight: (x: number, z: number) => number;
  rtsView?: (saved: Readonly<CameraState>) => ExplorationCameraView;
  rtsTargetHeight?: () => number;
}

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
/** Entry/return first frames approach from behind the body before the final eye blend. */
const APPROACH_END = 0.78;
const APPROACH_DISTANCE = 4;
const APPROACH_RISE = 1.2;

const finiteOr = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Wraps a yaw into [-pi, pi]; a yaw holds no saved state and cannot accumulate without bound. */
export const wrapExplorationYaw = (yaw: number) => {
  if (!Number.isFinite(yaw)) return 0;
  const wrapped = ((yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return wrapped >= Math.PI - 1e-12 ? -Math.PI : wrapped;
};

/** Look direction: yaw 0 faces +Z, positive yaw turns towards +X; pitch is up-positive. */
export const explorationLookDirection = (yaw: number, pitch: number): ExplorationCameraPoint => {
  const horizontal = Math.cos(pitch);
  return { x: Math.sin(yaw) * horizontal, y: Math.sin(pitch), z: Math.cos(yaw) * horizontal };
};

/** The one-way approach/return ease. The controller still owns the timing. */
export const explorationBlendEase = (blend: number) => {
  const value = clamp(finiteOr(blend, 0), 0, 1);
  return value * value * (3 - 2 * value);
};

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

const lerpAngle = (from: number, to: number, amount: number) =>
  wrapExplorationYaw(from + wrapExplorationYaw(to - from) * amount);

const directionFromTarget = (position: ExplorationCameraPoint, target: ExplorationCameraPoint) => {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const dz = target.z - position.z;
  const horizontal = Math.hypot(dx, dz);
  return {
    pitch: Math.atan2(dy, Math.max(horizontal, 1e-6)),
    yaw: Math.atan2(dx, dz)
  };
};

/** Camera direction towards a target, so the start view always frames the saved RTS centre. */
const viewFromPosition = (
  position: ExplorationCameraPoint,
  target: ExplorationCameraPoint,
  fov: number
): ExplorationCameraView => ({ fov, position, target });

const sanitiseView = (
  view: ExplorationCameraView,
  options: ResolvedCameraOptions
): ExplorationCameraView => ({
  fov: clamp(finiteOr(view.fov, options.rtsFov), options.minFov, options.maxFov),
  position: {
    x: finiteOr(view.position.x, 0),
    y: finiteOr(view.position.y, 0),
    z: finiteOr(view.position.z, 0)
  },
  target: {
    x: finiteOr(view.target.x, 0),
    y: finiteOr(view.target.y, 0),
    z: finiteOr(view.target.z, 0)
  }
});

const defaultRtsView = (
  saved: Readonly<CameraState>,
  options: ResolvedCameraOptions
): ExplorationCameraView => {
  const { halfHeight } = getViewHalfExtent(saved);
  const fov = clamp(options.rtsFov, options.minFov, options.maxFov);
  const distance = Math.max(halfHeight / Math.tan(fov / 2), options.minRtsDistance);
  const pitch = clamp(ISO_PITCH + finiteOr(saved.tilt, 0), MIN_PITCH, MAX_PITCH);
  const direction = {
    x: Math.cos(pitch) / Math.SQRT2,
    y: Math.sin(pitch),
    z: Math.cos(pitch) / Math.SQRT2
  };
  const turned = rotateAroundUp(direction.x, direction.z, finiteOr(saved.yaw, 0));
  const x = finiteOr(saved.centerX, 0) + turned.x * distance;
  const z = finiteOr(saved.centerZ, 0) + turned.z * distance;
  const targetHeight = finiteOr(options.rtsTargetHeight?.() ?? 0, 0);
  const y = Math.max(
    targetHeight + direction.y * distance,
    options.groundHeight(x, z) + options.groundClearance
  );
  return viewFromPosition(
    { x, y, z },
    { x: finiteOr(saved.centerX, 0), y: targetHeight, z: finiteOr(saved.centerZ, 0) },
    fov
  );
};

const resolveRtsView = (
  saved: Readonly<CameraState>,
  options: ResolvedCameraOptions
): ExplorationCameraView =>
  sanitiseView(options.rtsView ? options.rtsView(saved) : defaultRtsView(saved, options), options);

/** The saved RTS view the blend starts from; exposed so tests and 01G can inspect it without a GPU. */
export const explorationRtsCameraView = (
  saved: Readonly<CameraState>,
  options: ExplorationCameraOptions
): ExplorationCameraView => resolveRtsView(saved, fillFovBounds(resolveOptions(options)));

const resolveOptions = (options: ExplorationCameraOptions): ResolvedCameraOptions => {
  const minFov = clamp(finiteOr(options.minFov ?? 5 * DEG, 5 * DEG), 1 * DEG, 170 * DEG);
  const maxFov = clamp(finiteOr(options.maxFov ?? 85 * DEG, 85 * DEG), 1 * DEG, 170 * DEG);
  const minPitch = clamp(finiteOr(options.minPitch ?? -82 * DEG, -82 * DEG), -89 * DEG, 89 * DEG);
  const maxPitch = clamp(finiteOr(options.maxPitch ?? 82 * DEG, 82 * DEG), -89 * DEG, 89 * DEG);
  const minEyeHeight = clamp(finiteOr(options.minEyeHeight ?? 0.35, 0.35), 0.05, 20);
  const maxEyeHeight = clamp(finiteOr(options.maxEyeHeight ?? 2.6, 2.6), 0.2, 20);
  return {
    eyeHeight: clamp(finiteOr(options.eyeHeight ?? 1.7, 1.7), 0.1, 20),
    eyeClearance: Math.max(0.02, finiteOr(options.eyeClearance ?? 0.4, 0.4)),
    far: Math.max(10, finiteOr(options.far ?? 600, 600)),
    groundClearance: Math.max(0, finiteOr(options.groundClearance ?? 0.5, 0.5)),
    groundHeight: options.groundHeight,
    maxEyeHeight,
    maxFov,
    maxPitch,
    minEyeHeight,
    minFov,
    minPitch,
    minRtsDistance: Math.max(1, finiteOr(options.minRtsDistance ?? 12, 12)),
    near: Math.max(0.01, finiteOr(options.near ?? 0.05, 0.05)),
    rtsFov: clamp(finiteOr(options.rtsFov ?? 30 * DEG, 30 * DEG), 1 * DEG, 170 * DEG),
    rtsTargetHeight: options.rtsTargetHeight,
    rtsView: options.rtsView
  };
};

const fillFovBounds = (options: ResolvedCameraOptions) => {
  if (options.minFov > options.maxFov) {
    const swap = options.minFov;
    options.minFov = options.maxFov;
    options.maxFov = swap;
  }
  if (options.minPitch > options.maxPitch) {
    const swap = options.minPitch;
    options.minPitch = options.maxPitch;
    options.maxPitch = swap;
  }
  if (options.minEyeHeight > options.maxEyeHeight) {
    const swap = options.minEyeHeight;
    options.minEyeHeight = options.maxEyeHeight;
    options.maxEyeHeight = swap;
  }
  options.rtsFov = clamp(options.rtsFov, options.minFov, options.maxFov);
  return options;
};

/**
 * Sanitises an exploration pose for rendering: bounded pitch/FOV, wrapped yaw, and an eye height taken
 * from the rig above the current ground. No saved or gameplay camera data is read or written.
 */
export const clampExplorationPose = (
  pose: Readonly<ExplorationPose>,
  options: ExplorationCameraOptions
): ExplorationPose => {
  const resolved = fillFovBounds(resolveOptions(options));
  const x = finiteOr(pose.x, 0);
  const z = finiteOr(pose.z, 0);
  const ground = finiteOr(resolved.groundHeight(x, z), 0);
  const requestedEyeHeight = clamp(
    finiteOr(pose.eyeHeight, resolved.eyeHeight),
    resolved.minEyeHeight,
    resolved.maxEyeHeight
  );
  const eyeBaseY = typeof pose.eyeBaseY === "number" && Number.isFinite(pose.eyeBaseY)
    ? pose.eyeBaseY : undefined;
  let eyeY = ground + requestedEyeHeight;
  if (eyeBaseY !== undefined)
    eyeY = Math.max(eyeBaseY + requestedEyeHeight, ground + resolved.eyeClearance);
  const y = pose.mode === "eye"
    ? eyeY
    : Math.max(finiteOr(pose.y, ground + requestedEyeHeight), ground + resolved.eyeClearance);
  const clamped: ExplorationPose = {
    eyeHeight: requestedEyeHeight,
    fov: clamp(finiteOr(pose.fov, 65 * DEG), resolved.minFov, resolved.maxFov),
    mode: pose.mode,
    pitch: clamp(finiteOr(pose.pitch, 0), resolved.minPitch, resolved.maxPitch),
    viewDistance: clamp(finiteOr(pose.viewDistance ?? resolved.far, resolved.far), 40, 1_200),
    x,
    y,
    yaw: wrapExplorationYaw(pose.yaw),
    z
  };
  if (eyeBaseY !== undefined) clamped.eyeBaseY = eyeBaseY;
  return clamped;
};

const applyView = (
  camera: PerspectiveCamera,
  position: ExplorationCameraPoint,
  yaw: number,
  pitch: number,
  fov: number,
  far: number,
  saved: Readonly<CameraState>,
  options: ResolvedCameraOptions
) => {
  const width = Math.max(1, finiteOr(saved.viewportWidth, 1));
  const height = Math.max(1, finiteOr(saved.viewportHeight, 1));
  camera.aspect = width / height;
  camera.near = options.near;
  camera.far = far;
  camera.position.set(position.x, position.y, position.z);
  camera.up.set(0, 1, 0);
  const direction = explorationLookDirection(yaw, pitch);
  camera.lookAt(
    position.x + direction.x,
    position.y + direction.y,
    position.z + direction.z
  );
  camera.fov = (fov * 180) / Math.PI;
  camera.updateProjectionMatrix();
};

/**
 * A transient perspective rig used only while an `ExplorationCameraOverride` is present. It keeps no
 * saved/gameplay CameraState: every update rebuilds the start view from the caller's snapshot and the
 * blend, so save capture and wildlife continue to read the untouched RTS camera.
 */
export const createExplorationCameraRig = (options: ExplorationCameraOptions) => {
  const resolved = fillFovBounds(resolveOptions(options));
  const camera = new PerspectiveCamera(65, 1, resolved.near, resolved.far);
  camera.name = "exploration-first-person-camera";

  const update = (
    saved: Readonly<CameraState>,
    override: ExplorationCameraOverride | null
  ): ExplorationCameraSample => {
    const startView = resolveRtsView(saved, resolved);
    const startDirection = directionFromTarget(startView.position, startView.target);
    if (!override) {
      applyView(camera, startView.position, startDirection.yaw, startDirection.pitch,
        startView.fov, resolved.far, saved, resolved);
      return {
        applied: false,
        blend: 0,
        eyeHeight: resolved.eyeHeight,
        fov: startView.fov,
        pitch: startDirection.pitch,
        position: { ...startView.position },
        target: { ...startView.target },
        yaw: startDirection.yaw
      };
    }

    const pose = clampExplorationPose(override.pose, resolved);
    const amount = explorationBlendEase(override.blend);
    // Do not slide straight from the RTS overview into the head: hold a third-person approach
    // behind the body first, aimed at the settler, then blend into the eye. This makes the
    // possession transition show the unit instead of looking past it at the horizon.
    const forwardX = Math.sin(pose.yaw);
    const forwardZ = Math.cos(pose.yaw);
    const chaseX = pose.x - forwardX * APPROACH_DISTANCE;
    const chaseZ = pose.z - forwardZ * APPROACH_DISTANCE;
    const chase = {
      x: chaseX,
      y: Math.max(pose.y + APPROACH_RISE, resolved.groundHeight(chaseX, chaseZ) + resolved.eyeClearance),
      z: chaseZ
    };
    const bodyTarget = { x: pose.x, y: pose.y - 0.1, z: pose.z };
    let position: ExplorationCameraPoint;
    let yaw: number;
    let pitch: number;
    if (amount < APPROACH_END) {
      const approach = explorationBlendEase(amount / APPROACH_END);
      position = {
        x: lerp(startView.position.x, chase.x, approach),
        y: lerp(startView.position.y, chase.y, approach),
        z: lerp(startView.position.z, chase.z, approach)
      };
      const toBody = directionFromTarget(position, bodyTarget);
      yaw = toBody.yaw;
      pitch = toBody.pitch;
    } else {
      const eye = explorationBlendEase((amount - APPROACH_END) / (1 - APPROACH_END));
      position = {
        x: lerp(chase.x, pose.x, eye),
        y: lerp(chase.y, pose.y, eye),
        z: lerp(chase.z, pose.z, eye)
      };
      const chaseLook = directionFromTarget(chase, bodyTarget);
      yaw = lerpAngle(chaseLook.yaw, pose.yaw, eye);
      pitch = lerp(chaseLook.pitch, pose.pitch, eye);
    }
    if (amount === 1) {
      position = { x: pose.x, y: pose.y, z: pose.z };
      yaw = pose.yaw;
      pitch = pose.pitch;
    }
    const fov = lerp(startView.fov, pose.fov, amount);
    const far = lerp(resolved.far, pose.viewDistance ?? resolved.far, amount);
    applyView(camera, position, yaw, pitch, fov, far, saved, resolved);
    const direction = explorationLookDirection(yaw, pitch);
    return {
      applied: true,
      blend: amount,
      eyeHeight: pose.eyeHeight,
      fov,
      pitch,
      position,
      target: {
        x: position.x + direction.x,
        y: position.y + direction.y,
        z: position.z + direction.z
      },
      yaw
    };
  };

  return {
    camera,
    /** Releases nothing GPU-owned, but lets 01G call one idempotent teardown for every adapter. */
    dispose: () => { camera.removeFromParent(); },
    options: resolved,
    update
  };
};
