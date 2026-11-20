import { fract } from "../../../shared/world/noise";
import { SPECIES } from "../wildlife-species";
import type { AnimalMotion } from "./animal-pose";
import { POSE } from "./animal-rig";

const TAU = Math.PI * 2;

/**
 * Walking character of deer and elk (radians): the neck nods as each foreleg takes the weight
 * (twice per stride) and the trunk rolls over the supporting hind leg (once per stride). The
 * heavier elk nods less and shifts more weight.
 */
const CERVID_SWAY: Record<number, { nod: number; roll: number }> = {
  [SPECIES.deer]: { nod: 0.07, roll: 0.022 },
  [SPECIES.elk]: { nod: 0.05, roll: 0.034 }
};
/** Cycle phase of the lowest nod: just after a foreleg lands (walk: at 0.25 and 0.75). */
const NOD_PHASE = 0.3;
/** The head counter-rotates part of the nod: the gaze stays steadier than the neck. */
const HEAD_STEADYING = 0.45;
/** Share of the nod and roll left in the trot (diagonal pairs keep the trunk level). */
const TROT_SHARE = 0.3;

/** Breathing phase (radians) per tail flick chance: relaxed, about every 3 s. */
const TAIL_SLOT = 7;
const TAIL_CHANCE = 0.45;
/** Share of the slot a flick lasts (two quick beats) and its lift (radians). */
const TAIL_FLICK = 0.11;
const TAIL_LIFT = 0.5;

/** Walk weight of the gait blend (the rest of `move` is trot and run). */
export const getWalkWeight = (motion: AnimalMotion) =>
  Math.max(0, 1 - motion.trot - motion.run) * motion.move;

const getSwayWeight = (motion: AnimalMotion) =>
  getWalkWeight(motion) + motion.trot * motion.move * TROT_SHARE;

/** Adds the walking nod of deer and elk to the neck (the head steadied against it). */
export const addCervidNod = (
  species: number,
  motion: AnimalMotion,
  out: Float32Array,
  offset: number
) => {
  const sway = CERVID_SWAY[species];
  if (!sway) return;
  const weight = getSwayWeight(motion);
  if (weight <= 0) return;
  const nod = -sway.nod * weight * Math.cos(2 * TAU * (motion.gaitPhase - NOD_PHASE));
  out[offset + POSE.neckPitch] = out[offset + POSE.neckPitch]! + nod;
  out[offset + POSE.headPitch] = out[offset + POSE.headPitch]! - nod * HEAD_STEADYING;
};

/**
 * Body roll (radians, the instance roll about the feet) of the walking weight shift over the
 * hind leg in stance (left hind lands at phase 0) plus the lean into a turn.
 */
export const getBodySway = (species: number, motion: AnimalMotion) => {
  const sway = CERVID_SWAY[species];
  const lean = motion.lean * (1 - motion.death);
  if (!sway) return lean;
  return lean - sway.roll * getSwayWeight(motion) * Math.sin(TAU * motion.gaitPhase);
};

const hash = (value: number) => fract(Math.sin(value * 12.9898 + 4.1414) * 43758.5453);

/**
 * Tail flick of a relaxed deer or elk (radians, + up): now and then a quick double beat, timed
 * by the individual's breathing clock, so no two animals flick together.
 */
export const getTailFlick = (motion: AnimalMotion) => {
  const relaxed = (1 - motion.flee) * (1 - motion.alert) * (1 - motion.run * motion.move);
  if (relaxed <= 0) return 0;
  const clock = motion.breath / TAIL_SLOT;
  const slot = Math.floor(clock);
  if (hash(slot + motion.seed * 97) > TAIL_CHANCE) return 0;
  const start = 0.15 + hash(slot * 1.7 + motion.seed * 31) * 0.6;
  const beat = (fract(clock) - start) / TAIL_FLICK;
  if (beat <= 0 || beat >= 1) return 0;
  return TAIL_LIFT * relaxed * Math.abs(Math.sin(TAU * beat));
};

/**
 * Grazing stance of deer and elk (radians and model units at full weight): a grazing deer
 * lowers its forequarters, one foreleg reaching forward and the other bent at the knee, so a
 * natural neck still reaches the grass. The trunk pitches nose-down; every hip takes the pitch
 * back so the hind legs stay upright, and the body lowers to keep the hind hooves planted.
 */
const GRAZE_STANCE = {
  bentHip: 0.32,
  bentKnee: -0.64,
  bodyPitch: -0.08,
  drop: 0.011,
  reachHip: 0.26
} as const;

/** Adds the grazing stance (deer, elk) while standing; returns the body lift change. */
export const addGrazeStance = (motion: AnimalMotion, out: Float32Array, offset: number) => {
  const weight = motion.graze * (1 - motion.move) * (1 - motion.rest);
  if (weight <= 0) return 0;
  const pitch = GRAZE_STANCE.bodyPitch * weight;
  const add = (channel: number, value: number) => {
    out[offset + channel] = out[offset + channel]! + value;
  };
  add(POSE.bodyPitch, pitch);
  for (const hip of [POSE.hindLeftHip, POSE.hindRightHip]) add(hip, -pitch);
  add(POSE.frontLeftHip, GRAZE_STANCE.reachHip * weight - pitch);
  add(POSE.frontRightHip, GRAZE_STANCE.bentHip * weight - pitch);
  add(POSE.frontRightKnee, GRAZE_STANCE.bentKnee * weight);
  return -GRAZE_STANCE.drop * weight;
};
