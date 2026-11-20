import { clamp, lerp, smoothstep } from "../../shared/world/noise";
import { AMBIENT_DENSITY } from "../ambient-density";
import type { EnvironmentState } from "../environment";

/** Below this zoom butterflies are off entirely (too small to read, not worth a step). */
export const BUTTERFLY_MIN_ZOOM = 0.75;
/**
 * Reference caps before the owner's further 50 % ambient cut. Round only after scaling,
 * retaining one butterfly at the farthest readable zoom.
 */
const FAR_CAP = 1;
const GAMEPLAY_CAP = 3;
const CLOSE_CAP = 6;
const GAMEPLAY_ZOOM = 1.5;
const CLOSE_ZOOM = 3;

/** Flight wing pose: a beat from the down stroke (-0.35) to nearly closed above (1.35). */
const FLAP_MIDDLE = 0.5;
const FLAP_SWING = 0.85;
/** Gliding: wings held flat, a little raised. */
const GLIDE_ANGLE = 0.15;
/** Sitting: wings open to bask (0.3) and close above the back (1.4), slowly. */
const SIT_MIDDLE = 0.85;
const SIT_SWING = 0.55;

/** Turn rate (radians per second) of the wandering heading. */
const WANDER_TURN = 1.7;

/** 0 (night, any real rain or snowfall: no butterflies) .. 1 (a dry day). */
export const getButterflyActivity = (environment: EnvironmentState) => {
  const falling = Math.max(environment.rain, environment.snow);
  return smoothstep(0.45, 0.8, environment.daylight) * (1 - smoothstep(0.02, 0.12, falling));
};

/** Most butterflies allowed around the view at a zoom (0 when zoomed out). */
export const getButterflyCap = (zoom: number) => {
  if (zoom < BUTTERFLY_MIN_ZOOM) return 0;
  if (zoom <= GAMEPLAY_ZOOM) {
    const share = (zoom - BUTTERFLY_MIN_ZOOM) / (GAMEPLAY_ZOOM - BUTTERFLY_MIN_ZOOM);
    return Math.round(lerp(FAR_CAP, GAMEPLAY_CAP, share) * AMBIENT_DENSITY);
  }
  const share = clamp((zoom - GAMEPLAY_ZOOM) / (CLOSE_ZOOM - GAMEPLAY_ZOOM), 0, 1);
  return Math.round(lerp(GAMEPLAY_CAP, CLOSE_CAP, share) * AMBIENT_DENSITY);
};

/** How many butterflies to keep around the view: the zoom cap scaled by the activity. */
export const getDesiredButterflies = (zoom: number, activity: number) =>
  Math.round(getButterflyCap(zoom) * activity);

/**
 * Wing angle (radians, 0 flat): the flap beat by phase, held flat while gliding (flap 0), the
 * slow basking open / close while sitting (sit 1).
 */
export const getWingAngle = (phase: number, flap: number, sit: number) => {
  const flight = lerp(GLIDE_ANGLE, FLAP_MIDDLE + FLAP_SWING * Math.sin(phase), flap);
  return lerp(flight, SIT_MIDDLE + SIT_SWING * Math.sin(phase), sit);
};

/** Wing bend at full beat (radians): the tips and the hindwing trail the stroke. */
const FLAP_BEND = 0.35;

/**
 * Wing bend (radians) of the beat at a phase: the wing tips lag behind the stroke, so they curl
 * up on the down stroke and down on the up stroke (the beat's speed is cos(phase)).
 */
export const getWingBend = (phase: number, flap: number, sit: number) =>
  -Math.cos(phase) * FLAP_BEND * flap * (1 - sit);

/** Wing pattern variant of a butterfly from its seed (0..10): individuals differ. */
export const getButterflyVariant = (seed: number, variants: number) =>
  Math.floor(seed * 7.3) % variants;

/** Smooth wandering turn rate: two slow sines with a per butterfly seed, never a loop. */
export const getWanderTurn = (time: number, seed: number) =>
  WANDER_TURN * (Math.sin(time * 0.9 + seed * 7.1) * 0.7 + Math.sin(time * 2.3 + seed * 3.7) * 0.3);

/** Side speed of the small lateral oscillation (world units per second). */
export const getLateralSpeed = (time: number, seed: number) => 0.32 * Math.cos(time * 2.6 + seed);

/** Vertical bob around the cruise height, with a tiny hop on each wing beat. */
export const getBob = (time: number, seed: number, phase: number) =>
  0.12 * Math.sin(time * 1.7 + seed * 5.3) + 0.03 * Math.sin(phase);
