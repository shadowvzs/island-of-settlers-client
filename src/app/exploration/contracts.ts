/**
 * EXPLORE-01A contracts. The exploration mode is a presentation-only session: it owns transient UI, eye pose,
 * smoke and bubble data, but never a domain actor, gameplay command, save field, authority fog byte or the
 * canonical RTS camera. Workers implement these interfaces against the frozen shapes below.
 */
import type { CameraState } from "../../render-common/camera-state";
import {
  EMPTY_EXPLORATION_FRAME,
  type ExplorationAppearanceFrame,
  type ExplorationBubble,
  type ExplorationFrame,
  type ExplorationPose,
  type ExplorationSmokeFrame,
  type ExplorationWeatherFrame
} from "../../render-common/exploration/exploration-frame";
import { actorActionEnabled } from "../../render-common/workers/actor-action-capabilities";
import { COMMANDER_HOTKEY_ACTIONS, type CommanderHotkeyAction } from "../settings/hotkeys/bindings";

export const EXPLORATION_ENTRY_SECONDS = 4;
export const EXPLORATION_POSSESSED_DWELL_SECONDS = 2;
export const EXPLORATION_RETURN_SECONDS = 2;
export const EXPLORATION_DISAPPEAR_SECONDS = 1;
export const EXPLORATION_POST_EFFECT_COOLDOWN_MS = 3_000;
export const EXPLORATION_MIN_EXIT_LOCKOUT_MS = 6_000;
export const EXPLORATION_BUBBLE_RADIUS_CELLS = 8;

export type ExplorationPhase =
  | "idle"
  | "preparing"
  | "entering"
  | "possessed"
  | "returning"
  | "dissipating"
  | "cooldown"
  | "disposed";

export type ExplorationEligibilityReason =
  | "not-home"
  | "not-settlement"
  | "editor"
  | "playback"
  | "sandbox";

export interface ExplorationEligibility {
  eligible: boolean;
  reason?: ExplorationEligibilityReason;
}

/** The active session identity; async preparation results with another identity are released, not installed. */
export interface ExplorationSessionIdentity {
  accountId: string | null;
  slotId: string | null;
  islandKey: string | null;
  /** Incremented by every session/island replacement or forced exit. */
  generation: number;
}

export interface HomeExplorationContext {
  homeIsland: boolean;
  activeColony: number | null;
  activeAdventure: number | null;
  editor: boolean;
  playback: boolean;
  sandbox: boolean;
  settlement: boolean;
}

/**
 * Eligibility reads the active session, not a URL or the mere existence of archived home data. A colony or
 * adventure on screen is ineligible even when its save also carries a home document.
 */
export const homeExplorationEligibility = (context: HomeExplorationContext): ExplorationEligibility => {
  if (context.editor) return { eligible: false, reason: "editor" };
  if (context.playback) return { eligible: false, reason: "playback" };
  if (context.sandbox || !context.settlement) return { eligible: false, reason: context.sandbox ? "sandbox" : "not-settlement" };
  if (!context.homeIsland || context.activeColony !== null || context.activeAdventure !== null)
    return { eligible: false, reason: "not-home" };
  return { eligible: true };
};

/** The UI's immutable view of the controller; high-frequency pose data stays in `ExplorationFrame`. */
export interface ExplorationUiSnapshot {
  /** Actual capability identity; current temporary explorer explicitly uses the canonical Scout job. */
  actorType?: string;
  phase: ExplorationPhase;
  eligibility: ExplorationEligibility;
  /** The entry action is available (home, idle and not cooling down). */
  canEnter: boolean;
  /** Whole milliseconds until normal Leave unlocks; 0 when it is available. */
  leaveUnlockInMs: number;
  /** Whole milliseconds until entry is available again; 0 outside cooldown. */
  cooldownInMs: number;
  spyglass: boolean;
  /** 2× wide through 8× close while the spyglass is raised. */
  spyglassZoom?: number;
  /** A one-line refusal/status for the HUD; absent when there is nothing to say. */
  notice?: string;
  /** Prepare/entry/return progress 0..1 (diagnostics and the approach affordance). */
  progress: number;
}

export interface ExplorationInputPolicy {
  toggleHotkeys?: boolean;
  commander?: Readonly<Partial<Record<CommanderHotkeyAction, boolean>>>;
  jump?: boolean;
  fullscreen?: boolean;
  forward?: boolean;
  backward?: boolean;
  turnLeft?: boolean;
  turnRight?: boolean;
  zoomIn?: boolean;
  zoomOut?: boolean;
  /** Clear/hide normal RTS picking, hover, selection, hotkeys and commands. */
  suppressNormal: boolean;
  move: boolean;
  look: boolean;
  spyglass: boolean;
  leave: boolean;
}

