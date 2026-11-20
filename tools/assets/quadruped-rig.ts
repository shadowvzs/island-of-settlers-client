import type { Quaternion } from "three";

import type { Vec3 } from "../../src/render-common/props/mesh-builder";
import { type BoneOffsets, skinPose, type SkinSource } from "./gltf-skin-sampler";
import {
  createRiggedSource,
  type RigBone,
  type StaticMesh,
  turn,
  weighBySegments,
  type WeightBone} from "./static-rig";

/**
 * A synthetic four legged rig for static sources (wolf, boar), in scene space facing +z, y up,
 * the left side at +x: spine (pelvis, back, chest), neck, head, a tail chain and four legs of
 * three segments and a paw. Gaits are sampled offline as bone offsets: a lateral walk, a
 * diagonal trot and a rotary gallop with the planted foot sweeping back at a constant rate,
 * the swing folding the lower leg, the paw kept level while planted.
 */

export type LegName = "fl" | "fr" | "hl" | "hr";
const LEGS: readonly LegName[] = ["fl", "fr", "hl", "hr"];

/** A leg's joints from the top (shoulder / hip) to the toe tip, on the left side (+x). */
export interface LegJoints {
  /** Top (shoulder or hip), elbow or stifle, carpus or hock, the paw (fetlock) and toe tip. */
  joints: readonly [Vec3, Vec3, Vec3, Vec3, Vec3];
}

/** Landmarks of the standing source (scene space, left side), mirrored for the right legs. */
export interface QuadLandmarks {
  chest: Vec3;
  fore: LegJoints;
  head: Vec3;
  hind: LegJoints;
  neck: Vec3;
  nose: Vec3;
  pelvis: Vec3;
  /** Back (middle of the spine). */
  spine: Vec3;
  /** Tail base to tip. */
  tail: readonly Vec3[];
  /** Radius of the trunk about the spine line: the flanks stay with it, not with the legs. */
  trunkRadius: number;
}

/** Landmarks with every leg's joints fitted to the source (legs need not be symmetric). */
interface FittedLandmarks extends QuadLandmarks {
  legs: Record<LegName, Vec3[]>;
}

const mirror = (point: Vec3, side: number): Vec3 => [point[0] * side, point[1], point[2]];
const sideOf = (leg: LegName) => (leg.endsWith("l") ? 1 : -1);
const templateOf = (landmarks: QuadLandmarks, leg: LegName) =>
  (leg.startsWith("f") ? landmarks.fore.joints : landmarks.hind.joints).map((joint) => mirror(joint, sideOf(leg)));

/** Mean x and z of the slice of the left (side 1) or right leg of a pair (two means on x). */
const fitSlice = (points: number[][], side: number) => {
  let [right, left] = [-0.1, 0.1];
  let groups: number[][][] = [[], []];
  for (let round = 0; round < 16; round += 1) {
    groups = [[], []];
    for (const point of points) groups[Math.abs(point[0]! - right) < Math.abs(point[0]! - left) ? 0 : 1]!.push(point);
    const mean = (group: number[][], axis: number) => group.reduce((sum, point) => sum + point[axis]!, 0) / group.length;
    if (!groups[0]!.length || !groups[1]!.length) return null;
    [right, left] = [mean(groups[0]!, 0), mean(groups[1]!, 0)];
  }
  const group = groups[side > 0 ? 1 : 0]!;
  return [side > 0 ? left : right, group.reduce((sum, point) => sum + point[1]!, 0) / group.length];
};

/**
 * Fits each leg's joints below the trunk to the mesh: the horizontal slice at a joint's height
 * (near its landmark) split into the left and right leg. The top follows its leg's lateral
 * shift; the paw and toe keep their landmark z (a slice there is the whole foot).
 */
