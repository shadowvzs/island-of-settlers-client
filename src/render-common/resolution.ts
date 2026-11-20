/** Resolution setting: how sharp the map is drawn (phones are fill rate bound). */
export type ResolutionMode = "auto" | "sharp" | "balanced" | "fast";

/** What a resolution mode means for the drawing buffer. */
export interface ResolutionProfile {
  /** MSAA; fixed when the WebGL context is created. */
  antialias: boolean;
  /** Upper limit of the device pixel ratio used for the drawing buffer. */
  maxPixelRatio: number;
}

const SHARP: ResolutionProfile = { antialias: true, maxPixelRatio: Infinity };
const BALANCED: ResolutionProfile = { antialias: true, maxPixelRatio: 1.5 };
/** Also Auto on touch devices: high DPI screens on weak GPUs, MSAA costs bandwidth on tilers. */
const FAST: ResolutionProfile = { antialias: false, maxPixelRatio: 1 };

const PROFILES: Record<Exclude<ResolutionMode, "auto">, ResolutionProfile> = {
  balanced: BALANCED,
  fast: FAST,
  sharp: SHARP
};

export const isResolutionMode = (value: unknown): value is ResolutionMode =>
  value === "auto" || value === "sharp" || value === "balanced" || value === "fast";

/** Auto picks Fast on touch first devices and full sharpness elsewhere. */
export const resolveResolutionProfile = (mode: ResolutionMode, coarsePointer: boolean) => {
  if (mode !== "auto") return PROFILES[mode];
  return coarsePointer ? FAST : SHARP;
};

/**
 * Drawing buffer pixels per CSS pixel: the device ratio, capped by the profile, times the budget
 * controller's render scale (R09; 1 = no reduction).
 */
export const getPixelRatio = (devicePixelRatio: number, profile: ResolutionProfile, renderScale = 1) =>
  Math.min(devicePixelRatio, profile.maxPixelRatio) * renderScale;

/** MSAA is chosen when the WebGL context is created, so only equal-antialias profiles can change live. */
export const resolutionRequiresReload = (current: ResolutionProfile, next: ResolutionProfile) =>
  current.antialias !== next.antialias;

/** The active drawing-buffer profile; the render loop watches `revision` to force a resize. */
export interface ResolutionState {
  profile: ResolutionProfile;
  /** Live render scale of the budget controller (R09), a multiplier of the profile's ratio. */
  renderScale: number;
  /** Incremented when a different profile or scale is applied (the CSS viewport may stay unchanged). */
  revision: number;
}

export const createResolutionState = (profile: ResolutionProfile): ResolutionState => ({
  profile,
  renderScale: 1,
  revision: 0
});

/** Updates the live profile and makes the next render-loop resize unconditional. */
export const applyResolutionProfile = (state: ResolutionState, profile: ResolutionProfile) => {
  state.profile = profile;
  state.revision += 1;
};

/** Sets the budget controller's render scale; the next render-loop frame resizes the buffer. */
export const applyRenderScale = (state: ResolutionState, renderScale: number) => {
  if (state.renderScale === renderScale) return;
  state.renderScale = renderScale;
  state.revision += 1;
};