export const explorationInputPolicy = (phase: ExplorationPhase, actorType: unknown = "Scout"): ExplorationInputPolicy => {
  const active = phase === "entering" || phase === "possessed" || phase === "returning" ||
    phase === "dissipating";
  const enabled = (action: string) => phase === "possessed" && actorActionEnabled(actorType, action);
  return {
    toggleHotkeys: enabled("toggleHotkeys"),
    commander: Object.fromEntries(COMMANDER_HOTKEY_ACTIONS.map(action => [action, enabled(action)])),
    jump: enabled("jumping"), fullscreen: enabled("fullscreen"),
    forward: enabled("forward"), backward: enabled("backward"),
    turnLeft: enabled("turnLeft"), turnRight: enabled("turnRight"),
    zoomIn: enabled("zoomIn"), zoomOut: enabled("zoomOut"),
    suppressNormal: active,
    move: enabled("move"),
    look: enabled("look"),
    spyglass: enabled("spyglass"),
    leave: phase === "entering" || phase === "possessed" || phase === "returning" ||
      phase === "dissipating"
  };
};

/** A copy of the canonical RTS camera. Never a reference that an FPS pose could overwrite. */
export const snapshotRtsCamera = (camera: Readonly<CameraState>): CameraState => ({ ...camera });

export const rtsCameraEquals = (left: Readonly<CameraState>, right: Readonly<CameraState>) =>
  left.centerX === right.centerX && left.centerZ === right.centerZ && left.zoom === right.zoom &&
  left.viewportWidth === right.viewportWidth && left.viewportHeight === right.viewportHeight &&
  left.yaw === right.yaw && left.tilt === right.tilt;

/**
 * The camera boundary shared by the save path and the renderer. `savedRts`/`gameplayCamera` always return the
 * untouched RTS snapshot (which is what save capture and wildlife updates consume); only `frame().camera`
 * carries the eye override.
 */
export interface ExplorationCameraBoundary {
  savedRts: () => Readonly<CameraState>;
  gameplayCamera: () => Readonly<CameraState>;
  frame: () => Readonly<ExplorationFrame>;
  setPose: (pose: ExplorationPose | null, blend?: number) => void;
  setBubble: (bubble: ExplorationBubble | null) => void;
  setAppearance: (appearance: ExplorationAppearanceFrame | null) => void;
  setSmoke: (smoke: ExplorationSmokeFrame | null) => void;
  setWeather: (weather: ExplorationWeatherFrame | null) => void;
  clearTransient: () => void;
}

export const createExplorationCameraBoundary = (initial: Readonly<CameraState>): ExplorationCameraBoundary => {
  const saved = snapshotRtsCamera(initial);
  let frame: ExplorationFrame = { ...EMPTY_EXPLORATION_FRAME };
  let revision = 0;
  const publish = (changes: Partial<ExplorationFrame>) => {
    revision++;
    frame = { ...frame, ...changes, revision };
  };
  return {
    savedRts: () => snapshotRtsCamera(saved),
    gameplayCamera: () => snapshotRtsCamera(saved),
    frame: () => frame,
    setPose: (pose, blend = 1) => publish({ camera: pose ? { blend, pose: { ...pose } } : null }),
    setBubble: bubble => publish({ bubble: bubble ? { ...bubble } : null }),
    setAppearance: appearance => publish({ appearance: appearance ? { ...appearance, pose: { ...appearance.pose } } : null }),
    setSmoke: smoke => publish({ smoke: smoke ? { ...smoke } : null }),
    setWeather: weather => publish({ weather: weather ? { ...weather } : null }),
    clearTransient: () => publish({ appearance: null, bubble: null, camera: null, smoke: null, weather: null })
  };
};

/**
 * Exit/cooldown arithmetic in injected elapsed milliseconds. Effects may take longer; the minimum lockout is
 * still `leaveAt + 6 s`, measured from the accepted Leave, and never earlier than 3 s after the effects are gone.
 */
export const explorationReadyAt = (leaveAt: number, effectsGoneAt: number) =>
  Math.max(effectsGoneAt + EXPLORATION_POST_EFFECT_COOLDOWN_MS, leaveAt + EXPLORATION_MIN_EXIT_LOCKOUT_MS);

export const explorationLeaveUnlockAt = (entryCompletedAt: number) =>
  entryCompletedAt + EXPLORATION_POSSESSED_DWELL_SECONDS * 1000;

