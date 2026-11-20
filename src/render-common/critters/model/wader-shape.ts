import type { Vec3 } from "../../props/mesh-builder";

/**
 * Proportions (world units) and colours of a long legged bird standing or walking on the
 * ground or in the shallows (the shore gull). Original procedural design: a tilted body, S curved
 * neck, dagger or hooked bill, folded wings lying on the flanks that spread for flight.
 */
export interface WaderShape {
  billLength: number;
  billRadius: number;
  bodyHeight: number;
  bodyLength: number;
  /** Body nose-up tilt standing (radians). */
  bodyTilt: number;
  bodyWidth: number;
  colors: WaderColors;
  headRadius: number;
  /** Hip above the ground. */
  legLength: number;
  legRadius: number;
  neckLength: number;
  neckRadius: number;
  /** How far back the relaxed neck folds into its S (0 straight .. 1 deep). */
  neckFold: number;
  tailLength: number;
  /** Folded wing chord and the half span spread for flight. */
  wingChord: number;
  wingSpan: number;
}

interface WaderColors {
  back: Vec3;
  belly: Vec3;
  bill: Vec3;
  cap: Vec3;
  eye: Vec3;
  face: Vec3;
  legs: Vec3;
  neck: Vec3;
  tail: Vec3;
  wing: Vec3;
  wingTip: Vec3;
}

/** Herring gull: white head and body, pale grey mantle, black wing tips, yellow bill. */
export const SHORE_GULL: WaderShape = {
  billLength: 0.045,
  billRadius: 0.009,
  bodyHeight: 0.055,
  bodyLength: 0.24,
  bodyTilt: 0.12,
  bodyWidth: 0.055,
  colors: {
    back: [0.66, 0.7, 0.75],
    belly: [0.97, 0.97, 0.95],
    bill: [0.95, 0.8, 0.25],
    cap: [0.95, 0.95, 0.93],
    eye: [0.9, 0.85, 0.5],
    face: [0.96, 0.96, 0.94],
    legs: [0.86, 0.62, 0.55],
    neck: [0.96, 0.96, 0.94],
    tail: [0.95, 0.95, 0.93],
    wing: [0.68, 0.72, 0.77],
    wingTip: [0.07, 0.07, 0.08]
  },
  headRadius: 0.032,
  legLength: 0.075,
  legRadius: 0.007,
  neckLength: 0.06,
  neckRadius: 0.03,
  neckFold: 0.2,
  tailLength: 0.06,
  wingChord: 0.1,
  wingSpan: 0.45
};

/** One pose of a wader (every value 0 is the relaxed stand). */
export interface WaderPose {
  /** Wing beat while spread (radians, positive up). */
  flap: number;
  /** Flight: legs trailing behind (0 standing .. 1). */
  legsBack: number;
  /** 0 relaxed S neck .. 1 stretched up (alert). */
  neckUp: number;
  /** Head down to the ground or the water in front (pecking, striking: 0..1). */
  reach: number;
  /** 0 folded .. 1 spread for flight. */
  spread: number;
  /** Walk cycle phase 0..1 (the right leg half a cycle behind the left). */
  step: number;
  /** Walk stride 0 (standing) .. 1: leg swing and the lift of the leg swinging forward. */
  stride: number;
  /** Body tilt replaced by level flight (0 standing tilt .. 1 level). */
  level: number;
}

export const WADER_REST: WaderPose = {
  flap: 0,
  legsBack: 0,
  level: 0,
  neckUp: 0,
  reach: 0,
  spread: 0,
  step: 0,
  stride: 0
};