const fitLegs = (positions: Float32Array, landmarks: QuadLandmarks): Record<LegName, Vec3[]> => {
  const fit = (leg: LegName) => {
    const template = templateOf(landmarks, leg);
    const height = template[0]![1];
    const window = height * 0.25;
    const joints = template.map((joint, index): Vec3 => {
      if (index === 0) return joint;
      const points: number[][] = [];
      for (let at = 0; at < positions.length; at += 3) {
        const near = Math.abs(positions[at + 1]! - joint[1]) < height * 0.03 && Math.abs(positions[at + 2]! - joint[2]) < window;
        if (near) points.push([positions[at]!, positions[at + 2]!]);
      }
      const slice = fitSlice(points, sideOf(leg));
      if (!slice) return joint;
      return [slice[0]!, joint[1], index < 3 ? slice[1]! : joint[2]];
    });
    joints[0] = [joints[0]![0] + (joints[1]![0] - template[1]![0]), joints[0]![1], joints[0]![2]];
    return joints;
  };
  return { fl: fit("fl"), fr: fit("fr"), hl: fit("hl"), hr: fit("hr") };
};

const legJoints = (landmarks: FittedLandmarks, leg: LegName) => landmarks.legs[leg];

/** Bones of the rig (names: pelvis, spine, chest, neck, head, tail0.., fl0..fl3, ...). */
export const createQuadBones = (landmarks: FittedLandmarks): RigBone[] => {
  const bones: RigBone[] = [
    { at: landmarks.pelvis, name: "pelvis" },
    { at: landmarks.spine, name: "spine", parent: "pelvis" },
    { at: landmarks.chest, name: "chest", parent: "spine" },
    { at: landmarks.neck, name: "neck", parent: "chest" },
    { at: landmarks.head, name: "head", parent: "neck" }
  ];
  landmarks.tail.slice(0, -1).forEach((at, index) => {
    bones.push({ at, name: `tail${index}`, parent: index === 0 ? "pelvis" : `tail${index - 1}` });
  });
  for (const leg of LEGS) {
    const joints = legJoints(landmarks, leg);
    const top = leg.startsWith("f") ? "chest" : "pelvis";
    joints.slice(0, -1).forEach((at, index) => {
      bones.push({ at, name: `${leg}${index}`, parent: index > 0 ? `${leg}${index - 1}` : top });
    });
  }
  return bones;
};

const smooth = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Weight gates: a leg bone moves only its own side and end of the body, below the top of the
 * leg, and above the elbow / stifle only the outer side (the belly stays with the trunk); tail
 * bones only behind the tail base.
 */
const createWeightBones = (landmarks: FittedLandmarks, bones: RigBone[]): WeightBone[] => {
  const index = new Map(bones.map((bone, bone_) => [bone.name, bone_]));
  const middle = (landmarks.pelvis[2] + landmarks.chest[2]) / 2;
  const segment = (name: string, to: Vec3, allow?: WeightBone["allow"]): WeightBone =>
    ({ allow, bone: index.get(name)!, from: bones[index.get(name)!]!.at, to });
  const trunk = (name: string, to: Vec3): WeightBone => ({ ...segment(name, to), radius: landmarks.trunkRadius });
  const out: WeightBone[] = [
    trunk("pelvis", landmarks.spine),
    trunk("spine", landmarks.chest),
    segment("chest", landmarks.neck),
    segment("neck", landmarks.head),
    segment("head", landmarks.nose)
  ];
  const tailBase = landmarks.tail[0]!;
  landmarks.tail.slice(0, -1).forEach((_, tail) => {
    out.push(segment(`tail${tail}`, landmarks.tail[tail + 1]!, (point) =>
      smooth(tailBase[2] + 0.02, tailBase[2] - 0.04, point[2])));
  });
  for (const leg of LEGS) {
    const side = sideOf(leg);
    const front = leg.startsWith("f");
    const joints = legJoints(landmarks, leg);
    const pair = landmarks.legs[`${leg[0]}${side > 0 ? "r" : "l"}` as LegName];
    const centre = (joints[1]![0] + pair[1]![0]) / 2;
    const top = joints[0]![1];
    const [knee, width] = [joints[1]![1], Math.abs(joints[1]![0] - centre)];
    const gate = (point: Vec3) => {
      const out = (point[0] - centre) * side;
      return smooth(-width * 0.1, width * 0.25, out) *
      Math.max(smooth(knee, knee - top * 0.04, point[1]), smooth(width * 0.35, width * 0.65, out)) *
      smooth(middle, front ? middle + 0.08 : middle - 0.08, point[2]) *
      smooth(top * 1.05, top * 0.92, point[1]);
    };
    // A lower segment never takes the trunk above its own joint (the ham stays on the thigh).
    joints.slice(0, -1).forEach((at, joint) => {
      const below = (point: Vec3) => (joint === 0 ? 1 : smooth(at[1] + top * 0.07, at[1] - top * 0.015, point[1]));
      out.push(segment(`${leg}${joint}`, joints[joint + 1]!, (point) => gate(point) * below(point)));
    });
  }
  return out;
};

