import { fract } from "../../../shared/world/noise";
import { type Gait,SPECIES, SPECIES_PROFILES } from "../wildlife-species";
import { POSE, POSE_CHANNELS } from "./animal-rig";
import { addDeathPose } from "./death-pose";
import { getCervidGrazeNeck,GRAZE_HEAD_PITCH } from "./graze-reach";
import { addRabbitStance, addRestPose } from "./rest-pose";
import { addCervidNod, addGrazeStance, getTailFlick } from "./secondary-motion";

/** Motion state of one animal for one frame: everything the pose depends on. */
export interface AnimalMotion {
  /** 0 relaxed .. 1 alert (head high, ears forward, body still). */
  alert: number;
  /** Antler size of the individual (0 none .. 1 full rack): a fallen head rests on it. */
  antlers: number;
  /** Breathing phase (radians). */
  breath: number;
  /** Chewing / sniffing phase (radians). */
  chew: number;
  /** 0 alive .. 1 fallen: progress of the death fall (see death-pose). */
  death: number;
  /** Ear twitch offsets (radians, + back). */
  earLeft: number;
  earRight: number;
  /** 0 .. 1 fleeing (ears back, tail flagged). */
  flee: number;
  /** Locomotion cycle position (any real; its fraction is used). */
  gaitPhase: number;
  /** 0 .. 1 head down grazing. */
  graze: number;
  /** Head turn (radians, + to the left). */
  headYaw: number;
  /** Body lean into a turn (radians, the instance roll; see secondary-motion). */
  lean: number;
  /** 0 standing .. 1 moving: blends the cycle in. */
  move: number;
  /** 0 standing .. 1 bedded (lying down and rising pass through the leg folds). */
  rest: number;
  /** 0 head upright .. 1 head lowered while bedded. */
  restHead: number;
  /** Resting pose (rabbits: REST_KIND), 0 for deer and elk. */
  restKind: number;
  /** Weights of the trot and run cycles (walk is the rest). */
  run: number;
  /** 0 .. 1 individual seed of the idle variation (tail flicks). */
  seed: number;
  trot: number;
}

/** Leg timing of a quadruped gait: stance share and the phase offset of each leg. */
interface QuadrupedGait {
  duty: number;
  /** Knee lift during the swing (radians). */
  kneeLift: number;
  /** Phase offset of front left, front right, hind left, hind right. */
  offsets: readonly [number, number, number, number];
}

/** Lateral four beat walk, diagonal trot, rotary gallop. */
const CERVID_GAITS: { run: QuadrupedGait; trot: QuadrupedGait; walk: QuadrupedGait } = {
  run: { duty: 0.32, kneeLift: 1.25, offsets: [0.45, 0.57, 0, 0.12] },
  trot: { duty: 0.48, kneeLift: 0.95, offsets: [0.5, 0, 0, 0.5] },
  walk: { duty: 0.64, kneeLift: 0.7, offsets: [0.25, 0.75, 0, 0.5] }
};

/**
 * Hip to hoof length of the front and hind leg per species (stance sweep): the leg top heights
 * of the adult models (tests/wildlife-models.test.ts keeps them in sync with the assets).
 */
export const CERVID_LEGS: Record<number, { front: number; hind: number }> = {
  [SPECIES.deer]: { front: 0.424, hind: 0.431 },
  [SPECIES.elk]: { front: 0.555, hind: 0.597 }
};

const TAU = Math.PI * 2;
const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

/**
 * Hip amplitude that makes a planted hoof travel back exactly as far as the body moves during
 * the stance: stride x duty = 2 x leg x sin(amplitude). The phase advances by speed / stride,
 * so the feet do not slide.
 */
const getStanceAmplitude = (gait: Gait, duty: number, leg: number) =>
  Math.asin(Math.min(0.95, (gait.stride * duty) / (2 * leg)));

/** Scratch result of the leg cycle (no allocation). */
const leg = { hip: 0, knee: 0 };

/**
 * One leg in a cycle: during the stance the hip sweeps from +amplitude to -amplitude at a
 * constant rate (planted hoof); during the swing it eases forward while the knee folds.
 */
const sampleLeg = (phase: number, duty: number, amplitude: number, kneeLift: number) => {
  if (phase < duty) {
    // A hoof's horizontal offset is legLength * sin(hip), not legLength * hip.
    // Linear ground travel therefore needs an inverse sine through the planted stance.
    leg.hip = Math.asin(Math.sin(amplitude) * (1 - (2 * phase) / duty));
    leg.knee = 0;
    return leg;
  }
  const swing = (phase - duty) / (1 - duty);
  leg.hip = amplitude * (2 * ease(swing) - 1);
  leg.knee = Math.sin(Math.PI * swing) * kneeLift;
  return leg;
};

