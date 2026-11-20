import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";

import { type GlbFile, readAccessor } from "../../src/render-common/glb-reader";

/**
 * CPU skinning of a skinned glTF (offline asset tools): samples an animation clip at a time,
 * poses extra bone rotations on top, and returns the skinned vertex positions and normals of the
 * first skinned mesh primitive in model (scene) space.
 */

interface NodeRest {
  children: number[];
  rotation: Quaternion;
  scale: Vector3;
  translation: Vector3;
}

export interface SkinSource {
  /** Bone node index by joint name. */
  boneByName: Map<string, number>;
  /** Material index of each vertex (the primitive it came from). */
  materials: Int32Array;
  clips: { duration: number; name: string }[];
  file: GlbFile;
  indices: Uint32Array;
  joints: Float32Array;
  normals: Float32Array;
  positions: Float32Array;
  uvs: Float32Array;
  weights: Float32Array;
}

const readNodes = (file: GlbFile): NodeRest[] =>
  (file.json.nodes as any[]).map((node) => ({
    children: node.children ?? [],
    rotation: new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
    scale: new Vector3(...(node.scale ?? [1, 1, 1])),
    translation: new Vector3(...(node.translation ?? [0, 0, 0]))
  }));

/** Every skinned primitive of the first skin merged into one vertex and index list. */
const readSkinnedPrimitives = (file: GlbFile) => {
  const json = file.json as any;
  const meshes = new Set<number>(
    (json.nodes as any[]).filter((node) => node.mesh !== undefined && node.skin === 0).map((node) => node.mesh)
  );
  const parts = { indices: [] as number[], joints: [] as number[], materials: [] as number[], normals: [] as number[],
    positions: [] as number[], uvs: [] as number[], weights: [] as number[] };
  for (const mesh of meshes) {
    for (const primitive of json.meshes[mesh].primitives) {
      const { attributes } = primitive;
      const first = parts.positions.length / 3;
      const positions = readAccessor(file, attributes.POSITION);
      parts.positions.push(...positions);
      parts.normals.push(...readAccessor(file, attributes.NORMAL));
      parts.joints.push(...readAccessor(file, attributes.JOINTS_0));
      parts.weights.push(...readAccessor(file, attributes.WEIGHTS_0));
      const uvs = attributes.TEXCOORD_0 === undefined ? null : readAccessor(file, attributes.TEXCOORD_0);
      for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
        parts.uvs.push(uvs ? uvs[vertex * 2]! : 0, uvs ? uvs[vertex * 2 + 1]! : 0);
        parts.materials.push(primitive.material ?? -1);
      }
      for (const index of readAccessor(file, primitive.indices)) parts.indices.push(first + index);
    }
  }
  return parts;
};

/** The skinned mesh (every primitive of the first skin), its rig and its clips. */
export const readSkinSource = (file: GlbFile): SkinSource => {
  const json = file.json as any;
  const parts = readSkinnedPrimitives(file);
  const skin = json.skins[0];
  const boneByName = new Map<string, number>();
  for (const node of skin.joints as number[]) boneByName.set(json.nodes[node].name, node);
  const clips = (json.animations as any[]).map((animation) => ({
    duration: Math.max(
      ...animation.channels.map((channel: any) =>
        json.accessors[animation.samplers[channel.sampler].input].max?.[0] ?? 0
      )
    ),
    name: animation.name as string
  }));
  return {
    boneByName,
    clips,
    file,
    indices: Uint32Array.from(parts.indices),
    joints: Float32Array.from(parts.joints),
    materials: Int32Array.from(parts.materials),
    normals: Float32Array.from(parts.normals),
    positions: Float32Array.from(parts.positions),
    uvs: Float32Array.from(parts.uvs),
    weights: Float32Array.from(parts.weights)
  };
};

