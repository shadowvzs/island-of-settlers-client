import { CROWD_JOINTS } from "@workers/character-lods/lod-policy";
import {
  type AnimationClip,
  AnimationMixer,
  Bone,
  DataTexture,
  Matrix4,
  NearestFilter,
  type Object3D,
  Quaternion,
  RGBAIntegerFormat,
  ShortType,
  type Skeleton,
  SkinnedMesh,
  Vector3
} from "three";

import { CROWD_BAKE_FPS, crowdClipFrames, type CrowdClipRange } from "./worker-gpu-pose";

/**
 * C06: the baked bone-matrix texture of one body type. Every clip is sampled at CROWD_BAKE_FPS on
 * a private rig clone; each sampled frame is one texture row holding, for the 22 crowd joints, the
 * full skinning matrix of the LOD3 body (mesh placement, bind and inverse bind included), so the
 * instanced vertex shader only mixes rows and skins. The same float data poses the actor's crowd
 * bones on the CPU for the props and headwear hanging from them (`poseCrowdBones`).
 *
 * Layout: column `joint * 3 + r` of a row is matrix row `r` (`m[r][0..3]`) as one texel. The GPU
 * texture is 16-bit signed fixed-point (C06b): half the RGBA32F memory like RGBA16F, but 1/4096
 * model unit (≈0.24 mm) quantisation stays inside the 1 mm crowd-LOD bound that half missed
 * (measured 1.11 mm on the owner save). The float32 array stays for the CPU socket blend.
 */

/** Texels per joint: the three rows of an affine 3x4 matrix. */
export const CROWD_JOINT_TEXELS = 3;
export const CROWD_BAKE_COLUMNS = CROWD_JOINTS.length * CROWD_JOINT_TEXELS;
/**
 * Fixed-point units per model unit of the 16-bit GPU texel (C06b). The step is 1/4096 ≈ 0.24 mm,
 * so every matrix element is within 1/8192 of the float32 bake; RGBA16F measured up to 1.11 mm
 * skinned-position error on the owner save, above the 1 mm crowd-LOD bound. ±8 model units fit.
 */
export const CROWD_BAKE_QUANTIZATION = 4096;
/** Quantised texel value of one matrix element, clamped to the int16 range. */
export const crowdBakeTexel = (value: number) => {
  const scaled = Math.round(value * CROWD_BAKE_QUANTIZATION);
  if (scaled < -32768) return -32768;
  if (scaled > 32767) return 32767;
  return scaled;
};
const FLOATS_PER_TEXEL = 4;
const FLOATS_PER_ROW = CROWD_BAKE_COLUMNS * FLOATS_PER_TEXEL;
const FLOATS_PER_JOINT = CROWD_JOINT_TEXELS * FLOATS_PER_TEXEL;
/** Sampled just inside the clip's end: a loop's last row equals its first (LoopRepeat never wraps). */
const END_EPSILON = 1e-4;
/** Column-major element index of matrix row `r`, column `c`. */
const element = (row: number, column: number) => column * 4 + row;

const CROWD_ROW_OF: ReadonlyMap<string, number> = new Map(CROWD_JOINTS.map((name, index) => [name, index]));

/** Crowd joint row (0..21) of a bone name, or undefined for a non-crowd joint. */
export const crowdJointRow = (name: string) => CROWD_ROW_OF.get(name);

/**
 * The crowd row every bone of `skeleton` maps to: a crowd joint's own row, otherwise the row of
 * its nearest crowd ancestor (fingers to the hand, end bones to their parent). The authored LOD3
 * weights already sit on crowd joints (C04); the ancestor fallback keeps a stray weight sensible.
 */
export const crowdJointRemap = (skeleton: Skeleton) => skeleton.bones.map(bone => {
  let current: Object3D | null = bone;
  while (current instanceof Bone) {
    const row = crowdJointRow(current.name);
    if (row !== undefined) return row;
    current = current.parent;
  }
  return 0;
});

/** Placement of the LOD3 template mesh within an actor: its parent's name and its local transform. */
export interface CrowdBakeTemplate {
  bindMatrix: Matrix4;
  bindMatrixInverse: Matrix4;
  local: Matrix4;
  parentName: string | undefined;
}

export const crowdBakeTemplate = (mesh: SkinnedMesh): CrowdBakeTemplate => ({
  bindMatrix: mesh.bindMatrix.clone(),
  bindMatrixInverse: mesh.bindMatrixInverse.clone(),
  local: new Matrix4().compose(mesh.position, mesh.quaternion, mesh.scale),
  parentName: mesh.parent?.name || undefined
});

interface RestPose { node: Object3D; position: Vector3; quaternion: Quaternion; scale: Vector3 }

