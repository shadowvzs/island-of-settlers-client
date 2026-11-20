/**
 * Pure orbit-camera math of the campaign cinematics (CIN2): orbit <-> eye pose conversion, eases,
 * shot interpolation and the post-arrival drift. Worker safe, no Three.js.
 */
import { clamp, clamp01, lerp, smoothstep01 } from "../../shared/world/noise";
import { MAX_PITCH } from "../camera-state";
import type { ExplorationPose } from "../exploration/exploration-frame";
import { wrapAngle } from "../wildlife/nav/nav-steering";
import type { CameraOrbit, CinematicPoint } from "./cinematic-frame";

export type CinematicEase = "linear" | "easeIn" | "easeOut" | "easeInOut";

/** A slow move after a shot has arrived; every field is optional (plan section 2.4 `CameraDrift`). */
export interface OrbitDrift {
  /** Dolly in/out to this distance. */
  distanceTo?: number;
  /** Optical zoom to this field of view (radians). */
  fovTo?: number;
  /** Tilt by this many radians. */
  pitchBy?: number;
  /** Pan the target to this point. */
  targetTo?: CinematicPoint;
  /** Orbit by this many radians (signed). */
  yawBy?: number;
}

/** Look yaw of the eye pose (0 faces +Z, positive towards +X) minus the orbit yaw. */
const LOOK_YAW_OFFSET = (5 * Math.PI) / 4;
/** Orbit yaw is measured from the iso view direction, which sits 45 degrees off the +Z axis. */
const ISO_AZIMUTH = Math.PI / 4;
const MIN_DISTANCE = 0.5;

export const easeProgress = (ease: CinematicEase, progress: number) => {
  const t = clamp01(progress);
  if (ease === "easeIn") return t * t;
  if (ease === "easeOut") return 1 - (1 - t) * (1 - t);
  if (ease === "easeInOut") return smoothstep01(t);
  return t;
};

/** Unit vector from the target towards the eye. */
export const orbitDirection = (yaw: number, pitch: number): CinematicPoint => {
  const horizontal = Math.cos(pitch);
  return {
    x: horizontal * Math.sin(yaw + ISO_AZIMUTH),
    y: Math.sin(pitch),
    z: horizontal * Math.cos(yaw + ISO_AZIMUTH)
  };
};

export const orbitEye = (orbit: Readonly<CameraOrbit>): CinematicPoint => {
  const direction = orbitDirection(orbit.yaw, orbit.pitch);
  return {
    x: orbit.targetX + direction.x * orbit.distance,
    y: orbit.targetY + direction.y * orbit.distance,
    z: orbit.targetZ + direction.z * orbit.distance
  };
};

/** The eye pose of an orbit, in the exploration pose shape the renderer override consumes. */
export const orbitToPose = (orbit: Readonly<CameraOrbit>): ExplorationPose => {
  const eye = orbitEye(orbit);
  return {
    eyeHeight: eye.y - orbit.targetY,
    fov: orbit.fov,
    mode: "eye",
    pitch: -orbit.pitch,
    x: eye.x,
    y: eye.y,
    yaw: wrapAngle(orbit.yaw + LOOK_YAW_OFFSET),
    z: eye.z
  };
};

/** The orbit whose eye pose is `pose`, pivoting about the point `focusDistance` along its look ray. */
export const poseToOrbit = (
  pose: Readonly<Pick<ExplorationPose, "fov" | "pitch" | "x" | "y" | "yaw" | "z">>,
  focusDistance: number
): CameraOrbit => {
  const distance = Math.max(MIN_DISTANCE, focusDistance);
  const horizontal = Math.cos(pose.pitch);
  return {
    distance,
    fov: pose.fov,
    pitch: -pose.pitch,
    targetX: pose.x + Math.sin(pose.yaw) * horizontal * distance,
    targetY: pose.y + Math.sin(pose.pitch) * distance,
    targetZ: pose.z + Math.cos(pose.yaw) * horizontal * distance,
    yaw: wrapAngle(pose.yaw - LOOK_YAW_OFFSET)
  };
};

/** Lifts a flat shot about its target to `minPitch` (Minimal/phone clamp); the framed point stays. */
export const clampOrbitPitch = (orbit: Readonly<CameraOrbit>, minPitch: number): CameraOrbit => {
  const pitch = clamp(orbit.pitch, Math.min(minPitch, MAX_PITCH), MAX_PITCH);
  if (pitch === orbit.pitch) return orbit;
  return { ...orbit, pitch };
};

/** Shot to shot: target lerp, yaw on the shortest arc, pitch and fov lerp, distance in log space. */
export const interpolateOrbit = (
  from: Readonly<CameraOrbit>,
  to: Readonly<CameraOrbit>,
  amount: number
): CameraOrbit => {
  const fromDistance = Math.max(MIN_DISTANCE, from.distance);
  const toDistance = Math.max(MIN_DISTANCE, to.distance);
  return {
    distance: Math.exp(lerp(Math.log(fromDistance), Math.log(toDistance), amount)),
    fov: lerp(from.fov, to.fov, amount),
    pitch: lerp(from.pitch, to.pitch, amount),
    targetX: lerp(from.targetX, to.targetX, amount),
    targetY: lerp(from.targetY, to.targetY, amount),
    targetZ: lerp(from.targetZ, to.targetZ, amount),
    yaw: wrapAngle(from.yaw + wrapAngle(to.yaw - from.yaw) * amount)
  };
};

/** The drift's end orbit: dolly, orbit, tilt, pan and optical zoom applied to the arrived shot. */
export const driftTarget = (arrived: Readonly<CameraOrbit>, drift: Readonly<OrbitDrift>): CameraOrbit => ({
  distance: drift.distanceTo ?? arrived.distance,
  fov: drift.fovTo ?? arrived.fov,
  pitch: clamp(arrived.pitch + (drift.pitchBy ?? 0), -MAX_PITCH, MAX_PITCH),
  targetX: drift.targetTo?.x ?? arrived.targetX,
  targetY: drift.targetTo?.y ?? arrived.targetY,
  targetZ: drift.targetTo?.z ?? arrived.targetZ,
  // Not wrapped: an orbit of more than half a turn keeps its direction.
  yaw: arrived.yaw + (drift.yawBy ?? 0)
});

/** The drifting orbit at `amount` (0 arrived .. 1 drift end); the yaw follows the signed orbit. */
export const applyDrift = (
  arrived: Readonly<CameraOrbit>,
  drift: Readonly<OrbitDrift>,
  amount: number
): CameraOrbit => {
  const end = driftTarget(arrived, drift);
  const orbit = interpolateOrbit(arrived, end, amount);
  orbit.yaw = wrapAngle(lerp(arrived.yaw, end.yaw, amount));
  return orbit;
};
