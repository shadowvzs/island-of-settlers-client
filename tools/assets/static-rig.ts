import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";

import { type RegionWeight, turnRegion, weighRegion } from "../../src/render-common/critters/model/critter-pose";
import { type GlbFile, readAccessor, readGlb } from "../../src/render-common/glb-reader";
import type { PropMesh, Vec3 } from "../../src/render-common/props/mesh-builder";
import { writeGlb } from "./glb-writer";
import { readSkinSource, skinPose, type SkinSource } from "./gltf-skin-sampler";

/**
 * Rigs a static source mesh offline (wolf, boar, seal, heron): every primitive merged in scene
 * space (node transforms applied), a synthetic skeleton (bones at rest positions, no rest
 * rotation) and per vertex weights, wrapped as a skinned glTF in memory, so the shared
 * skinned-critter builder poses it by bone offsets (one empty "rest" clip).
 */

/** The static mesh in scene space, with what the texture bake needs. */
export interface StaticMesh {
  file: GlbFile;
  indices: Uint32Array;
  /** Material index of each vertex. */
  materials: Int32Array;
  /** Source mesh index of each vertex (a family file holds several animals). */
  meshes: Int32Array;
  normals: Float32Array;
  positions: Float32Array;
  uvs: Float32Array;
}

/** A bone of the synthetic skeleton: its head in scene space and its parent's name. */
export interface RigBone {
  at: Vec3;
  name: string;
  parent?: string;
}

/** Joints (bone indices) and weights, four per vertex. */
export interface RigWeights {
  joints: Uint8Array;
  weights: Float32Array;
}

const getNodeMatrix = (node: any) => {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(
    new Vector3(...(node.translation ?? [0, 0, 0])),
    new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
    new Vector3(...(node.scale ?? [1, 1, 1]))
  );
};

interface MeshParts {
  indices: number[];
  materials: number[];
  meshes: number[];
  normals: number[];
  positions: number[];
  uvs: number[];
}

const addPrimitive = (file: GlbFile, primitive: any, world: Matrix4, mesh: number, parts: MeshParts) => {
  const { attributes } = primitive;
  const first = parts.positions.length / 3;
  const positions = readAccessor(file, attributes.POSITION);
  const normals = readAccessor(file, attributes.NORMAL);
  const uvs = attributes.TEXCOORD_0 === undefined ? null : readAccessor(file, attributes.TEXCOORD_0);
  const normalMatrix = new Matrix3().getNormalMatrix(world);
  const point = new Vector3();
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    parts.positions.push(...point.fromArray(positions, vertex * 3).applyMatrix4(world).toArray());
    parts.normals.push(...point.fromArray(normals, vertex * 3).applyMatrix3(normalMatrix).normalize().toArray());
    parts.uvs.push(uvs ? uvs[vertex * 2]! : 0, uvs ? uvs[vertex * 2 + 1]! : 0);
    parts.materials.push(primitive.material ?? -1);
    parts.meshes.push(mesh);
  }
  const indices = primitive.indices === undefined
    ? Array.from({ length: positions.length / 3 }, (_, index) => index)
    : readAccessor(file, primitive.indices);
  for (const index of indices) parts.indices.push(first + index);
};

/** Every mesh primitive of the scene (or of the meshes `include` accepts) in scene space. */
export const readStaticMesh = (file: GlbFile, include: (mesh: number) => boolean = () => true): StaticMesh => {
  const json = file.json as any;
  const parts: MeshParts = { indices: [], materials: [], meshes: [], normals: [], positions: [], uvs: [] };
  const visit = (index: number, parent: Matrix4) => {
    const node = json.nodes[index];
    const world = getNodeMatrix(node).premultiply(parent);
    if (node.mesh !== undefined && include(node.mesh)) {
      for (const primitive of json.meshes[node.mesh].primitives) addPrimitive(file, primitive, world, node.mesh, parts);
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of json.scenes[json.scene ?? 0].nodes as number[]) visit(root, new Matrix4());
  return {
    file,
    indices: Uint32Array.from(parts.indices),
    materials: Int32Array.from(parts.materials),
    meshes: Int32Array.from(parts.meshes),
    normals: Float32Array.from(parts.normals),
    positions: Float32Array.from(parts.positions),
    uvs: Float32Array.from(parts.uvs)
  };
};

/** Reads a source GLB file's bytes. */
export const readGlbBytes = (bytes: Buffer) =>
  readGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

/** Keeps only the vertices of `keep` (and the triangles wholly on them), remapped. */
export const selectVertices = (mesh: StaticMesh, keep: (vertex: number) => boolean): StaticMesh => {
  const count = mesh.positions.length / 3;
  const remap = new Int32Array(count).fill(-1);
  let kept = 0;
  for (let vertex = 0; vertex < count; vertex += 1) if (keep(vertex)) remap[vertex] = kept++;
  const pick = (values: ArrayLike<number>, size: number, Type: Float32ArrayConstructor | Int32ArrayConstructor) => {
    const out = new Type(kept * size);
    for (let vertex = 0; vertex < count; vertex += 1) {
      if (remap[vertex]! < 0) continue;
      for (let item = 0; item < size; item += 1) out[remap[vertex]! * size + item] = values[vertex * size + item]!;
    }
    return out;
  };
  const indices: number[] = [];
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const corners = [mesh.indices[index]!, mesh.indices[index + 1]!, mesh.indices[index + 2]!];
    if (corners.every((vertex) => remap[vertex]! >= 0)) indices.push(...corners.map((vertex) => remap[vertex]!));
  }
  return {
    file: mesh.file,
    indices: Uint32Array.from(indices),
    materials: pick(mesh.materials, 1, Int32Array) as Int32Array,
    meshes: pick(mesh.meshes, 1, Int32Array) as Int32Array,
    normals: pick(mesh.normals, 3, Float32Array) as Float32Array,
    positions: pick(mesh.positions, 3, Float32Array) as Float32Array,
    uvs: pick(mesh.uvs, 2, Float32Array) as Float32Array
  };
};

