/**
 * Possessed-sky constants shared by the WebGL GLSL templates, their CPU owners and the WebGPU
 * TSL twin. Single source: the generated GLSL interpolates these exact numbers, so extracting
 * them must not change a byte (tests/webgpu-shader-source.test.ts).
 */

/** Light discs: the owner-requested moon at three times its former radius, the sun at twice. */
const BASE_MOON_DISC_RADIUS = 0.0084999;
const BASE_SUN_DISC_RADIUS = 0.0169998;
export const EXPLORATION_MOON_DISC_RADIUS = BASE_MOON_DISC_RADIUS * 3;
export const EXPLORATION_SUN_DISC_RADIUS = BASE_SUN_DISC_RADIUS * 2;
/** Earthshine on the night side of a thin crescent, relative to the sunlit full disc. */
export const EXPLORATION_MOON_EARTHSHINE = 0.05;
/** Restrained moon halo: colour gain and radial falloff per chord unit beyond the disc. */
export const EXPLORATION_MOON_HALO_GAIN = 0.055;
export const EXPLORATION_MOON_HALO_FALLOFF = 135;
export const EXPLORATION_MOON_HALO_TINT = [0.65, 0.76, 0.97] as const;
/** Sky concealment veil only along this horizon band (direction.y share). */
export const EXPLORATION_SKY_CONCEALMENT_TOP = 0.08;

/**
 * Night stars: cube-face cell counts, the share of cells that hold a star, twinkle angular
 * frequencies and the possessed eye's half field of view (movement.ts, 68 degrees).
 */
export const EXPLORATION_STARS = {
  brightCells: 56,
  faintCells: 160,
  brightShare: 0.32,
  faintShare: 0.16,
  twinkleFast: 11.3,
  twinkleSlow: 7,
  /** CPU twinkle clock wraps at a whole period of both frequencies (200 pi s). */
  twinklePeriod: 200 * Math.PI,
  eyeHalfFovTan: Math.tan((34 * Math.PI) / 180)
} as const;

/** The HDR sun: aureole, cloud glow, glare and limb-darkening shaping constants. */
export const EXPLORATION_SUN = {
  aureoleAsymmetry: 0.78,
  aureoleGain: 0.0006,
  cloudGlowAsymmetry: 0.7,
  cloudGlowGain: 0.0025,
  /**
   * Brightest display channel the cloud glow may lift a pixel to (owner captures/17.png,
   * 2026-11-13): a soft silver lining below the bloom prefilter's clipped white, no white ring.
   */
  cloudGlowDisplayPeak: 0.86,
  /** The direct beam uses this power of the cloud transmittance (0.07 already hides the disc). */
  cloudDirectPower: 4,
  glareCore: 0.12,
  glareCoreWidth: 2.4,
  glareVeil: 0.015,
  glareVeilWidth: 9,
  limbDarkening: 0.6,
  edgeFeather: 0.08,
  highlightKnee: 0.5,
  /** Share of the aureole that thin cloud in front of it still forward-scatters. */
  cloudForwardScatter: 0.35
} as const;

/** EXPLORATION_SUN.cloudGlowDisplayPeak before the sRGB encode, where the sun output adds its light. */
export const EXPLORATION_CLOUD_GLOW_LINEAR_PEAK =
  ((EXPLORATION_SUN.cloudGlowDisplayPeak + 0.055) / 1.055) ** 2.4;

/** Volumetric cumulus shell, extinction, tiles and temporal resolve of the possessed clouds. */
export const EXPLORATION_CLOUD = {
  planetRadius: 80000,
  bottom: 1000,
  top: 2500,
  marchLimit: 16000,
  /** Extinction per metre at density 1. */
  extinction: 0.035,
  /** Extinction toward the light: lower, so shaded sides keep multiple scattering. */
  lightExtinction: 0.008,
  shapeTile: 7000,
  detailTile: 1300,
  weatherTile: 26000,
  /** Ray-march steps through the shell: High 32, Medium 16; Low/Minimal draw the flat layer. */
  sampleLimit: 32,
  /** Steps of the transmittance-only march the vertex stage uses toward the sun disc. */
  visibilitySteps: 10,
  /** The cloud pass marches and resolves at half the drawing resolution. */
  resolutionScale: 0.5,
  /** Display-space shoulder that caps sunlit tops just above the daytime bloom threshold. */
  shoulderStart: 0.7,
  shoulderRange: 0.15
} as const;

/**
 * Cloud history (cloud-redo 2026-11-14): a short, time-based history follows camera turns and
 * wind drift; only a gap it cannot bridge restarts it (less visible jitter on cloud edges).
 */
export const EXPLORATION_CLOUD_HISTORY = {
  /** Highest history share per frame (60 fps and faster): ~20 frames of jitter averaged. */
  weight: 0.95,
  /** Half a second of motion at most, whatever the frame rate. */
  timeConstantMs: 500,
  /** A render gap this long (possession suspended, tab hidden) restarts the history. */
  gapMs: 1000
} as const;

/** Temporal resolve of the half-resolution cloud march (WebGL resolve GLSL and its TSL twin). */
export const EXPLORATION_CLOUD_RESOLVE = {
  /** Representative cloud depth for the wind reprojection: the dense lower part of the shell. */
  reprojectionAltitude: 1500,
  /** Upper parts drift ahead of the base (wind shear, detail erosion): the mean of both. */
  driftShare: 1.1,
  /** Share of the 3x3 mean in this frame's sample (soft grain where history is rejected). */
  currentMeanShare: 0.75,
  /** Screen motion (cloud pixels) over which the history loses weight and its clip tightens. */
  motionStart: 0.5,
  motionEnd: 4,
  clipStill: 1.5,
  clipMoving: 1,
  /** History weight factor at full motion. */
  movingHistoryShare: 0.85
} as const;

/** The march's white per-pixel, per-frame jitter hash (an LCG step, then three mixes). */
export const EXPLORATION_CLOUD_JITTER_HASH = {
  multiplier: 1664525,
  increment: 1013904223,
  /** Frame index wrap of the jitter (the CPU counter). */
  frameWrap: 4096
} as const;

export const explorationCloudSampleCount = (cloudDetail: number): number => {
  if (cloudDetail >= 3) return EXPLORATION_CLOUD.sampleLimit;
  if (cloudDetail >= 2) return 16;
  return 1;
};
