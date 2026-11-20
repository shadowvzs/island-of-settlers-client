import type { PropMesh, Vec3 } from "../../props/mesh-builder";

/** Body part of a vertex (attribute `part`): decides which joints move it. */
export const PART = {
  body: 0,
  rear: 1,
  neck: 2,
  head: 3,
  earLeft: 4,
  earRight: 5,
  tail: 6,
  frontLeftUpper: 7,
  frontLeftLower: 8,
  frontRightUpper: 9,
  frontRightLower: 10,
  hindLeftUpper: 11,
  hindLeftLower: 12,
  hindRightUpper: 13,
  hindRightLower: 14,
  antler: 15
} as const;
export type Part = (typeof PART)[keyof typeof PART];

/** Joint pivots of a species (model space, metres of the island: x forward, y up, z left). */
export const JOINT = {
  root: 0,
  spine: 1,
  neck: 2,
  head: 3,
  earLeft: 4,
  earRight: 5,
  tail: 6,
  frontLeftHip: 7,
  frontLeftKnee: 8,
  frontRightHip: 9,
  frontRightKnee: 10,
  hindLeftHip: 11,
  hindLeftKnee: 12,
  hindRightHip: 13,
  hindRightKnee: 14
} as const;
export const JOINT_COUNT = 15;

/** Pose channels (radians) computed per animal and frame; the renderers only apply them. */
export const POSE = {
  frontLeftHip: 0,
  frontLeftKnee: 1,
  frontRightHip: 2,
  frontRightKnee: 3,
  hindLeftHip: 4,
  hindLeftKnee: 5,
  hindRightHip: 6,
  hindRightKnee: 7,
  spine: 8,
  neckPitch: 9,
  neckYaw: 10,
  headPitch: 11,
  earLeft: 12,
  earRight: 13,
  tail: 14,
  bodyPitch: 15
} as const;
export const POSE_CHANNELS = 16;

/**
 * Rotation of one joint: around z (pitch in the side plane), y (turning the head) or x (a leg
 * swinging out sideways).
 */
interface JointStep {
  axis: "x" | "y" | "z";
  channel: number;
  /**
   * A coupled rotation (no channel of its own): `gain` x how far the channel goes past
   * `onset` on its `side` (+1 above, -1 below). A hock folded flat (only when bedded) swings the
   * hind leg out to the side; a tail below its rest angle (only dead) rolls the head.
   */
  coupling?: { gain: number; onset: number; side: 1 | -1 };
  joint: number;
  /** Parts it moves, one bit per part. */
  parts: number;
}

const bits = (...parts: readonly Part[]) =>
  parts.reduce<number>((mask, part) => mask | (1 << part), 0);

const HEAD_PARTS: readonly Part[] = [PART.head, PART.earLeft, PART.earRight, PART.antler];
/**
 * Bedded hind legs folded to one side: past the gait's hock range (1.25 rad) the cannons roll
 * about the hock before it folds, so they lie forward and to the right: the left one tucked
 * under the belly, the right one out beside it.
 */
export const HOCK_TUCK_ONSET = 1.4;
const HIND_LEFT_TUCK = { gain: 0.5, onset: HOCK_TUCK_ONSET, side: 1 } as const;
const HIND_RIGHT_TUCK = { gain: 1.2, onset: HOCK_TUCK_ONSET, side: 1 } as const;
/**
 * Head roll about its own long axis (a carcass's head tilted so a rack lies on the ground): the
 * living tail never goes below its rest angle, so the limp tail of the dead drives it,
 * HEAD_ROLL_GAIN radians of roll per radian of tail.
 */
export const HEAD_ROLL_GAIN = 4;
const HEAD_ROLL = { gain: HEAD_ROLL_GAIN, onset: 0, side: -1 } as const;

const HIND_PARTS: readonly Part[] = [
  PART.hindLeftUpper,
  PART.hindLeftLower,
  PART.hindRightUpper,
  PART.hindRightLower
] as const;

/**
 * Forward kinematics as an ordered list, children before parents: every rotation turns about
 * its rest pivot, then the parent turns the result. The CPU poser and the generated GLSL walk
 * this one list, so the CPU reference and the skinned instances move identically.
 */
