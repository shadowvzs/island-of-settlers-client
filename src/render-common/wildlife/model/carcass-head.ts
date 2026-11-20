import { SPECIES } from "../wildlife-species";
import { TORSO } from "./leg-geometry";

/** A head point: x forward of the neck joint, y above the head joint, z towards the left. */
type HeadPoint = readonly [x: number, y: number, z: number];

/**
 * Extreme points of a head on its ground side (the right, -z, and the jaw), measured on the
 * adult models: skull, muzzle, ear; the rack's beams and tines (scaled with the antler size
 * about the head joint, `pivot` forward of the neck joint).
 */
interface HeadProfile {
  head: readonly HeadPoint[];
  pivot: number;
  rack: readonly HeadPoint[];
}

const HEAD_PROFILES: Record<number, HeadProfile> = {
  [SPECIES.rabbit]: {
    head: [
      [0.081, -0.034, 0],
      [0.066, 0.008, -0.065],
      [0.073, -0.014, -0.06],
      [0.122, -0.017, 0],
      [0.019, 0.108, -0.065]
    ],
    pivot: 0.042,
    rack: []
  },
  [SPECIES.deer]: {
    head: [
      [0.319, -0.047, 0],
      [0.171, 0.039, -0.042],
      [0.304, -0.039, -0.02],
      [0.35, -0.016, 0],
      [0.198, 0.11, -0.071],
      [0.185, 0.044, -0.05],
      [0.316, -0.038, -0.019]
    ],
    pivot: 0.184,
    rack: [
      [0.114, 0.112, -0.1],
      [0.045, 0.071, -0.089],
      [0.097, 0.155, -0.081],
      [0.22, 0.09, -0.015],
      [0.113, 0.021, -0.05]
    ]
  },
  [SPECIES.elk]: {
    head: [
      [0.402, -0.025, 0],
      [0.284, 0.011, -0.069],
      [0.253, 0.127, -0.071],
      [0.516, 0.03, 0],
      [0.177, 0.129, -0.1],
      [0.214, 0.084, -0.085],
      [0.474, 0.007, -0.025],
      [0.312, 0.083, -0.067],
      [0.201, 0.103, -0.093]
    ],
    pivot: 0.287,
    rack: [
      [-0.146, 0.311, -0.338],
      [0.118, 0.422, -0.378],
      [0.121, 0.506, -0.35],
      [0.428, 0.254, -0.187],
      [0.236, 0.25, -0.316],
      [0.249, 0.287, -0.347],
      [0.497, 0.188, -0.076],
      [0.342, 0.09, 0.034]
    ]
  }
};

/**
 * Kept between the lowest profile point and the ground (share of the torso half width): the
 * profile is a few points, the mesh between them a little rounder.
 */
const HEAD_CLEARANCE = 0.12;
/** Neck turn range searched: down to the cheek on the ground, up to a big rack. */
const MIN_YAW = -0.9;
const MAX_YAW = 1.4;
const SEARCH_STEPS = 14;
/** Head rolls tried per unit of rack (the rack turned up off the ground). */
const RACK_ROLLS = [0, Math.PI / 4, Math.PI / 2] as const;

/** Scratch result of getHeadRest (no allocation). */
const headRest = { roll: 0, yaw: 0 };

/** The head roll and neck turn being tried (module scratch). */
const trial = { cosRoll: 1, cosYaw: 1, ground: 0, sinRoll: 0, sinYaw: 0 };

const setTrial = (ground: number, roll: number, yaw: number) => {
  trial.cosRoll = Math.cos(roll);
  trial.cosYaw = Math.cos(yaw);
  trial.ground = ground;
  trial.sinRoll = Math.sin(roll);
  trial.sinYaw = Math.sin(yaw);
};

/** Height above the ground of a head point after the trial's head roll and neck turn. */
const getPointHeight = (x: number, y: number, z: number) => {
  const rolled = y * trial.sinRoll + z * trial.cosRoll;
  return x * trial.sinYaw + rolled * trial.cosYaw + trial.ground;
};

/** Lowest head and rack point above the ground (model units). */
const getLowestHead = (
  profile: HeadProfile,
  ground: number,
  antlers: number,
  roll: number,
  yaw: number
) => {
  setTrial(ground, roll, yaw);
  let lowest = Infinity;
  for (const [x, y, z] of profile.head) lowest = Math.min(lowest, getPointHeight(x, y, z));
  if (antlers <= 0) return lowest;
  const { pivot } = profile;
  for (const [x, y, z] of profile.rack) {
    const height = getPointHeight(pivot + (x - pivot) * antlers, y * antlers, z * antlers);
    lowest = Math.min(lowest, height);
  }
  return lowest;
};

/** The smallest neck turn whose lowest point clears the ground with a given head roll. */
const findRestYaw = (profile: HeadProfile, ground: number, antlers: number, roll: number) => {
  const clearance = HEAD_CLEARANCE * ground;
  let low = MIN_YAW;
  let high = MAX_YAW;
  if (getLowestHead(profile, ground, antlers, roll, low) >= clearance) return low;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (getLowestHead(profile, ground, antlers, roll, middle) >= clearance) high = middle;
    else low = middle;
  }
  return high;
};

/**
 * How a fallen animal's head lies (lying on its right side): the neck turn (POSE.neckYaw, -
 * towards the ground) and the head roll about its own axis. A bare head lies on its cheek with
 * the ear flat beside it and the muzzle a little lower than the skull; a rack (scaled by the
 * instance's antler size) is rolled up off the ground as far as needed, so the head comes down
 * as low as the rack allows and the rack rests on the ground without cutting into it.
 */
export const getHeadRest = (species: number, antlers: number) => {
  const profile = HEAD_PROFILES[species]!;
  const ground = TORSO[species]!.halfWidth;
  headRest.roll = 0;
  headRest.yaw = findRestYaw(profile, ground, antlers, 0);
  if (antlers <= 0 || profile.rack.length === 0) return headRest;
  for (const share of RACK_ROLLS) {
    const roll = share * Math.min(1, antlers * 2);
    const yaw = findRestYaw(profile, ground, antlers, roll);
    if (yaw >= headRest.yaw - 0.05) continue;
    headRest.roll = roll;
    headRest.yaw = yaw;
  }
  return headRest;
};