const LEG_CHANNELS = [
  [POSE.frontLeftHip, POSE.frontLeftKnee, -1],
  [POSE.frontRightHip, POSE.frontRightKnee, -1],
  [POSE.hindLeftHip, POSE.hindLeftKnee, 1],
  [POSE.hindRightHip, POSE.hindRightKnee, 1]
] as const;

/** Adds one gait's leg angles, weighted. Front knees fold back (-), hocks forward (+). */
const addCervidGait = (
  species: number,
  name: "walk" | "trot" | "run",
  phase: number,
  weight: number,
  out: Float32Array,
  offset: number
) => {
  if (weight <= 0) return;
  const gait = CERVID_GAITS[name];
  const legs = CERVID_LEGS[species]!;
  const profile = SPECIES_PROFILES[species]!;
  for (let index = 0; index < LEG_CHANNELS.length; index += 1) {
    const [hipChannel, kneeChannel, fold] = LEG_CHANNELS[index]!;
    const length = index < 2 ? legs.front : legs.hind;
    const amplitude = getStanceAmplitude(profile[name], gait.duty, length);
    const legPhase = fract(phase + gait.offsets[index]!);
    const sample = sampleLeg(legPhase, gait.duty, amplitude, gait.kneeLift);
    out[offset + hipChannel] = out[offset + hipChannel]! + sample.hip * weight;
    out[offset + kneeChannel] = out[offset + kneeChannel]! + sample.knee * fold * weight;
  }
};

/** Deer and elk: walk / trot / gallop legs and body, grazing, alert and flight posture. */
const poseCervid = (species: number, motion: AnimalMotion, out: Float32Array, offset: number) => {
  const walk = Math.max(0, 1 - motion.trot - motion.run) * motion.move;
  const phase = motion.gaitPhase;
  addCervidGait(species, "walk", phase, walk, out, offset);
  addCervidGait(species, "trot", phase, motion.trot * motion.move, out, offset);
  addCervidGait(species, "run", phase, motion.run * motion.move, out, offset);
  const cycle = Math.sin(fract(phase) * TAU);
  const gallop = motion.run * motion.move;
  const relaxed = 1 - motion.alert;
  out[offset + POSE.spine] = cycle * 0.11 * gallop + Math.sin(motion.breath) * 0.008;
  out[offset + POSE.bodyPitch] = Math.sin(fract(phase + 0.1) * TAU) * 0.07 * gallop;
  out[offset + POSE.neckPitch] =
    getCervidGrazeNeck(species) * motion.graze +
    motion.alert * 0.22 -
    gallop * (0.32 + cycle * 0.06) -
    motion.trot * motion.move * 0.12 +
    Math.sin(motion.breath * 0.5) * 0.015 * relaxed;
  out[offset + POSE.headPitch] =
    GRAZE_HEAD_PITCH * motion.graze +
    Math.sin(motion.chew) * 0.05 * motion.graze -
    0.12 * motion.alert +
    gallop * 0.2;
  out[offset + POSE.neckYaw] = motion.headYaw;
  const earsBack = motion.flee * 0.55 - motion.alert * 0.35;
  out[offset + POSE.earLeft] = earsBack + motion.earLeft;
  out[offset + POSE.earRight] = earsBack + motion.earRight;
  out[offset + POSE.tail] = motion.flee * 1.15 + motion.alert * 0.35 + getTailFlick(motion);
  addCervidNod(species, motion, out, offset);
  const lift = Math.max(0, Math.sin(fract(phase - 0.62) * TAU)) * 0.045 * gallop;
  const bob = Math.abs(cycle) * (walk * 0.006 + motion.trot * motion.move * 0.018);
  return lift - bob + addGrazeStance(motion, out, offset);
};

/** Keyframes (phase, value) of one channel of the rabbit hop at full intensity. */
type Keys = readonly (readonly [number, number])[];

const sampleKeys = (keys: Keys, phase: number) => {
  for (let index = 1; index < keys.length; index += 1) {
    const [phaseB, valueB] = keys[index]!;
    if (phase > phaseB) continue;
    const [phaseA, valueA] = keys[index - 1]!;
    return valueA + (valueB - valueA) * ease((phase - phaseA) / (phaseB - phaseA));
  }
  return keys[keys.length - 1]![1];
};

/**
 * The rabbit's bound (never a dog like four leg cycle): both hind feet push together with the
 * legs extending far back, the stretched body flies, the forepaws land, then the hind feet
 * swing forward past them while the back arches (gathered), and the next push follows.
 */
