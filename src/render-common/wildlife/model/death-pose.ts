import { smoothstep } from "../../../shared/world/noise";
import { getDeathPhases, getDeathRoll } from "../../helpers";
import { SPECIES } from "../wildlife-species";
import type { AnimalMotion } from "./animal-pose";
import { HEAD_ROLL_GAIN, POSE, POSE_CHANNELS } from "./animal-rig";
import { getHeadRest } from "./carcass-head";
import {
  createLegPoints,
  getLegPoints,
  getRootHeight,
  LEGS,
  pitchAboutRoot,
  TORSO
} from "./leg-geometry";

/** Leg folds while buckling and the limp fallen pose (radians, POSE channels). */
interface DeathShape {
  buckle: readonly [frontHip: number, frontKnee: number, hindHip: number, hindKnee: number];
  ears: number;
  fallen: readonly [frontHip: number, frontKnee: number, hindHip: number, hindKnee: number];
  head: number;
  neck: number;
}

const CERVID_DEATH: DeathShape = {
  buckle: [0.5, -2, -0.3, 1.2],
  ears: 1,
  fallen: [0.45, -0.35, -0.4, 0.45],
  head: -0.25,
  neck: -0.1
};

const DEATH_SHAPES: Record<number, DeathShape> = {
  [SPECIES.rabbit]: {
    buckle: [-0.3, 0.8, -0.3, 0.8],
    ears: 0.9,
    fallen: [0.7, 0.1, -1, 0.5],
    head: -0.2,
    neck: -0.1
  },
  [SPECIES.deer]: CERVID_DEATH,
  [SPECIES.elk]: CERVID_DEATH
};

/** Limb thickness around the knee and foot probes (share of the body pivot height). */
const LIMB_PAD = 0.06;

const legPoints = createLegPoints();
const probe = [0, 0, 0];

/** Height of a probe point after the rig's body pitch and the fall's roll (model units). */
const getProbeHeight = (pitch: number, roll: number, rootHeight: number) => {
  pitchAboutRoot(probe, pitch, rootHeight);
  return probe[1]! * Math.cos(-roll) - probe[2]! * Math.sin(-roll);
};

/**
 * Body lift that sets the lowest of the torso corners, knees and feet on the ground, with the
 * pose of `out` and the instance roll `roll` (model units); `limbs` (0 .. 1) pads the knee and
 * foot probes by the limb thickness (folded or lying legs).
 */
const getGroundLift = (
  species: number,
  out: Float32Array,
  offset: number,
  roll: number,
  limbs: number
) => {
  const pitch = out[offset + POSE.bodyPitch]!;
  const rootHeight = getRootHeight(species);
  const torso = TORSO[species]!;
  let lowest = Infinity;
  for (const x of [torso.back, torso.front]) {
    for (const y of [torso.bottom, torso.top]) {
      for (const z of [-torso.halfWidth, torso.halfWidth]) {
        probe[0] = x;
        probe[1] = y;
        probe[2] = z;
        lowest = Math.min(lowest, getProbeHeight(pitch, roll, rootHeight));
      }
    }
  }
  const pad = LIMB_PAD * rootHeight * limbs;
  for (const info of LEGS) {
    getLegPoints(species, info, out[offset + info.hip]!, out[offset + info.knee]!, legPoints);
    for (const point of [legPoints.knee, legPoints.foot]) {
      probe[0] = point[0];
      probe[1] = point[1];
      probe[2] = point[2];
      lowest = Math.min(lowest, getProbeHeight(pitch, roll, rootHeight) - pad);
    }
  }
  return -lowest;
};

const add = (out: Float32Array, index: number, value: number) => {
  out[index] = out[index]! + value;
};

/** Adds one set of leg angles (front hip, front knee, hind hip, hind knee), weighted. */
const addLegs = (
  out: Float32Array,
  offset: number,
  angles: DeathShape["buckle"],
  weight: number
) => {
  for (const info of LEGS) {
    add(out, offset + info.hip, (info.front ? angles[0] : angles[2]) * weight);
    add(out, offset + info.knee, (info.front ? angles[1] : angles[3]) * weight);
  }
};

/**
 * (A rack turns the head up before the body rolls onto it; a bare head relaxes down once the
 * body has settled.)
 *
 * The death of an animal in the shared pose (no ragdoll), `motion.death` 0 .. 1 over the
 * fall: it stumbles (the head drops), buckles (front knees first, then the hind) and falls onto
 * its side (the roll is `getDeathRoll`, applied by the instance) with the legs limp; as it
 * settles the neck relaxes and lays the head down (cheek and ears on the ground, a rack resting
 * on it: `getHeadRest` with the instance's antler size, the head rolled by the limp tail). The living pose fades out as it buckles. Returns the body lift: the pose lift
 * blended into the ground lift of the fallen body, never below the ground.
 */
export const addDeathPose = (
  species: number,
  motion: AnimalMotion,
  out: Float32Array,
  offset: number,
  poseLift: number
) => {
  const death = motion.death;
  const shape = DEATH_SHAPES[species]!;
  const { buckle, fall, stumble } = getDeathPhases(death);
  for (let channel = 0; channel < POSE_CHANNELS; channel += 1) {
    out[offset + channel] = out[offset + channel]! * (1 - buckle);
  }
  addLegs(out, offset, shape.buckle, buckle * (1 - fall));
  addLegs(out, offset, shape.fallen, fall);
  add(out, offset + POSE.bodyPitch, -0.15 * buckle * (1 - fall));
  add(out, offset + POSE.neckPitch, -0.35 * stumble * (1 - fall) + shape.neck * fall);
  add(out, offset + POSE.headPitch, -0.2 * stumble * (1 - fall) + shape.head * fall);
  const rest = getHeadRest(species, motion.antlers);
  const headTurn = rest.yaw > 0 ? smoothstep(0.4, 0.75, death) : smoothstep(0.7, 1, death);
  add(out, offset + POSE.neckYaw, rest.yaw * headTurn);
  out[offset + POSE.tail] = -(rest.roll * smoothstep(0.4, 0.75, death)) / HEAD_ROLL_GAIN;
  add(out, offset + POSE.earLeft, shape.ears * fall);
  add(out, offset + POSE.earRight, shape.ears * fall);
  const groundLift = getGroundLift(species, out, offset, getDeathRoll(death), buckle);
  return Math.max(groundLift, poseLift + (groundLift - poseLift) * buckle);
};
