import { normalize, type Vec3 } from "../../props/mesh-builder";
import type { StageShape } from "../wildlife-stages";
import { type AnimalModel,JOINT, JOINT_COUNT, PART } from "./animal-rig";

/** Leg parts and the hip / shoulder joint each hangs from. */
const LEG_TOPS: Record<number, number> = {
  [PART.frontLeftUpper]: JOINT.frontLeftHip,
  [PART.frontLeftLower]: JOINT.frontLeftHip,
  [PART.frontRightUpper]: JOINT.frontRightHip,
  [PART.frontRightLower]: JOINT.frontRightHip,
  [PART.hindLeftUpper]: JOINT.hindLeftHip,
  [PART.hindLeftLower]: JOINT.hindLeftHip,
  [PART.hindRightUpper]: JOINT.hindRightHip,
  [PART.hindRightLower]: JOINT.hindRightHip
};
const HEAD_PARTS = new Set<number>([PART.head, PART.earLeft, PART.earRight, PART.antler]);
const EAR_JOINTS: Record<number, number> = {
  [PART.earLeft]: JOINT.earLeft,
  [PART.earRight]: JOINT.earRight
};
/** Part whose transform moves each joint (hips and knees follow their leg, ears the head). */
const JOINT_PARTS: number[] = [
  PART.body,
  PART.body,
  PART.body,
  PART.head,
  PART.head,
  PART.head,
  PART.tail,
  PART.frontLeftUpper,
  PART.frontLeftLower,
  PART.frontRightUpper,
  PART.frontRightLower,
  PART.hindLeftUpper,
  PART.hindLeftLower,
  PART.hindRightUpper,
  PART.hindRightLower
];

type Point = [number, number, number];

/**
 * Structural proportions of a life stage applied to the adult rest model, part by part about
 * its joints (never one uniform scale): torso about the root, legs stretched from their hips
 * with the body lifted so the hooves stay on the ground, the neck along its axis, the head and
 * ears about their pivots. Joints move with their parts, so the same rig and gaits drive it.
 */
const createMorph = (joints: readonly Vec3[], shape: StageShape) => {
  const root = joints[JOINT.root]!;
  const neck = joints[JOINT.neck]!;
  const head = joints[JOINT.head]!;
  const hipHeight = (joints[JOINT.frontLeftHip]![1] + joints[JOINT.hindLeftHip]![1]) / 2;
  const lift = hipHeight * (shape.legs - 1);
  const neckAxis = normalize([head[0] - neck[0], head[1] - neck[1], head[2] - neck[2]]);

  const body = (p: Vec3): Point => [
    root[0] + (p[0] - root[0]) * shape.body[0],
    root[1] + (p[1] - root[1]) * shape.body[1] + lift,
    root[2] + (p[2] - root[2]) * shape.body[2]
  ];
  const neckOnly = (p: Vec3): Point => {
    const offset: Point = [p[0] - neck[0], p[1] - neck[1], p[2] - neck[2]];
    const along = offset[0] * neckAxis[0] + offset[1] * neckAxis[1] + offset[2] * neckAxis[2];
    const scaledAlong = along * shape.neckLength;
    const moved = body(neck);
    return [0, 1, 2].map(
      (axis) =>
        moved[axis]! +
        neckAxis[axis]! * scaledAlong +
        (offset[axis]! - neckAxis[axis]! * along) * shape.neckThickness
    ) as Point;
  };
  const headPivot = neckOnly(head);
  const headOnly = (p: Vec3): Point =>
    [0, 1, 2].map(
      (axis) => headPivot[axis]! + (p[axis]! - head[axis]!) * shape.head[axis]!
    ) as Point;
  const ear = (p: Vec3, joint: number): Point => {
    const base = joints[joint]!;
    const scaled: Point = [0, 1, 2].map(
      (axis) => base[axis]! + (p[axis]! - base[axis]!) * shape.ears
    ) as Point;
    return headOnly(scaled);
  };
  const leg = (p: Vec3, joint: number): Point => {
    const top = joints[joint]!;
    const moved = body(top);
    return [
      moved[0] + p[0] - top[0],
      moved[1] + (p[1] - top[1]) * shape.legs,
      moved[2] + p[2] - top[2]
    ];
  };

  /** New position of a rest point that belongs to `part`. */
  return (p: Vec3, part: number): Point => {
    if (LEG_TOPS[part] !== undefined) return leg(p, LEG_TOPS[part]!);
    if (EAR_JOINTS[part] !== undefined) return ear(p, EAR_JOINTS[part]!);
    if (HEAD_PARTS.has(part)) return headOnly(p);
    if (part === PART.neck) return neckOnly(p);
    return body(p);
  };
};

/** Scale of a part (for its normals: they transform by the inverse scale). */
const getPartScale = (shape: StageShape, part: number): Vec3 => {
  if (LEG_TOPS[part] !== undefined) return [1, shape.legs, 1];
  if (HEAD_PARTS.has(part)) return shape.head;
  if (part === PART.neck) return [shape.neckThickness, shape.neckLength, shape.neckThickness];
  return shape.body;
};

/** The stage's model: positions, normals and joints morphed (blended parts blend too). */
export const morphModel = (model: AnimalModel, shape: StageShape): AnimalModel => {
  const morph = createMorph(model.joints, shape);
  const source = model.mesh;
  const positions = new Float32Array(source.positions.length);
  const normals = new Float32Array(source.normals.length);
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    const offset = vertex * 3;
    const part = model.parts[vertex]!;
    const rest: Vec3 = [
      source.positions[offset]!,
      source.positions[offset + 1]!,
      source.positions[offset + 2]!
    ];
    const moved = morph(rest, part);
    const weight = model.blendWeights[vertex]!;
    if (weight > 0) {
      const blended = morph(rest, model.blendParts[vertex]!);
      for (let axis = 0; axis < 3; axis += 1) {
        moved[axis] = moved[axis]! + (blended[axis]! - moved[axis]!) * weight;
      }
    }
    positions.set(moved, offset);
    const scale = getPartScale(shape, part);
    normals.set(
      normalize([
        source.normals[offset]! / scale[0],
        source.normals[offset + 1]! / scale[1],
        source.normals[offset + 2]! / scale[2]
      ]),
      offset
    );
  }
  const joints = Array.from({ length: JOINT_COUNT }, (_, joint) =>
    morph(model.joints[joint]!, JOINT_PARTS[joint]!)
  );
  return {
    ...model,
    antlerPivot: morph(model.antlerPivot, PART.head),
    joints,
    mesh: { ...source, normals, positions }
  };
};