const captureRest = (root: Object3D) => {
  const rest: RestPose[] = [];
  root.traverse(node => rest.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(),
    scale: node.scale.clone() }));
  return rest;
};

const restoreRest = (rest: readonly RestPose[]) => {
  for (const { node, position, quaternion, scale } of rest) {
    node.position.copy(position);
    node.quaternion.copy(quaternion);
    node.scale.copy(scale);
  }
};

const skeletonOf = (root: Object3D) => {
  let skeleton: Skeleton | undefined;
  root.traverse(node => { if (!skeleton && node instanceof SkinnedMesh) skeleton = node.skeleton; });
  return skeleton;
};

/** Writes the three affine rows of `matrix` at `offset` (12 floats) into the CPU and GPU copies. */
const writeJoint = (data: Float32Array, texelData: Int16Array, offset: number, matrix: Matrix4) => {
  const e = matrix.elements;
  for (let row = 0; row < CROWD_JOINT_TEXELS; row++) {
    const texel = offset + row * FLOATS_PER_TEXEL;
    data[texel] = e[element(row, 0)]!;
    data[texel + 1] = e[element(row, 1)]!;
    data[texel + 2] = e[element(row, 2)]!;
    data[texel + 3] = e[element(row, 3)]!;
    for (let channel = 0; channel < FLOATS_PER_TEXEL; channel++)
      texelData[texel + channel] = crowdBakeTexel(data[texel + channel]!);
  }
};

/** Reads an affine joint block (12 floats) into a Matrix4 (last row 0 0 0 1). */
const readJoint = (block: ArrayLike<number>, matrix: Matrix4) => {
  const e = matrix.elements;
  for (let row = 0; row < CROWD_JOINT_TEXELS; row++) {
    const texel = row * FLOATS_PER_TEXEL;
    e[element(row, 0)] = block[texel]!;
    e[element(row, 1)] = block[texel + 1]!;
    e[element(row, 2)] = block[texel + 2]!;
    e[element(row, 3)] = block[texel + 3]!;
  }
  e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
  return matrix;
};

/** The pose an instance draws: rows A and B mixed by `mix`, then the fading previous row. */
export interface CrowdPoseRows {
  mix: number;
  previousRow: number;
  previousWeight: number;
  rowA: number;
  rowB: number;
}

export interface CrowdBakeOptions {
  clips: readonly AnimationClip[];
  /** A private clone of the body type's rig; the bake owns and disposes it. */
  rig: Object3D;
  template: CrowdBakeTemplate;
}

const jointBlock = new Float32Array(FLOATS_PER_JOINT);
const scratch = new Matrix4();
const rootPlacement = new Matrix4();

/**
 * Bakes `clips` of `rig` into one texture, chunked by `step`'s time budget (`finish` completes it
 * at once, for the loading screen). `supported` turns false when the mesh placement moves with the
 * pose (the GPU path cannot express it); members of such a body stay skinned.
 */