/** Linear (slerp for rotations) sample of one animation channel at `time`. */
const sampleChannel = (file: GlbFile, sampler: any, size: number, time: number) => {
  const input = readAccessor(file, sampler.input);
  const output = readAccessor(file, sampler.output);
  let next = input.findIndex((value) => value >= time);
  if (next < 0) next = input.length - 1;
  const previous = Math.max(0, next - 1);
  const span = input[next]! - input[previous]!;
  const t = span > 0 ? Math.min(1, Math.max(0, (time - input[previous]!) / span)) : 0;
  const a = Array.from(output.subarray(previous * size, previous * size + size));
  const b = Array.from(output.subarray(next * size, next * size + size));
  if (size === 4) return new Quaternion(...a).slerp(new Quaternion(...b), t).toArray();
  return a.map((value, index) => value + (b[index]! - value) * t);
};

/** Extra bone rotation applied after the clip (local space), by bone name. */
export type BoneOffsets = Record<string, Quaternion>;
/** Extra bone scale (local axes) applied after the clip, by bone name (a spread wing). */
export type BoneScales = Record<string, Vector3>;

/** World matrices of every node with clip `clip` at `time` (null: bind pose), offsets and scales. */
const poseNodes = (
  source: SkinSource,
  clip: number | null,
  time: number,
  offsets: BoneOffsets,
  scales: BoneScales
) => {
  const json = source.file.json as any;
  const nodes = readNodes(source.file);
  if (clip !== null) {
    const animation = json.animations[clip];
    for (const channel of animation.channels) {
      const node = nodes[channel.target.node]!;
      const path = channel.target.path as string;
      const size = path === "rotation" ? 4 : 3;
      const value = sampleChannel(source.file, animation.samplers[channel.sampler], size, time);
      if (path === "rotation") node.rotation.fromArray(value);
      else if (path === "translation") node.translation.fromArray(value);
      else if (path === "scale") node.scale.fromArray(value);
    }
  }
  for (const [name, offset] of Object.entries(offsets)) {
    const index = source.boneByName.get(name);
    if (index !== undefined) nodes[index]!.rotation.multiply(offset);
  }
  for (const [name, scale] of Object.entries(scales)) {
    const index = source.boneByName.get(name);
    if (index !== undefined) nodes[index]!.scale.multiply(scale);
  }
  const world: Matrix4[] = nodes.map(() => new Matrix4());
  const visit = (index: number, parent: Matrix4) => {
    const node = nodes[index]!;
    world[index]!.compose(node.translation, node.rotation, node.scale).premultiply(parent);
    for (const child of node.children) visit(child, world[index]!);
  };
  for (const root of json.scenes[0].nodes as number[]) visit(root, new Matrix4());
  return world;
};

/** Skinned positions and normals (scene space) at a clip time with bone offsets and scales. */
export const skinPose = (
  source: SkinSource,
  clip: number | null,
  time: number,
  offsets: BoneOffsets = {},
  scales: BoneScales = {}
) => {
  const json = source.file.json as any;
  const world = poseNodes(source, clip, time, offsets, scales);
  const skin = json.skins[0];
  const inverse = readAccessor(source.file, skin.inverseBindMatrices);
  const skinning = (skin.joints as number[]).map((node, joint) =>
    world[node]!.clone().multiply(new Matrix4().fromArray(inverse, joint * 16))
  );
  const count = source.positions.length / 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const point = new Vector3();
  const normal = new Vector3();
  const blended = new Matrix4();
  const normalMatrix = new Matrix3();
  for (let vertex = 0; vertex < count; vertex += 1) {
    const elements = new Array<number>(16).fill(0);
    for (let influence = 0; influence < 4; influence += 1) {
      const weight = source.weights[vertex * 4 + influence]!;
      if (weight <= 0) continue;
      const matrix = skinning[source.joints[vertex * 4 + influence]!]!.elements;
      for (let element = 0; element < 16; element += 1) elements[element]! += matrix[element]! * weight;
    }
    blended.fromArray(elements);
    point.fromArray(source.positions, vertex * 3).applyMatrix4(blended).toArray(positions, vertex * 3);
    normal.fromArray(source.normals, vertex * 3).applyMatrix3(normalMatrix.getNormalMatrix(blended)).normalize()
      .toArray(normals, vertex * 3);
  }
  return { normals, positions, world };
};

/** World position of a bone (by name) in a pose's node matrices. */
export const getBonePosition = (source: SkinSource, world: Matrix4[], name: string) =>
  new Vector3().setFromMatrixPosition(world[source.boneByName.get(name)!]!);