const JOINT_STEPS: readonly JointStep[] = [
  {
    axis: "z",
    channel: POSE.frontLeftKnee,
    joint: JOINT.frontLeftKnee,
    parts: bits(PART.frontLeftLower)
  },
  {
    axis: "z",
    channel: POSE.frontLeftHip,
    joint: JOINT.frontLeftHip,
    parts: bits(PART.frontLeftUpper, PART.frontLeftLower)
  },
  {
    axis: "z",
    channel: POSE.frontRightKnee,
    joint: JOINT.frontRightKnee,
    parts: bits(PART.frontRightLower)
  },
  {
    axis: "z",
    channel: POSE.frontRightHip,
    joint: JOINT.frontRightHip,
    parts: bits(PART.frontRightUpper, PART.frontRightLower)
  },
  {
    axis: "x",
    channel: POSE.hindLeftKnee,
    coupling: HIND_LEFT_TUCK,
    joint: JOINT.hindLeftKnee,
    parts: bits(PART.hindLeftLower)
  },
  {
    axis: "z",
    channel: POSE.hindLeftKnee,
    joint: JOINT.hindLeftKnee,
    parts: bits(PART.hindLeftLower)
  },
  {
    axis: "z",
    channel: POSE.hindLeftHip,
    joint: JOINT.hindLeftHip,
    parts: bits(PART.hindLeftUpper, PART.hindLeftLower)
  },
  {
    axis: "x",
    channel: POSE.hindRightKnee,
    coupling: HIND_RIGHT_TUCK,
    joint: JOINT.hindRightKnee,
    parts: bits(PART.hindRightLower)
  },
  {
    axis: "z",
    channel: POSE.hindRightKnee,
    joint: JOINT.hindRightKnee,
    parts: bits(PART.hindRightLower)
  },
  {
    axis: "z",
    channel: POSE.hindRightHip,
    joint: JOINT.hindRightHip,
    parts: bits(PART.hindRightUpper, PART.hindRightLower)
  },
  { axis: "z", channel: POSE.earLeft, joint: JOINT.earLeft, parts: bits(PART.earLeft) },
  { axis: "z", channel: POSE.earRight, joint: JOINT.earRight, parts: bits(PART.earRight) },
  {
    axis: "x",
    channel: POSE.tail,
    coupling: HEAD_ROLL,
    joint: JOINT.head,
    parts: bits(...HEAD_PARTS)
  },
  { axis: "z", channel: POSE.headPitch, joint: JOINT.head, parts: bits(...HEAD_PARTS) },
  { axis: "z", channel: POSE.neckPitch, joint: JOINT.neck, parts: bits(PART.neck, ...HEAD_PARTS) },
  { axis: "y", channel: POSE.neckYaw, joint: JOINT.neck, parts: bits(PART.neck, ...HEAD_PARTS) },
  { axis: "z", channel: POSE.tail, joint: JOINT.tail, parts: bits(PART.tail) },
  {
    axis: "z",
    channel: POSE.spine,
    joint: JOINT.spine,
    parts: bits(PART.rear, PART.tail, ...HIND_PARTS)
  },
  { axis: "z", channel: POSE.bodyPitch, joint: JOINT.root, parts: 0xffff }
];

/**
 * A species model: the skinned mesh in rest pose (x forward, y up, z left, island units), up
 * to two body parts per vertex (the pose blends them, so joints bend smoothly) and the joint
 * pivots taken from the model's skeleton.
 */
export interface AnimalModel {
  /** Pivot of the antlers (they scale about it; 0 hides them). */
  antlerPivot: Vec3;
  /** Second part of each vertex and its weight (0: only `parts`). */
  blendParts: Float32Array;
  blendWeights: Float32Array;
  /**
   * Set when the vertex colours are coat masks (rabbits): the renderer colours them per
   * individual; `juvenile` softens and mottles the young coat.
   */
  coatMasks?: { juvenile: number };
  /** Per vertex fur flow (rest pose direction xyz) and stroke length (0: no fur). */
  fur: Float32Array;
  joints: Vec3[];
  /** Positions, normals, atlas uvs (-1: untextured, the colour only) and colour tints. */
  mesh: PropMesh;
  parts: Float32Array;
  /** Per vertex roughness (matte fur, glossy eyes). */
  roughness: Float32Array;
  /** Juvenile coat of the stage: 0 .. 1 white spot strength and warmth (deer and elk). */
  spots: number;
  /**
   * Elk rump patch in rest space (rear x, centre height, half height, half width): drawn per
   * pixel with a crisp dark edge; none for other species.
   */
  rumpPatch?: readonly [number, number, number, number];
  /** Winter coat grade (saturation, rgb tint), set only for the winter variants. */
  winterGrade?: readonly [number, number, number, number];
  /** 0 .. 1 where coat spots may sit (back and flanks, not the belly or the head). */
  spotRegion: Float32Array;
  warmth: number;
}

const rotate = (
  target: Float32Array,
  offset: number,
  pivot: Vec3 | null,
  axis: JointStep["axis"],
  angle: number
) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const px = pivot ? pivot[0] : 0;
  const py = pivot ? pivot[1] : 0;
  const pz = pivot ? pivot[2] : 0;
  const x = target[offset]! - px;
  const y = target[offset + 1]! - py;
  const z = target[offset + 2]! - pz;
  if (axis === "z") {
    target[offset] = x * cos - y * sin + px;
    target[offset + 1] = x * sin + y * cos + py;
    return;
  }
  if (axis === "x") {
    target[offset + 1] = y * cos - z * sin + py;
    target[offset + 2] = y * sin + z * cos + pz;
    return;
  }
  target[offset] = x * cos - z * sin + px;
  target[offset + 2] = x * sin + z * cos + pz;
};