/** The static source rigged as a four legged animal. */
export const rigQuadruped = (mesh: StaticMesh, landmarks: QuadLandmarks, power = 5) => {
  const fitted = { ...landmarks, legs: fitLegs(mesh.positions, landmarks) };
  const bones = createQuadBones(fitted);
  const weights = weighBySegments(mesh.positions, createWeightBones(fitted, bones), power);
  return createRiggedSource(mesh, bones, weights);
};

/** A gait: stance share, phase offset per leg (fl, fr, hl, hr), sweep and swing fold. */
export interface QuadGait {
  /** Hip / shoulder sweep either side of upright (radians). */
  amplitude: number;
  duty: number;
  /** Fold of the lower leg (carpus, hock) at the middle of the swing (radians). */
  fold: number;
  offsets: readonly [number, number, number, number];
  /** Spine flex (radians, gallop: gathered and stretched). */
  spine?: number;
}

export const QUAD_GAITS = {
  gallop: { amplitude: 0.62, duty: 0.34, fold: 1.5, offsets: [0.45, 0.57, 0, 0.12], spine: 0.12 },
  trot: { amplitude: 0.42, duty: 0.48, fold: 1.25, offsets: [0.5, 0, 0, 0.5] },
  walk: { amplitude: 0.3, duty: 0.64, fold: 0.9, offsets: [0.25, 0.75, 0, 0.5] }
} as const satisfies Record<string, QuadGait>;

/** A gait with a species' sweep and swing fold scaled (short legged boars). */
export const scaleGait = (gait: QuadGait, amplitude: number, fold: number): QuadGait =>
  ({ ...gait, amplitude: gait.amplitude * amplitude, fold: gait.fold * fold });

const LATERAL: Vec3 = [1, 0, 0];
const FORWARD: Vec3 = [0, 0, 1];
const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
const fract = (value: number) => value - Math.floor(value);

/** A leg's sweep (+ back) and fold (0..1 of the gait's fold) at its phase. */
const sampleLeg = (phase: number, gait: QuadGait) => {
  if (phase < gait.duty) {
    return { fold: 0, sweep: Math.asin(Math.sin(gait.amplitude) * ((2 * phase) / gait.duty - 1)) };
  }
  const swing = (phase - gait.duty) / (1 - gait.duty);
  return { fold: Math.sin(Math.PI * swing), sweep: gait.amplitude * (1 - 2 * ease(swing)) };
};

/** Pitch (+ back / down) about the lateral axis. */
export const pitch = (angle: number) => turn(LATERAL, angle);
/** Roll about the forward axis (+ the left side up). */
export const roll = (angle: number) => turn(FORWARD, angle);

/**
 * One leg's joint offsets: sweep at the top, the swing fold at the carpus (back) or the hock
 * (forward) with the elbow / stifle helping, the paw level while planted, curled in the swing.
 */
