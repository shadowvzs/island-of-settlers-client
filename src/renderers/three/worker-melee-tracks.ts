import type { CombatBody } from "./worker-combat-body";

export type Point3 = [number, number, number];
/** Keyframes [progress, value], eased with a smoothstep between neighbours. */
export type Keys = readonly (readonly [number, number])[];

/**
 * One fighting pose: weapon direction (pitch from vertical towards the front, yaw towards the
 * soldier's left), both hand targets in model space, torso bend / twist / sideways lean and the
 * lower body. Shared by the arm IK (worker-combat-pose.ts) and the held weapon
 * (three-worker-prop.ts, three-mounts.ts).
 */
export interface MeleePose {
  pitch: number;
  yaw: number;
  /** Shield (left) hand, the bow hand, or the other hand on a two-handed shaft. */
  leftHand: Point3;
  rightHand: Point3;
  /** Optional elbow pole for overarm throws; ordinary weapon poses use the relaxed pole. */
  rightElbow?: Point3;
  /** Independent off-hand weapon direction for dual-wielding; absent on shared-shaft grips. */
  leftPitch?: number;
  leftYaw?: number;
  bend: number;
  twist: number;
  /** Torso leaning sideways (+ = towards the right), a rider reaching down past the horse. */
  lean?: number;
  /** Head turned back towards the target (+ = left) when the shoulders are side-on. */
  headYaw?: number;
  /** The left hand holds a shield or a bow: it keeps its own upright grip, not the weapon's. */
  shield: boolean;
  /** Sweeping moves cut sideways (edge leads the yaw); others cut forward and down. */
  sweep: boolean;
  /**
   * Two-handed weapons: where the left hand holds the shaft, measured from the right (grip)
   * hand along the weapon (negative = towards the butt, positive = towards the head).
   */
  leftAlong?: number;
  /** Lower body; absent for riders. */
  body?: CombatBody;
}

/** The blow lands at 75 % of the swing (the simulation hits at attackTime .15 of .6). */
export const HIT = .75;
/** Strike pose keyframe: just after the hit. */
const STRIKE = HIT + .03;
/** Follow-through keyframe, before the recovery to the guard. */
const FOLLOW = .9;

export const track = (progress: number, keys: Keys) => {
  if (progress <= keys[0]![0]) return keys[0]![1];
  for (let index = 1; index < keys.length; index++) {
    const [time, value] = keys[index]!, [previousTime, previousValue] = keys[index - 1]!;
    if (progress > time) continue;
    const t = (progress - previousTime) / (time - previousTime);
    return previousValue + (value - previousValue) * t * t * (3 - 2 * t);
  }
  return keys[keys.length - 1]![1];
};

/** Guard, wind-up by 40 %, the strike just after the hit, a follow-through, back to the guard. */
export const arc = (rest: number, windUp: number, strike: number, follow = strike): Keys =>
  [[0, rest], [.4, windUp], [STRIKE, strike], [FOLLOW, follow], [1, rest]];

/** One keyframed move: every number of a MeleePose as a track. */
export interface Move {
  bend: Keys; pitch: Keys; twist: Keys; yaw: Keys;
  hand: readonly [Keys, Keys, Keys];
  sweep: boolean;
  body: { drop: Keys; hipYaw: Keys; lift: Keys; shift: Keys; step: Keys };
}
export type Stance = CombatBody["stance"];

/** Unit weapon direction for a pitch (from vertical towards the front) and yaw (towards the left). */
export const weaponDirection = (pitch: number, yaw: number): Point3 =>
  [Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)];

/** Direction the edge leads: forward-and-down for chops and thrusts, sideways for sweeps. */
export const weaponEdge = (pose: Pick<MeleePose, "pitch" | "sweep" | "yaw">): Point3 => {
  const { pitch, yaw } = pose;
  if (pose.sweep) return [Math.cos(yaw), 0, -Math.sin(yaw)];
  return [Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
};

/**
 * The front foot steps in during the wind-up (lifted half-way), stays planted through the blow
 * and steps back while the soldier recovers.
 */
export const stepIn = (length: number): { lift: Keys; step: Keys } => ({
  lift: [[0, 0], [.3, 0], [.45, .035], [.6, 0], [.86, 0], [.93, .025], [1, 0]],
  step: [[0, 0], [.3, 0], [.6, length], [.86, length], [1, 0]]
});

/** Samples a move at `progress` into a pose (the left hand is filled in by the caller). */
export const sampleMove = (move: Move, progress: number, stance: Stance) => {
  const at = (keys: Keys) => track(progress, keys);
  const body: CombatBody = { drop: at(move.body.drop), hipYaw: at(move.body.hipYaw), lift: at(move.body.lift),
    shift: at(move.body.shift), stance, step: at(move.body.step) };
  return { bend: at(move.bend), body, pitch: at(move.pitch), rightHand: move.hand.map(at) as Point3,
    sweep: move.sweep, twist: at(move.twist), yaw: at(move.yaw) };
};