export const createCrowdBake = ({ clips, rig, template }: CrowdBakeOptions) => {
  const ranges = new Map<string, CrowdClipRange>();
  let totalRows = 0;
  for (const clip of clips) {
    const frames = crowdClipFrames(clip.duration);
    ranges.set(clip.name, { duration: clip.duration, frames, start: totalRows });
    totalRows += frames;
  }
  const data = new Float32Array(totalRows * FLOATS_PER_ROW);
  const texelData = new Int16Array(totalRows * FLOATS_PER_ROW);
  const texture = new DataTexture(texelData, CROWD_BAKE_COLUMNS, totalRows, RGBAIntegerFormat, ShortType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.name = "crowd_bones";

  rig.position.set(0, 0, 0);
  rig.quaternion.identity();
  rig.scale.set(1, 1, 1);
  rig.updateMatrixWorld(true);
  const rest = captureRest(rig);
  const skeleton = skeletonOf(rig);
  const mixer = new AnimationMixer(rig);
  const parent = template.parentName ? rig.getObjectByName(template.parentName) ?? rig : rig;
  const parentRest = parent.matrixWorld.clone();
  const meshWorld = new Matrix4().multiplyMatrices(parentRest, template.local);
  /** meshWorld x bindInverse: the mesh side of every skinning matrix. */
  const left = new Matrix4().multiplyMatrices(meshWorld, template.bindMatrixInverse);
  const crowdBones = CROWD_JOINTS.map(name => skeleton?.bones.find(bone => bone.name === name));
  /** boneInverse x bind per crowd joint: the bone side of its skinning matrix. */
  const rights = crowdBones.map(bone => {
    const index = bone ? skeleton!.bones.indexOf(bone) : -1;
    if (index < 0) return new Matrix4();
    return new Matrix4().multiplyMatrices(skeleton!.boneInverses[index]!, template.bindMatrix);
  });
  /** Inverses that turn a baked skinning matrix back into the bone's world matrix (`poseCrowdBones`). */
  const placement = new Matrix4().multiplyMatrices(template.bindMatrix, meshWorld.clone().invert());
  const boneSides = rights.map(right => right.clone().invert());
  let supported = !!skeleton && crowdBones.every(Boolean);
  let clipIndex = 0;
  let frame = 0;
  let disposed = false;
  let currentClip: AnimationClip | undefined;

  const beginClip = (clip: AnimationClip) => {
    restoreRest(rest);
    mixer.stopAllAction();
    mixer.clipAction(clip).play();
    currentClip = clip;
  };

  const sampleRow = (row: number, time: number) => {
    mixer.setTime(time);
    rig.updateMatrixWorld(true);
    if (parent !== rig && !parent.matrixWorld.equals(parentRest)) supported = false;
    const offset = row * FLOATS_PER_ROW;
    for (let joint = 0; joint < crowdBones.length; joint++) {
      scratch.multiplyMatrices(left, crowdBones[joint]!.matrixWorld).multiply(rights[joint]!);
      writeJoint(data, texelData, offset + joint * FLOATS_PER_JOINT, scratch);
    }
  };

  const finishRig = () => {
    mixer.stopAllAction();
    mixer.uncacheRoot(rig);
    rig.traverse(node => { if (node instanceof SkinnedMesh) node.skeleton.dispose(); });
    texture.needsUpdate = true;
  };

  /** Bakes one more row; false once every clip is done. */
  const bakeNext = () => {
    const clip = clips[clipIndex];
    if (!clip) return false;
    if (currentClip !== clip) beginClip(clip);
    const range = ranges.get(clip.name)!;
    const time = Math.min(frame / CROWD_BAKE_FPS, Math.max(0, clip.duration - END_EPSILON));
    sampleRow(range.start + frame, time);
    frame++;
    if (frame < range.frames) return true;
    frame = 0;
    clipIndex++;
    if (clipIndex >= clips.length) finishRig();
    return clipIndex < clips.length;
  };

  const ready = () => clipIndex >= clips.length;

  /** Mixes the rows of `pose` for one joint into `jointBlock` (frame-interpolated like the shader). */
  const blendJoint = (joint: number, pose: CrowdPoseRows) => {
    const base = joint * FLOATS_PER_JOINT;
    const accumulate = (row: number, weight: number) => {
      const first = Math.floor(row), fraction = row - first;
      const from = first * FLOATS_PER_ROW + base, to = from + FLOATS_PER_ROW;
      for (let index = 0; index < FLOATS_PER_JOINT; index++)
        jointBlock[index]! += weight * (data[from + index]! * (1 - fraction) + data[to + index]! * fraction);
    };
    jointBlock.fill(0);
    const current = 1 - pose.previousWeight;
    accumulate(pose.rowA, current * (1 - pose.mix));
    if (pose.mix > 0) accumulate(pose.rowB, current * pose.mix);
    if (pose.previousWeight > 0) accumulate(pose.previousRow, pose.previousWeight);
  };

  return {
    data,
    ranges,
    texture,
    /** The clip's rows, once baked (every clip of a ready bake). */
    range: (clip: string) => (ready() ? ranges.get(clip) : undefined),
    ready,
    isSupported: () => supported && !disposed,
    /** Bakes rows until `budgetMs` of wall time is spent; true when complete. */
    step: (budgetMs: number) => {
      if (disposed) return false;
      const deadline = performance.now() + budgetMs;
      while (!ready() && performance.now() < deadline) bakeNext();
      return ready();
    },
    finish: () => {
      if (disposed) return;
      while (bakeNext()) { /* every row now */ }
    },
    /**
     * Writes the world matrices of an actor's crowd bones (`bones[row]`, by crowd joint row) from
     * `pose`, for the props and headwear parented to them. `rootWorld` is the actor root's world
     * matrix; the bones must keep `matrixWorldAutoUpdate` off while the GPU draws the body.
     */
    poseCrowdBones: (bones: readonly (Object3D | undefined)[], rootWorld: Matrix4, pose: CrowdPoseRows) => {
      rootPlacement.multiplyMatrices(rootWorld, placement);
      for (let joint = 0; joint < bones.length; joint++) {
        const bone = bones[joint];
        if (!bone) continue;
        blendJoint(joint, pose);
        readJoint(jointBlock, scratch);
        bone.matrixWorld.multiplyMatrices(rootPlacement, scratch).multiply(boneSides[joint]!);
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (!ready()) finishRig();
      texture.dispose();
    }
  };
};

export type CrowdBake = ReturnType<typeof createCrowdBake>;
