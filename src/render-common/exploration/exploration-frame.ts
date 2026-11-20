/**
 * Render-facing exploration data (EXPLORE-01A). These values are transient presentation state: they never
 * enter a save, a command log, the authority fog arrays or the gameplay camera used by wildlife/lifecycle
 * updates. The renderer may consume them for one frame and then forget them.
 */

/** Base vertical field of view for the possessed eye camera (68 degrees). */
export const EXPLORATION_FIELD_OF_VIEW = (68 * Math.PI) / 180;

/** An eye/transition pose in world units. Not the saved RTS CameraState. */
export interface ExplorationPose {
  /** Eye x/z and the ground or eye y used by the renderer. */
  x: number;
  y: number;
  z: number;
  /** Look angles in radians: yaw around up, pitch from the horizontal (up positive). */
  yaw: number;
  pitch: number;
  /** Vertical field of view in radians. */
  fov: number;
  /** Eye height above the ground at x/z (diagnostics/transition interpolation). */
  eyeHeight: number;
  /** Existing rig's world-space support height; its forward eye offset must not sample a new ground base. */
  eyeBaseY?: number;
  /** Camera far limit for this view; the spyglass extends it without touching the shared renderer. */
  viewDistance?: number;
  /** `transition` interpolates from the saved RTS view; `eye` is the playable first-person pose. */
  mode: "transition" | "eye";
}

export interface ExplorationCameraOverride {
  pose: ExplorationPose;
  /** 0 at the saved RTS view, 1 at the playable eye pose; used for the one-way approach/return. */
  blend: number;
}

/** A moving, presentation-only reveal. The renderer composes it; the authority fog stays untouched. */
export interface ExplorationBubble {
  centerX: number;
  centerZ: number;
  radiusCells: number;
  revision: number;
}

export interface ExplorationAppearanceFrame {
  pose: ExplorationPose;
  /** Physical temporary-body height/pose during a hop; omitted for ordinary exploration. */
  feetY?: number;
  jump?: { crouch: number; tuck: number };
  /** False while the body is fully faded into eye view or dissolved. */
  visible: boolean;
  spyglass: boolean;
}

export interface ExplorationSmokeFrame {
  kind: "arrival" | "departure";
  /** 0..1 progress; the renderer owns the actual particle pool. */
  progress: number;
  x: number;
  y: number;
  z: number;
}

/** Opt-in FPS presentation values; null keeps the ordinary isometric weather path. */
export interface ExplorationWeatherFrame {
  active: boolean;
  /** 0..1 storm/rain intensity, copied from the current environment; never drives simulation. */
  rain: number;
  /** A bounded camera-local rain volume follows this pose. */
  cameraX: number;
  cameraY: number;
  cameraZ: number;
}

export interface ExplorationFrame {
  appearance: ExplorationAppearanceFrame | null;
  bubble: ExplorationBubble | null;
  camera: ExplorationCameraOverride | null;
  /** Monotonic within one controller; resets to 0 after `dispose`. */
  revision: number;
  smoke: ExplorationSmokeFrame | null;
  weather: ExplorationWeatherFrame | null;
}

export const EMPTY_EXPLORATION_FRAME: Readonly<ExplorationFrame> = Object.freeze({
  appearance: null,
  bubble: null,
  camera: null,
  revision: 0,
  smoke: null,
  weather: null
});

export const isExplorationFrameActive = (frame: Readonly<ExplorationFrame>) =>
  frame.camera !== null || frame.appearance !== null || frame.bubble !== null || frame.weather !== null;