const RABBIT_HOP = {
  bodyPitch: [
    [0, 0.04],
    [0.2, 0.14],
    [0.45, 0.02],
    [0.62, -0.14],
    [0.82, -0.04],
    [1, 0.04]
  ],
  frontHip: [
    [0, -0.35],
    [0.22, 0.1],
    [0.45, 0.85],
    [0.6, 0.35],
    [0.8, -0.45],
    [1, -0.35]
  ],
  frontKnee: [
    [0, 0],
    [0.2, -0.9],
    [0.42, -0.1],
    [0.6, 0],
    [1, 0]
  ],
  hindHip: [
    [0, 0.45],
    [0.22, -0.95],
    [0.45, -0.85],
    [0.68, 0.2],
    [0.85, 0.7],
    [1, 0.45]
  ],
  hindKnee: [
    [0, 0],
    [0.22, -1.35],
    [0.45, -1.15],
    [0.68, -0.3],
    [0.85, 0],
    [1, 0]
  ],
  lift: [
    [0, 0],
    [0.18, 0.012],
    [0.38, 0.06],
    [0.55, 0.03],
    [0.66, 0],
    [1, 0]
  ],
  spine: [
    [0, -0.18],
    [0.25, 0.22],
    [0.48, 0.2],
    [0.7, -0.08],
    [0.88, -0.2],
    [1, -0.18]
  ]
} as const satisfies Record<string, Keys>;

const setRabbitLegs = (phase: number, intensity: number, out: Float32Array, offset: number) => {
  const hindHip = sampleKeys(RABBIT_HOP.hindHip, phase) * intensity;
  const hindKnee = sampleKeys(RABBIT_HOP.hindKnee, phase) * intensity;
  const frontHip = sampleKeys(RABBIT_HOP.frontHip, phase) * intensity;
  const frontKnee = sampleKeys(RABBIT_HOP.frontKnee, phase) * intensity;
  const sway = intensity * 0.04;
  out[offset + POSE.hindLeftHip] = hindHip;
  out[offset + POSE.hindRightHip] =
    sampleKeys(RABBIT_HOP.hindHip, fract(phase - 0.03)) * intensity;
  out[offset + POSE.hindLeftKnee] = hindKnee;
  out[offset + POSE.hindRightKnee] = hindKnee;
  out[offset + POSE.frontLeftHip] = frontHip;
  out[offset + POSE.frontRightHip] =
    sampleKeys(RABBIT_HOP.frontHip, fract(phase - 0.06)) * intensity + sway;
  out[offset + POSE.frontLeftKnee] = frontKnee;
  out[offset + POSE.frontRightKnee] = frontKnee;
};

/**
 * Rabbit: the hop at walking (exploring), medium and full (fleeing) intensity; standing still it
 * crouches on its haunches or sits up alert (rest-pose stance).
 */
const poseRabbit = (motion: AnimalMotion, out: Float32Array, offset: number) => {
  const phase = fract(motion.gaitPhase);
  const intensity = motion.move * (0.5 + motion.trot * 0.25 + motion.run * 0.5);
  setRabbitLegs(phase, intensity, out, offset);
  out[offset + POSE.spine] =
    sampleKeys(RABBIT_HOP.spine, phase) * intensity + Math.sin(motion.breath) * 0.02;
  out[offset + POSE.bodyPitch] = sampleKeys(RABBIT_HOP.bodyPitch, phase) * intensity;
  out[offset + POSE.neckPitch] = -0.42 * motion.graze;
  out[offset + POSE.headPitch] =
    -0.35 * motion.graze + Math.sin(motion.chew * 2.6) * 0.035 * (1 - motion.move);
  out[offset + POSE.neckYaw] = motion.headYaw;
  const earsBack = motion.flee * 0.95 + motion.move * motion.run * 0.4 - motion.alert * 0.3;
  out[offset + POSE.earLeft] = earsBack + motion.earLeft;
  out[offset + POSE.earRight] = earsBack + motion.earRight;
  out[offset + POSE.tail] = motion.flee * 0.5;
  return sampleKeys(RABBIT_HOP.lift, phase) * intensity * (0.4 + motion.run * 0.6);
};

/**
 * Joint angles (POSE channels) of one animal into `out` at `offset`; returns the body lift
 * (world units, airborne phases): the renderer's instance attributes.
 */
export const computeAnimalPose = (
  species: number,
  motion: AnimalMotion,
  out: Float32Array,
  offset: number
) => {
  out.fill(0, offset, offset + POSE_CHANNELS);
  const lift =
    species === SPECIES.rabbit
      ? poseRabbit(motion, out, offset) + addRabbitStance(motion, out, offset)
      : poseCervid(species, motion, out, offset);
  const living = lift + addRestPose(species, motion, out, offset);
  if (motion.death <= 0) return living;
  return addDeathPose(species, motion, out, offset, living);
};

export const createRestMotion = (): AnimalMotion => ({
  alert: 0,
  antlers: 0,
  breath: 0,
  chew: 0,
  death: 0,
  earLeft: 0,
  earRight: 0,
  flee: 0,
  gaitPhase: 0,
  graze: 0,
  headYaw: 0,
  lean: 0,
  move: 0,
  rest: 0,
  restHead: 0,
  restKind: 0,
  run: 0,
  seed: 0,
  trot: 0
});