/** Angle of one step: its channel, or the coupled rotation driven by it. */
const getStepAngle = (step: JointStep, pose: ArrayLike<number>) => {
  const value = pose[step.channel]!;
  if (!step.coupling) return value;
  const { gain, onset, side } = step.coupling;
  return gain * Math.max(0, side * value - onset);
};

const AXIS_ROTATIONS = { x: "rotateX", y: "rotateY", z: "rotateZ" } as const;

/** GLSL angle of one step (the same as getStepAngle). */
const getStepAngleGlsl = (step: JointStep) => {
  const value = `pose[${step.channel}]`;
  if (!step.coupling) return value;
  const { gain, onset, side } = step.coupling;
  return `${gain.toFixed(4)} * max(0.0, ${side.toFixed(1)} * ${value} - ${onset.toFixed(4)})`;
};

/** One vertex (position and normal at `offset`) posed as `part`, written to the scratch. */
const posePart = (
  model: AnimalModel,
  pose: ArrayLike<number>,
  antlers: number,
  offset: number,
  part: number,
  scratch: Float32Array
) => {
  const { normals, positions } = model.mesh;
  const pivot = model.antlerPivot;
  for (let axis = 0; axis < 3; axis += 1) {
    const value = positions[offset + axis]!;
    scratch[axis] = part === PART.antler ? pivot[axis]! + (value - pivot[axis]!) * antlers : value;
    scratch[3 + axis] = normals[offset + axis]!;
  }
  for (const step of JOINT_STEPS) {
    if ((step.parts & (1 << part)) === 0) continue;
    const angle = getStepAngle(step, pose);
    rotate(scratch, 0, model.joints[step.joint]!, step.axis, angle);
    rotate(scratch, 3, null, step.axis, angle);
  }
};

/** CPU posing (tests): the same steps the vertex shader runs. */
export const poseAnimalMesh = (
  model: AnimalModel,
  pose: ArrayLike<number>,
  antlers: number
): PropMesh => {
  const positions = new Float32Array(model.mesh.positions.length);
  const normals = new Float32Array(model.mesh.normals.length);
  const first = new Float32Array(6);
  const second = new Float32Array(6);
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    const offset = vertex * 3;
    const weight = model.blendWeights[vertex]!;
    posePart(model, pose, antlers, offset, model.parts[vertex]!, first);
    second.set(first);
    if (weight > 0) posePart(model, pose, antlers, offset, model.blendParts[vertex]!, second);
    for (let axis = 0; axis < 6; axis += 1) {
      first[axis] = first[axis]! + (second[axis]! - first[axis]!) * weight;
    }
    const length = Math.hypot(first[3]!, first[4]!, first[5]!) || 1;
    for (let axis = 0; axis < 3; axis += 1) {
      positions[offset + axis] = first[axis]!;
      normals[offset + axis] = first[3 + axis]! / length;
    }
  }
  return { ...model.mesh, normals, positions };
};

/**
 * GLSL of the same rig: `poseVertex(position, normal, part, antlers)` with uniforms uJoints
 * (pivots) and uAntlerPivot, and `float pose[16]` filled by the caller from the instance
 * attributes; `poseBlended` poses a vertex as both of its parts and blends them.
 */
export const createRigGlsl = () => {
  const steps = JOINT_STEPS.map((step) => {
    const rotation = AXIS_ROTATIONS[step.axis];
    const joint = `uJoints[${step.joint}]`;
    const angle = getStepAngleGlsl(step);
    return `  if ((bit & ${step.parts}) != 0) {
    float angle = ${angle};
    position = ${rotation}(position - ${joint}, angle) + ${joint};
    normal = ${rotation}(normal, angle);
  }`;
  });
  return `
uniform vec3 uJoints[${JOINT_COUNT}];
uniform vec3 uAntlerPivot;
float pose[${POSE_CHANNELS}];

vec3 rotateZ(vec3 v, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
}

vec3 rotateX(vec3 v, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}

vec3 rotateY(vec3 v, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(v.x * c - v.z * s, v.y, v.x * s + v.z * c);
}

void poseVertex(inout vec3 position, inout vec3 normal, float partId, float antlers) {
  int part = int(partId + 0.5);
  int bit = 1 << part;
  if (part == ${PART.antler}) position = uAntlerPivot + (position - uAntlerPivot) * antlers;
${steps.join("\n")}
}

void poseBlended(inout vec3 position, inout vec3 normal, vec3 parts, float antlers) {
  vec3 firstPosition = position;
  vec3 firstNormal = normal;
  poseVertex(firstPosition, firstNormal, parts.x, antlers);
  if (parts.z > 0.0) {
    poseVertex(position, normal, parts.y, antlers);
    firstPosition = mix(firstPosition, position, parts.z);
    firstNormal = mix(firstNormal, normal, parts.z);
  }
  position = firstPosition;
  normal = normalize(firstNormal);
}
`;
};