/**
 * Appends a copy of the triangles whose corners pass `select` (on copies of their vertices):
 * a part that is rigged apart from its original (a folded wing copied into a spreadable one).
 */
export const duplicateTriangles = (mesh: StaticMesh, select: (corners: number[]) => boolean): StaticMesh => {
  const copies = new Map<number, number>();
  const count = mesh.positions.length / 3;
  const indices = Array.from(mesh.indices);
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const corners = [mesh.indices[index]!, mesh.indices[index + 1]!, mesh.indices[index + 2]!];
    if (!select(corners)) continue;
    for (const vertex of corners) {
      if (!copies.has(vertex)) copies.set(vertex, count + copies.size);
      indices.push(copies.get(vertex)!);
    }
  }
  const order = [...copies.keys()];
  const extend = <T extends Float32Array | Int32Array>(values: T, size: number): T => {
    const out = new (values.constructor as new (length: number) => T)(values.length + order.length * size);
    out.set(values);
    order.forEach((vertex, copy) => out.set(values.subarray(vertex * size, vertex * size + size), (count + copy) * size));
    return out;
  };
  return {
    file: mesh.file,
    indices: Uint32Array.from(indices),
    materials: extend(mesh.materials, 1),
    meshes: extend(mesh.meshes, 1),
    normals: extend(mesh.normals, 3),
    positions: extend(mesh.positions, 3),
    uvs: extend(mesh.uvs, 2)
  };
};

/** Keeps the triangles whose corners pass `keep` (cut-out hair cards dropped, ...). */
export const filterTriangles = (mesh: StaticMesh, keep: (corners: number[]) => boolean) => {
  const indices: number[] = [];
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const corners = [mesh.indices[index]!, mesh.indices[index + 1]!, mesh.indices[index + 2]!];
    if (keep(corners)) indices.push(...corners);
  }
  return { ...mesh, indices: Uint32Array.from(indices) };
};

/**
 * Stands a mesh facing +z: turned by `yaw` about y (radians, + from z towards x), its
 * horizontal middle at the origin (then moved sideways by `shiftX`, centring its legs) and its
 * lowest point at y 0.
 */
export const placeMesh = (mesh: StaticMesh, yaw: number, shiftX = 0) => {
  const turn = new Matrix4().makeRotationY(yaw);
  const point = new Vector3();
  const low = new Vector3(Infinity, Infinity, Infinity);
  const high = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let index = 0; index < mesh.positions.length; index += 3) {
    point.fromArray(mesh.positions, index).applyMatrix4(turn).toArray(mesh.positions, index);
    point.fromArray(mesh.normals, index).applyMatrix4(turn).toArray(mesh.normals, index);
    low.min(point.fromArray(mesh.positions, index));
    high.max(point);
  }
  const shift = [shiftX - (low.x + high.x) / 2, -low.y, -(low.z + high.z) / 2];
  for (let index = 0; index < mesh.positions.length; index += 1) mesh.positions[index]! += shift[index % 3]!;
};

/** The mesh in a pose of its rig (a new rest shape: a head turned straight, ...). */
export const bakePose = (mesh: StaticMesh, source: SkinSource, offsets: Record<string, Quaternion>) => {
  const pose = skinPose(source, 0, 0, offsets);
  return { ...mesh, normals: pose.normals, positions: pose.positions };
};

/**
 * Turns a soft region of the static mesh (a weight per vertex from `region`) about `axis`
 * through `pivot`: straightens a head turned in the source before it is rigged.
 */
export const turnSoftly = (mesh: StaticMesh, pivot: Vec3, axis: Vec3, angle: number, region: RegionWeight) => {
  const posed = mesh as unknown as PropMesh;
  turnRegion(posed, weighRegion(posed, region), pivot, axis, angle);
};

/** Moves every vertex (and its normal stays) by a function of its position (reshaping). */
export const reshapeMesh = (mesh: StaticMesh, move: (point: Vec3) => Vec3) => {
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const moved = move([mesh.positions[index]!, mesh.positions[index + 1]!, mesh.positions[index + 2]!]);
    mesh.positions.set(moved, index);
  }
};

/**
 * Distance of a point from a segment, less `radius` along its span (a thick segment); past an
 * end the radius fades within half of it, so a trunk does not reach into the neck or tail.
 */
