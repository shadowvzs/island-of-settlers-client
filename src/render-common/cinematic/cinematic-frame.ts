/**
 * Render-facing campaign cinematic data (CIN2). Like the exploration frame these values are transient
 * presentation state: they never enter a save, a command log or the RTS `CameraState`, which stays
 * untouched (and keeps feeding wildlife, the minimap and saving) while a sequence plays.
 */
import type { ExplorationCameraOverride } from "../exploration/exploration-frame";

/** A world point (x/z on the map, y up). */
export interface CinematicPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * A camera in orbit form, stored in world units so it frames the same ground on any viewport
 * (the shape of the plan's `CameraShot`, without the editor id/name).
 */
export interface CameraOrbit {
  /** Orbit target (the point the camera looks at). */
  targetX: number;
  targetY: number;
  targetZ: number;
  /** Radians, the same sense as `CameraState.yaw` (0 = the iso view direction). */
  yaw: number;
  /** Radians above the horizon (positive looks down onto the target). */
  pitch: number;
  /** Eye-to-target distance in world units. */
  distance: number;
  /** Vertical field of view in radians. */
  fov: number;
}

/** Camera shake as a pure offset on the drawn camera (radians and world units, camera space). */
export interface CinematicShake {
  /** Turn left/right and up/down (radians). */
  yaw: number;
  pitch: number;
  /** Shift along the camera's right and up axes (world units). */
  x: number;
  y: number;
}

/** One highlighted area: the glint layer spreads its sparkles over these map cells. */
export interface CinematicGlint {
  /** Row-major cell indices (`z * cellsX + x`); the renderer rebuilds when this array changes identity. */
  cells: Readonly<Int32Array>;
}

export interface CinematicFrame {
  /**
   * The cinematic camera, highest priority (cinematic > exploration > RTS rig). `pose` is the eye pose
   * (mode "eye"); `blend` is the eased weight over the camera drawn underneath: 1 draws the pose
   * exactly, lower values lerp the position and slerp the orientation from the underlying camera
   * (used to hand back to a possessed eye that may still move). Null: no override.
   */
  camera: ExplorationCameraOverride | null;
  /**
   * Distance from the eye to the framed point along the look ray (world units). The renderer pivots
   * the Minimal pitch clamp about that point and reports it as the orbit target.
   */
  focusDistance: number;
  /** Highlighted areas drawn by the region glint layer (one instanced draw for all). */
  glints: readonly CinematicGlint[];
  /** Null or zero: no shake. Applied to the cinematic camera only while its override draws (CIN6). */
  shake: CinematicShake | null;
}

/**
 * The pose the renderer actually drew last frame: the record button and the first transition start
 * from it. An orthographic (iso) view reports its perspective equivalent: the same target, yaw and
 * pitch, at the distance that frames the same half height with `orbit.fov`.
 */
export interface DrawnCameraPose {
  eye: CinematicPoint;
  orbit: CameraOrbit;
  projection: "orthographic" | "perspective";
}

/** Per detail level limits of the cinematic camera (QualityPreset.cinematicView). */
export interface CinematicViewLimits {
  /** Far plane cap in world units (Infinity: the distance-derived far plane). */
  far: number;
  /** Sparkles per highlighted area. */
  glintSprites: number;
  /** Lowest orbit pitch (radians above the horizon); flatter shots are lifted about their target. */
  minPitch: number;
}
