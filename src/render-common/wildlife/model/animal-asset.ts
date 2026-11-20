import { type GlbFile, type GlbImage,readAccessor, readGlb, readTextureImage } from "../../glb-reader";
import type { PropMesh, Vec3 } from "../../props/mesh-builder";
import { ANIMAL_ASSET_SPECS, type AnimalAssetSpec } from "./animal-asset-specs";
import { type AnimalModel,JOINT, JOINT_COUNT, PART } from "./animal-rig";
import { computeSpotRegion } from "./coat-spots";

/** Levels of detail stored in every animal GLB (meshes lod0, lod1, lod2). */
export const MODEL_LOD = { close: 0, high: 1, low: 2 } as const;
export type ModelLod = (typeof MODEL_LOD)[keyof typeof MODEL_LOD];
const LOD_NAMES = ["lod0", "lod1", "lod2"] as const;

/** Surfaces by material name (asset pipeline convention), with their shading. */
const SURFACE = { fur: 0, antler: 1, eye: 2 } as const;
const SURFACE_NAMES: Record<string, number> = SURFACE;
const SURFACE_ROUGHNESS = [0.85, 0.6, 0.12] as const;

/** Fur strokes (direction in rest space, stroke length) by part: back and down, legs down. */
const FUR_FLOW: Record<number, readonly [number, number, number, number]> = {
  [PART.head]: [-1, -0.2, 0, 0.6],
  [PART.neck]: [-0.4, -1, 0, 1],
  [PART.earLeft]: [0, 1, 0, 0.5],
  [PART.earRight]: [0, 1, 0, 0.5],
  [PART.tail]: [-1, -0.5, 0, 0.8]
};
const BODY_FLOW = [-1, -0.35, 0, 1] as const;
const LEG_FLOW = [0, -1, 0, 0.6] as const;
const LEG_PARTS = new Set<number>([
  PART.frontLeftUpper,
  PART.frontLeftLower,
  PART.frontRightUpper,
  PART.frontRightLower,
  PART.hindLeftUpper,
  PART.hindLeftLower,
  PART.hindRightUpper,
  PART.hindRightLower
]);

/** A loaded animal: the adult rest model per level of detail and its texture atlases. */
export interface AnimalAsset {
  albedo: GlbImage;
  lods: AnimalModel[];
  normal: GlbImage | null;
}

type GltfPoint = readonly [number, number, number];

/** glTF (y up, the animal facing +z) to the rig's space (x forward, y up, z left), scaled. */
const toRig = (point: GltfPoint, scale: number, centreX: number): Vec3 => [
  point[2] * scale - centreX,
  point[1] * scale,
  -point[0] * scale
];

/** Bone head positions (glTF space) from the inverse bind matrices (rigid transforms). */
const readBoneHeads = (file: GlbFile) => {
  const skin = file.json.skins![0]!;
  const matrices = readAccessor(file, skin.inverseBindMatrices);
  const heads = new Map<string, GltfPoint>();
  skin.joints.forEach((node, index) => {
    const m = matrices.subarray(index * 16, index * 16 + 16);
    const [tx, ty, tz] = [m[12]!, m[13]!, m[14]!];
    heads.set(file.json.nodes[node]!.name ?? `${node}`, [
      -(m[0]! * tx + m[1]! * ty + m[2]! * tz),
      -(m[4]! * tx + m[5]! * ty + m[6]! * tz),
      -(m[8]! * tx + m[9]! * ty + m[10]! * tz)
    ]);
  });
  return { heads, names: skin.joints.map((node) => file.json.nodes[node]!.name ?? `${node}`) };
};

const getBone = (heads: Map<string, GltfPoint>, name: string) => {
  const head = heads.get(name);
  if (!head) throw new Error(`animal model without bone ${name}`);
  return head;
};

/** Joint pivots in rig space; the root sits between the four leg tops at their height. */
const createJoints = (spec: AnimalAssetSpec, heads: Map<string, GltfPoint>) => {
  const hips = [
    spec.joints.frontLeftHip,
    spec.joints.frontRightHip,
    spec.joints.hindLeftHip,
    spec.joints.hindRightHip
  ].map((name) => toRig(getBone(heads, name), spec.scale, 0));
  const centreX = hips.reduce((sum, hip) => sum + hip[0], 0) / hips.length;
  const rootY = hips.reduce((sum, hip) => sum + hip[1], 0) / hips.length;
  const joints: Vec3[] = Array.from({ length: JOINT_COUNT }, (): Vec3 => [0, rootY, 0]);
  for (const [joint, bone] of Object.entries(spec.joints)) {
    joints[JOINT[joint as keyof typeof JOINT]] = toRig(getBone(heads, bone), spec.scale, centreX);
  }
  return { centreX, joints };
};

/** Growing vertex arrays of one level of detail. */
const createBuffers = () => ({
  blendParts: [] as number[],
  blendWeights: [] as number[],
  colors: [] as number[],
  fur: [] as number[],
  indices: [] as number[],
  normals: [] as number[],
  parts: [] as number[],
  positions: [] as number[],
  roughness: [] as number[],
  uvs: [] as number[]
});
type Buffers = ReturnType<typeof createBuffers>;

/** The two parts with the most skin weight (the second's share as the blend weight). */
const pickParts = (partOf: number[], joints: Float32Array, weights: Float32Array, at: number) => {
  const totals = new Float32Array(16);
  for (let influence = 0; influence < 4; influence += 1) {
    totals[partOf[joints[at + influence]!]!]! += weights[at + influence]!;
  }
  let first = PART.body as number;
  let second = PART.body as number;
  for (let part = 0; part < totals.length; part += 1) {
    if (totals[part]! > totals[first]!) {
      second = first;
      first = part;
    } else if (part !== first && totals[part]! > totals[second]!) second = part;
  }
  const sum = totals[first]! + totals[second]!;
  const weight = second === first || sum <= 0 ? 0 : totals[second]! / sum;
  return { first, second, weight };
};