/** The immutable idle snapshot; controllers replace it rather than mutate it. */
export const createIdleExplorationSnapshot = (
  eligibility: ExplorationEligibility = { eligible: false, reason: "not-home" }
): ExplorationUiSnapshot => ({
  canEnter: false,
  cooldownInMs: 0,
  eligibility,
  leaveUnlockInMs: 0,
  phase: "idle",
  progress: 0,
  spyglass: false
});

/** Read-only ground/navigation/clearance queries the spawn and movement code may use. */
export interface ExplorationGroundQuery {
  cellsX: number;
  cellsZ: number;
  groundHeight: (x: number, z: number) => number;
  /** Read-only nearby structural underside query, used only during a requested/active hop. */
  ceilingHeight?: (x: number, z: number, floor: number, radius: number, reach: number) => number;
  isClear: (x: number, z: number, radius: number) => boolean;
  isOwned: (x: number, z: number) => boolean;
  /** Shallow shore water the body may wade through (water stays water for spawn and isWater). */
  isWadeable?: (x: number, z: number) => boolean;
  isWalkable: (x: number, z: number) => boolean;
  isWater: (x: number, z: number) => boolean;
}

export interface ExplorationSpawnPoint {
  x: number;
  y: number;
  z: number;
  owned: boolean;
}

export type ExplorationSpawnResult =
  | { ok: true; point: ExplorationSpawnPoint }
  | { ok: false; reason: "no-safe-spawn" };

/** The runtime controller (01B) is injected with these adapters; it never receives the simulation or SaveStore. */
export interface ExplorationAppearanceLease {
  dispose: () => void;
  /** Measured rig eye height; optional so test doubles keep the movement default. */
  eyeHeight?: () => number;
  update: (appearance: ExplorationAppearanceFrame | null) => void;
}

export interface ExplorationAppearanceAdapter {
  /** Resolve after the assets are owned; a stale result must release them instead of installing. */
  acquire: (identity: ExplorationSessionIdentity) => Promise<ExplorationAppearanceLease>;
}

export interface ExplorationVisibilityAdapter {
  setBubble: (bubble: ExplorationBubble | null) => void;
  dispose: () => void;
}

export interface ExplorationSmokeAdapter {
  burst: (kind: ExplorationSmokeFrame["kind"], point: { x: number; y: number; z: number }) => void;
  dispose: () => void;
  update: (smoke: ExplorationSmokeFrame | null) => void;
}

export interface ExplorationWeatherAdapter {
  dispose: () => void;
  setActive: (active: boolean) => void;
  update: (weather: ExplorationWeatherFrame | null) => void;
}

export interface ExplorationUiAdapter {
  dispose: () => void;
  publish: (snapshot: ExplorationUiSnapshot) => void;
}

export interface ExplorationHost {
  appearance: ExplorationAppearanceAdapter;
  camera: ExplorationCameraBoundary;
  ground: ExplorationGroundQuery;
  identity: () => ExplorationSessionIdentity;
  /** Elapsed presentation time (ms), injected so tests never wait on animation frames. */
  now: () => number;
  smoke: ExplorationSmokeAdapter;
  ui: ExplorationUiAdapter;
  visibility: ExplorationVisibilityAdapter;
  weather: ExplorationWeatherAdapter;
}

export type ExplorationLeaveReason =
  | "leave"
  | "background"
  | "session-replacement"
  | "lease-lost"
  | "renderer-failure"
  | "dispose";

export interface ExplorationController {
  /** Resolve once the body is possessed, or refuse without changing normal play. */
  enter: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Request an exit; repeated requests are coalesced and `force` bypasses the dwell/leave lock. */
  requestLeave: (reason: ExplorationLeaveReason, force?: boolean) => void;
  /** Move intent in normalized world axes; ignored outside possession. */
  setMovement: (forward: number, right: number) => void;
  /** A fresh physical press; ignored outside possession or while a hop is active. */
  jump?: () => boolean;
  /** Look intent in radians per second; ignored outside possession. */
  setLook: (yawDelta: number, pitchDelta: number) => void;
  toggleSpyglass: () => void;
  /** +1 zooms in, -1 zooms out; ignored unless the spyglass is active. */
  adjustSpyglassZoom: (direction: 1 | -1) => void;
  update: (deltaSeconds: number) => Readonly<ExplorationFrame>;
  forceExit: (reason: ExplorationLeaveReason) => void;
  dispose: () => void;
  snapshot: () => ExplorationUiSnapshot;
  frame: () => Readonly<ExplorationFrame>;
}