export const poseLeg = (leg: LegName, sweep: number, fold: number, out: BoneOffsets) => {
  const front = leg.startsWith("f");
  const middle = front ? -0.35 * fold : 0.55 * fold;
  const lower = front ? 1.1 * fold : -1.0 * fold;
  out[`${leg}0`] = pitch(sweep);
  out[`${leg}1`] = pitch(middle);
  out[`${leg}2`] = pitch(lower);
  out[`${leg}3`] = pitch(-(sweep + middle + lower) + (front ? 0.6 : 0.5) * fold);
};

/** Bone offsets of a gait at a phase (0..1). */
export const getGaitOffsets = (gait: QuadGait, phase: number): BoneOffsets => {
  const out: BoneOffsets = {};
  LEGS.forEach((leg, index) => {
    const sample = sampleLeg(fract(phase + gait.offsets[index]!), gait);
    poseLeg(leg, sample.sweep, sample.fold * gait.fold, out);
  });
  if (gait.spine) {
    const flex = Math.sin(Math.PI * 2 * (phase - 0.1)) * gait.spine;
    out.spine = pitch(-flex);
    out.chest = pitch(flex * 0.5);
  }
  return out;
};

/** Merges offset sets (rotations of the same bone multiplied). */
export const mergeOffsets = (...sets: BoneOffsets[]): BoneOffsets => {
  const out: BoneOffsets = {};
  for (const set of sets) {
    for (const [name, rotation] of Object.entries(set)) {
      out[name] = out[name] ? (out[name]!.clone().multiply(rotation) as Quaternion) : rotation;
    }
  }
  return out;
};

/** Lowest point (scene y) of the vertices with `weights` > 0.5 in a pose. */
const lowestOf = (source: SkinSource, offsets: BoneOffsets, weights: Float32Array) => {
  const { positions } = skinPose(source, 0, 0, offsets);
  let lowest = Infinity;
  for (let vertex = 0; vertex < weights.length; vertex += 1) {
    if (weights[vertex]! > 0.5) lowest = Math.min(lowest, positions[vertex * 3 + 1]!);
  }
  return lowest;
};

/** Joint angles of a leg (+ back, from the top to the paw) and its splay (+ outwards). */
export interface LegAngles {
  angles: readonly [number, number, number, number];
  splay?: number;
}

/** Offsets that set each leg's joints (a still pose: lying, a fall). */
export const poseLegs = (legs: Partial<Record<"fore" | "hind", LegAngles>>) => {
  const out: BoneOffsets = {};
  for (const leg of LEGS) {
    const pose = legs[leg.startsWith("f") ? "fore" : "hind"];
    if (!pose) continue;
    const side = leg.endsWith("l") ? 1 : -1;
    pose.angles.forEach((angle, joint) => { out[`${leg}${joint}`] = pitch(angle); });
    if (pose.splay) out[`${leg}0`] = roll(pose.splay * side).multiply(out[`${leg}0`]!);
  }
  return out;
};

/**
 * Lying on the brisket (the frame grounded on its lowest point): the forearms forward on the
 * ground, the paws level; the thighs forward, the shanks folded back beside the belly, the
 * hind paws forward on the ground. Angles suit a dog-like leg (scaled per species).
 */
export const LYING_LEGS: Record<"fore" | "hind", LegAngles> = {
  fore: { angles: [0.2, -1.5, 0, 1.25] },
  hind: { angles: [-0.2, 1.4, -2.2, 0.75], splay: 0.3 }
};

/**
 * Head down to the ground (sniffing, rooting): the neck and head pitch down (bisection) until
 * the head's lowest point is `clearance` above the standing ground (scene y 0), or as low as
 * the neck reaches (`limit` radians) with the face still forward.
 */
export const solveHeadDown = (
  source: SkinSource,
  head: Float32Array,
  clearance: number,
  limit = 1.15
) => {
  const pose = (amount: number) => ({ head: pitch(-amount * 0.1), neck: pitch(amount) });
  let [low, high] = [0, limit];
  for (let step = 0; step < 18; step += 1) {
    const amount = (low + high) / 2;
    if (lowestOf(source, pose(amount), head) > clearance) low = amount;
    else high = amount;
  }
  return pose((low + high) / 2);
};