const getFurFlow = (part: number) => {
  if (FUR_FLOW[part]) return FUR_FLOW[part];
  return LEG_PARTS.has(part) ? LEG_FLOW : BODY_FLOW;
};

interface PrimitiveContext {
  centreX: number;
  file: GlbFile;
  partOf: number[];
  spec: AnimalAssetSpec;
}

const addPrimitive = (
  target: Buffers,
  context: PrimitiveContext,
  primitive: GlbFile["json"]["meshes"][number]["primitives"][number]
) => {
  const { centreX, file, partOf, spec } = context;
  const material = file.json.materials?.[primitive.material ?? -1];
  const surface = SURFACE_NAMES[material?.name ?? "fur"] ?? SURFACE.fur;
  const tint = material?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1];
  const positions = readAccessor(file, primitive.attributes.POSITION!);
  const normals = readAccessor(file, primitive.attributes.NORMAL!);
  const uvIndex = primitive.attributes.TEXCOORD_0;
  const uvs = uvIndex === undefined ? null : readAccessor(file, uvIndex);
  const joints = readAccessor(file, primitive.attributes.JOINTS_0!);
  const weights = readAccessor(file, primitive.attributes.WEIGHTS_0!);
  const first = target.positions.length / 3;
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const at = vertex * 3;
    const point: GltfPoint = [positions[at]!, positions[at + 1]!, positions[at + 2]!];
    target.positions.push(...toRig(point, spec.scale, centreX));
    target.normals.push(normals[at + 2]!, normals[at + 1]!, -normals[at]!);
    const parts = pickParts(partOf, joints, weights, vertex * 4);
    const antler = surface === SURFACE.antler;
    target.parts.push(antler ? PART.antler : parts.first);
    target.blendParts.push(parts.second);
    target.blendWeights.push(antler ? 0 : parts.weight);
    const textured = uvs !== null && surface !== SURFACE.eye;
    target.uvs.push(textured ? uvs[vertex * 2]! : -1, textured ? uvs[vertex * 2 + 1]! : -1);
    target.colors.push(tint[0]!, tint[1]!, tint[2]!);
    const flow = getFurFlow(parts.first);
    const furred = surface === SURFACE.fur;
    target.fur.push(flow[0], flow[1], flow[2], furred ? flow[3] : 0);
    target.roughness.push(SURFACE_ROUGHNESS[surface as 0 | 1 | 2]);
  }
  for (const index of readAccessor(file, primitive.indices)) target.indices.push(first + index);
};

const toMesh = (buffers: Buffers): PropMesh => {
  const positions = Float32Array.from(buffers.positions);
  let height = 0;
  let radius = 0;
  for (let index = 0; index < positions.length; index += 3) {
    height = Math.max(height, positions[index + 1]!);
    radius = Math.max(radius, Math.hypot(positions[index]!, positions[index + 2]!));
  }
  return {
    colors: Float32Array.from(buffers.colors),
    height,
    indices: Uint16Array.from(buffers.indices),
    normals: Float32Array.from(buffers.normals),
    positions,
    radius,
    uvs: Float32Array.from(buffers.uvs),
    wind: new Float32Array((positions.length / 3) * 2)
  };
};

const findMesh = (file: GlbFile, lod: number) =>
  file.json.meshes.find((mesh) => mesh.name === LOD_NAMES[lod]) ?? file.json.meshes[0]!;

/**
 * Parses an animal GLB (tools/assets pipeline) into rig models: every level of detail in rest
 * pose and island units, two rig parts per vertex from the skin weights, joints from the bone
 * heads, surfaces from the material names.
 */
export const parseAnimalAsset = (species: number, buffer: ArrayBuffer): AnimalAsset => {
  const spec = ANIMAL_ASSET_SPECS[species]!;
  const file = readGlb(buffer);
  const { heads, names } = readBoneHeads(file);
  const { centreX, joints } = createJoints(spec, heads);
  const partOf = names.map((name) => spec.parts[name] ?? PART.body);
  const lods = LOD_NAMES.map((_, lod) => {
    const buffers = createBuffers();
    for (const primitive of findMesh(file, lod).primitives) {
      addPrimitive(buffers, { centreX, file, partOf, spec }, primitive);
    }
    const model: AnimalModel = {
      antlerPivot: joints[JOINT.head]!,
      blendParts: Float32Array.from(buffers.blendParts),
      blendWeights: Float32Array.from(buffers.blendWeights),
      fur: Float32Array.from(buffers.fur),
      joints,
      mesh: toMesh(buffers),
      parts: Float32Array.from(buffers.parts),
      roughness: Float32Array.from(buffers.roughness),
      spotRegion: new Float32Array(0),
      spots: 0,
      warmth: 0
    };
    return { ...model, spotRegion: computeSpotRegion(model) };
  });
  const material = file.json.materials?.find((item) => item.pbrMetallicRoughness?.baseColorTexture);
  const albedoIndex = material!.pbrMetallicRoughness!.baseColorTexture!.index;
  const normalIndex = material?.normalTexture?.index;
  return {
    albedo: readTextureImage(file, albedoIndex),
    lods,
    normal: normalIndex === undefined ? null : readTextureImage(file, normalIndex)
  };
};