const distanceToSegment = (point: Vec3, from: Vec3, to: Vec3, radius = 0) => {
  const segment = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const length = segment[0]! ** 2 + segment[1]! ** 2 + segment[2]! ** 2;
  const offset = [point[0] - from[0], point[1] - from[1], point[2] - from[2]];
  const raw = length > 0 ? (offset[0]! * segment[0]! + offset[1]! * segment[1]! + offset[2]! * segment[2]!) / length : 0;
  const share = Math.min(1, Math.max(0, raw));
  const past = Math.abs(raw - share) * Math.sqrt(length);
  const thickness = radius > 0 ? radius * Math.max(0, 1 - past / (radius * 0.5)) : 0;
  const distance = Math.hypot(offset[0]! - segment[0]! * share, offset[1]! - segment[1]! * share, offset[2]! - segment[2]! * share);
  return Math.max(0, distance - thickness);
};

/** A bone's segment: its head to its (first) child's head, or `tip` for a chain end. */
export interface WeightBone {
  /** Which vertices this bone may move (region gate); default every vertex. */
  allow?: (point: Vec3) => number;
  bone: number;
  from: Vec3;
  /** A thick segment (the trunk): the distance is taken from its surface. */
  radius?: number;
  to: Vec3;
}

/**
 * Skin weights by distance to the bone segments (inverse power falloff), gated per region, the
 * four strongest normalised. `power` sharpens the joints (higher: stiffer segments).
 */
export const weighBySegments = (positions: Float32Array, bones: WeightBone[], power = 5): RigWeights => {
  const count = positions.length / 3;
  const joints = new Uint8Array(count * 4);
  const weights = new Float32Array(count * 4);
  const scores = new Float32Array(bones.length);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const point: Vec3 = [positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!];
    bones.forEach((bone, index) => {
      const gate = bone.allow ? bone.allow(point) : 1;
      const distance = distanceToSegment(point, bone.from, bone.to, bone.radius);
      scores[index] = gate <= 0 ? 0 : gate / (distance + 1e-3) ** power;
    });
    const order = Array.from(scores.keys()).sort((a, b) => scores[b]! - scores[a]!).slice(0, 4);
    const total = order.reduce((sum, index) => sum + scores[index]!, 0) || 1;
    order.forEach((index, slot) => {
      joints[vertex * 4 + slot] = bones[index]!.bone;
      weights[vertex * 4 + slot] = scores[index]! / total;
    });
  }
  return { joints, weights };
};

/** The static mesh rigged with `bones` and `rig` weights, as a skin source posed by offsets. */
export const createRiggedSource = (mesh: StaticMesh, bones: RigBone[], rig: RigWeights): SkinSource => {
  const index = new Map(bones.map((bone, bone_) => [bone.name, bone_]));
  const nodes = bones.map((bone) => {
    const parent = bone.parent === undefined ? undefined : bones[index.get(bone.parent)!]!;
    const origin = parent?.at ?? [0, 0, 0];
    return {
      children: [] as number[],
      name: bone.name,
      translation: [bone.at[0] - origin[0], bone.at[1] - origin[1], bone.at[2] - origin[2]]
    };
  });
  const roots: number[] = [];
  bones.forEach((bone, bone_) => {
    if (bone.parent === undefined) roots.push(bone_ + 1);
    else nodes[index.get(bone.parent)!]!.children.push(bone_ + 1);
  });
  const inverse = bones.flatMap((bone) => new Matrix4().makeTranslation(-bone.at[0], -bone.at[1], -bone.at[2]).toArray());
  const json = {
    animations: [{ channels: [], name: "rest", samplers: [] }],
    asset: { version: "2.0" },
    meshes: [{ primitives: [{ attributes: { JOINTS_0: 3, NORMAL: 1, POSITION: 0, TEXCOORD_0: 2, WEIGHTS_0: 4 }, indices: 5 }] }],
    nodes: [{ mesh: 0, name: "mesh", skin: 0 }, ...nodes],
    scene: 0,
    scenes: [{ nodes: [0, ...roots] }],
    skins: [{ inverseBindMatrices: 6, joints: bones.map((_, bone) => bone + 1) }]
  };
  const bytes = writeGlb(json, [
    { component: "float", type: "VEC3", values: mesh.positions },
    { component: "float", type: "VEC3", values: mesh.normals },
    { component: "float", type: "VEC2", values: mesh.uvs },
    { component: "unsignedByte", type: "VEC4", values: rig.joints },
    { component: "float", type: "VEC4", values: rig.weights },
    { component: "unsignedShort", type: "SCALAR", values: mesh.indices },
    { component: "float", type: "SCALAR", values: inverse }
  ]);
  const source = readSkinSource(readGlb(bytes.buffer as ArrayBuffer));
  source.clips[0] = { duration: 0, name: "rest" };
  return source;
};

/** A bone offset: a rotation of `angle` radians about a scene space `axis`. */
export const turn = (axis: Vec3, angle: number) =>
  new Quaternion().setFromAxisAngle(new Vector3(...axis).normalize(), angle);
