import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { SimplifyModifier } from "three/addons/modifiers/SimplifyModifier.js";

import { turnRegion } from "../../src/render-common/critters/model/critter-pose";
import type { PropMesh, Vec3 } from "../../src/render-common/props/mesh-builder";
import { writeGlb } from "./glb-writer";
import { type BoneOffsets, type BoneScales, getBonePosition, skinPose, type SkinSource } from "./gltf-skin-sampler";

/**
 * Shared offline builder of critters from skinned sources (chamois, bear, ...): clip frames
 * baked by CPU skinning into critter space (x forward, y up, z left, feet at y 0, island
 * units), head turns and a lying pose, summer and winter vertex colours, a High and a Minimal
 * index set over one compact vertex set, an optional part (horns) last, written as a GLB that
 * critters/model/skinned-critter.ts reads.
 */

export interface CritterFrameSpec {
  clip: number;
  /** Ground this frame on its own (a fall) instead of the standing feet. */
  ground?: boolean;
  /** Head turn (radians, + left) of the look region about the look pivot bone. */
  look?: number;
  offsets?: BoneOffsets;
  scales?: BoneScales;
  /** Lying: the legs fold flat under the trunk (see lieDown). */
  rest?: boolean;
  time: number;
  /** Swimming: the frame sinks this far (island units) and what is under the surface flattens onto it. */
  waterline?: number;
}

export interface SkinnedCritterBuild {
  coats: { summer: Float32Array; winter: Float32Array };
  copyright: string;
  /** Vertices of the trunk (the belly line of the built lying pose; only with `rest` frames). */
  isTrunk?: (vertex: number) => boolean;
  /** Head turn weights per vertex and the bone it turns about. */
  look: { pivot: string; weights: Float32Array };
  /** Share of the High triangles the Minimal set keeps, and of the source High keeps. */
  minimalShare: number;
  highShare?: number;
  name: string;
  /** Vertices of the optional part drawn last (the kid drops it), if any. */
  optional?: (vertex: number) => boolean;
  /** The source's forward axis (default +z, glTF convention). */
  forward?: Forward;
  /** A bone whose forward travel is removed (clips with root motion walk in place). */
  rootBone?: string;
  /** A bone at the origin of every frame (a bird in flight), instead of the standing feet. */
  originBone?: string;
  scale: number;
  /**
   * A pose the triangles are simplified in, not shipped: limbs held apart, so no coarse
   * triangle bridges a leg and the trunk (or a wing hidden in the standing frames is kept).
   */
  simplifyPose?: CritterFrameSpec;
  source: SkinSource;
  specs: CritterFrameSpec[];
  /** Output file (relative to the client package). */
  target: string;
  /** The clip (and time) that stands: its feet ground every frame. */
  standClip: number;
  standTime?: number;
  /** Winter coat thickness per source vertex (island units along the normal; a fuller ruff). */
  winterThickness?: Float32Array;
}

interface Frame {
  normals: Float32Array;
  positions: Float32Array;
}

/** Lying: what stays of the leg height (folded flat under the trunk) and how far in they tuck. */
const FOLDED_LEGS = 0.16;
const TUCK = 0.8;

/** Forward axis of a source (y is up in both). */
export type Forward = "x" | "z";

/** Source scene space (y up, facing +z or +x) to critter space, scaled. */
export const toCritter = (values: ArrayLike<number>, scale: number, forward: Forward = "z") => {
  const out = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 3) {
    const [x, y, z] = [values[index]!, values[index + 1]!, values[index + 2]!];
    out[index] = (forward === "z" ? z : x) * scale;
    out[index + 1] = y * scale;
    out[index + 2] = (forward === "z" ? -x : z) * scale;
  }
  return out;
};

/** Middle of the horizontal extent (x, z) of a pose. */
const getCentre = (positions: Float32Array): [number, number] => {
  const low = [Infinity, Infinity];
  const high = [-Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (const [slot, axis] of [[0, 0], [1, 2]] as const) {
      low[slot] = Math.min(low[slot]!, positions[index + axis]!);
      high[slot] = Math.max(high[slot]!, positions[index + axis]!);
    }
  }
  return [(low[0]! + high[0]!) / 2, (low[1]! + high[1]!) / 2];
};

const lowestY = (positions: Float32Array) => {
  let lowest = Infinity;
  for (let index = 1; index < positions.length; index += 3) {
    lowest = Math.min(lowest, positions[index]!);
  }
  return lowest;
};

/** Joint names of the source skin by joint index. */
export const getJointNames = (source: SkinSource) => {
  const json = source.file.json as any;
  return (json.skins[0].joints as number[]).map((node) => json.nodes[node].name as string);
};

/**
 * Per vertex summed skin weight on bones matching `bones` (name substring to share, e.g. a
 * neck base turning half).
 */
export const getRegionWeights = (source: SkinSource, bones: Record<string, number>) => {
  const names = getJointNames(source);
  const count = source.positions.length / 3;
  const weights = new Float32Array(count);
  for (let vertex = 0; vertex < count; vertex += 1) {
    for (let influence = 0; influence < 4; influence += 1) {
      const name = names[source.joints[vertex * 4 + influence]!]!;
      const match = Object.keys(bones).find((bone) => name.includes(bone));
      if (match) weights[vertex]! += source.weights[vertex * 4 + influence]! * bones[match]!;
    }
  }
  return weights;
};

/**
 * Lying on the brisket (critter space, in place): below the belly line the legs fold flat under
 * the trunk and tuck in towards the body's centre line; the trunk comes down onto them.
 */
const lieDown = (positions: Float32Array, belly: number) => {
  const drop = belly * (1 - FOLDED_LEGS);
  for (let index = 0; index < positions.length; index += 3) {
    const y = positions[index + 1]!;
    if (y >= belly) {
      positions[index + 1] = y - drop;
      continue;
    }
    positions[index + 1] = y * FOLDED_LEGS;
    positions[index + 2] = positions[index + 2]! * TUCK;
  }
};

/** Swimming: lowered by `depth`, the part under the surface flattened onto it (hidden by the water). */
const sink = (positions: Float32Array, depth: number) => {
  for (let index = 1; index < positions.length; index += 3) {
    positions[index] = Math.max(0, positions[index]! - depth);
  }
};

interface FrameBase {
  belly: number;
  /** Horizontal centre of the standing pose (critter x, z): every frame turns about it. */
  centre: [number, number];
  ground: number;
  /** Forward position of the root bone standing (critter x). */
  rootX: number;
}

const getRootX = (build: SkinnedCritterBuild, world: Parameters<typeof getBonePosition>[1]) => {
  if (!build.rootBone) return 0;
  const bone = getBonePosition(build.source, world, build.rootBone);
  return toCritter(bone.toArray(), build.scale, build.forward)[0]!;
};

const createFrame = (build: SkinnedCritterBuild, spec: CritterFrameSpec, frameBase: FrameBase) => {
  const { look, scale, source } = build;
  const { belly, ground } = frameBase;
  const pose = skinPose(source, spec.clip, spec.time, spec.offsets, spec.scales);
  const positions = toCritter(pose.positions, scale, build.forward);
  const travel = frameBase.rootX - getRootX(build, pose.world) - frameBase.centre[0];
  for (let index = 0; index < positions.length; index += 3) {
    positions[index]! += travel;
    positions[index + 2]! -= frameBase.centre[1];
  }
  const normals = toCritter(pose.normals, 1, build.forward);
  const base = spec.ground ? lowestY(positions) : ground;
  for (let index = 1; index < positions.length; index += 3) positions[index]! -= base;
  if (spec.rest) lieDown(positions, belly);
  if (spec.waterline) sink(positions, spec.waterline);
  const mesh = { normals, positions } as unknown as PropMesh;
  if (spec.look) {
    const bone = toCritter(getBonePosition(source, pose.world, look.pivot).toArray(), scale, build.forward);
    const pivot: Vec3 = [bone[0]! + travel, bone[1]! - base, bone[2]! - frameBase.centre[1]];
    turnRegion(mesh, look.weights, pivot, [0, 1, 0], spec.look);
  }
  return { normals: mesh.normals, positions: mesh.positions } as Frame;
};

/** Triangles with every corner on the optional part go last; returns them and their count. */
const optionalLast = (indices: ArrayLike<number>, optional?: (vertex: number) => boolean) => {
  const main: number[] = [];
  const part: number[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    const corners = [indices[index]!, indices[index + 1]!, indices[index + 2]!];
    const isPart = optional !== undefined && corners.every((vertex) => optional(vertex));
    (isPart ? part : main).push(...corners);
  }
  return { indices: [...main, ...part], partTriangles: part.length / 3 };
};

/** A simplified index set over the same vertices (`share` of them kept, mapped back by position). */
const simplifyIndices = async (frame: Frame, indices: number[], share: number) => {
  const used = [...new Set(indices)];
  const local = new Map(used.map((vertex, index) => [vertex, index]));
  const positions = new Float32Array(used.length * 3);
  const normals = new Float32Array(used.length * 3);
  used.forEach((vertex, index) => {
    positions.set(frame.positions.subarray(vertex * 3, vertex * 3 + 3), index * 3);
    normals.set(frame.normals.subarray(vertex * 3, vertex * 3 + 3), index * 3);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices.map((vertex) => local.get(vertex)!));
  const simplified = await new SimplifyModifier().modify(geometry, Math.round(used.length * (1 - share)));
  const kept = simplified.getAttribute("position");
  const byPosition = new Map<string, number>();
  const key = (x: number, y: number, z: number) => `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
  for (const vertex of [...used].reverse()) {
    const at = vertex * 3;
    byPosition.set(key(frame.positions[at]!, frame.positions[at + 1]!, frame.positions[at + 2]!), vertex);
  }
  const map = Array.from({ length: kept.count }, (_, vertex) =>
    byPosition.get(key(kept.getX(vertex), kept.getY(vertex), kept.getZ(vertex)))!
  );
  return Array.from(simplified.index!.array, (vertex) => map[vertex]!);
};

/** Keeps only the vertices the High indices use (frames, colours and both index sets remapped). */
const compact = (frames: Frame[], build: SkinnedCritterBuild, high: number[], minimal: number[]) => {
  const used = [...new Set(high)].sort((a, b) => a - b);
  const remap = new Map(used.map((vertex, index) => [vertex, index]));
  const pick = (values: Float32Array, size = 3) => {
    const out = new Float32Array(used.length * size);
    used.forEach((vertex, index) => out.set(values.subarray(vertex * size, vertex * size + size), index * size));
    return out;
  };
  const { coats, winterThickness } = build;
  return {
    coats: { summer: pick(coats.summer), winter: pick(coats.winter) },
    thickness: winterThickness ? pick(winterThickness, 1) : undefined,
    frames: frames.map((frame) => ({ normals: pick(frame.normals), positions: pick(frame.positions) })),
    high: high.map((vertex) => remap.get(vertex)!),
    minimal: minimal.map((vertex) => remap.get(vertex)!),
    vertices: used.length
  };
};

/** Bakes, simplifies and writes the critter GLB; returns the counts (and data for review). */
export const buildSkinnedCritter = async (build: SkinnedCritterBuild) => {
  const { scale, source } = build;
  const stand = skinPose(source, build.standClip, build.standTime ?? 0);
  const standing = toCritter(stand.positions, scale, build.forward);
  const origin = build.originBone
    ? toCritter(getBonePosition(source, stand.world, build.originBone).toArray(), scale, build.forward)
    : null;
  const ground = origin ? origin[1]! : lowestY(standing);
  let belly = Infinity;
  for (let vertex = 0; vertex < standing.length / 3; vertex += 1) {
    if (build.isTrunk?.(vertex)) belly = Math.min(belly, standing[vertex * 3 + 1]! - ground);
  }
  const centre: [number, number] = origin ? [origin[0]!, origin[2]!] : getCentre(standing);
  const frameBase = { belly, centre, ground, rootX: getRootX(build, stand.world) };
  const frames = build.specs.map((spec) => createFrame(build, spec, frameBase));
  const source3 = Array.from(source.indices);
  const simplifyFrame = build.simplifyPose ? createFrame(build, build.simplifyPose, frameBase) : frames[0]!;
  const highSource = build.highShare ? await simplifyIndices(simplifyFrame, source3, build.highShare) : source3;
  const high = optionalLast(highSource, build.optional);
  const minimal = optionalLast(await simplifyIndices(simplifyFrame, high.indices, build.minimalShare), build.optional);
  const packed = compact(frames, build, high.indices, minimal.indices);
  // A frame grounded on its own lowest point keeps it among the shipped (High) vertices.
  build.specs.forEach((spec, index) => {
    if (!spec.ground) return;
    const { positions } = packed.frames[index]!;
    const lowest = lowestY(positions);
    for (let at = 1; at < positions.length; at += 3) positions[at]! -= lowest;
  });
  const vec3 = (component: "short" | "byte" | "unsignedByte", values: Float32Array) =>
    ({ component, normalized: true, type: "VEC3" as const, values });
  const accessors = [
    vec3("unsignedByte", packed.coats.summer),
    vec3("unsignedByte", packed.coats.winter),
    { component: "unsignedShort" as const, type: "SCALAR" as const, values: packed.high },
    { component: "unsignedShort" as const, type: "SCALAR" as const, values: packed.minimal },
    ...packed.frames.flatMap((frame) => [vec3("short", frame.positions), vec3("byte", frame.normals)]),
    ...(packed.thickness ? [{ component: "float" as const, type: "SCALAR" as const, values: packed.thickness }] : [])
  ];
  const json = {
    asset: { copyright: build.copyright, generator: `island-of-settlers tools/assets (${build.name})`, version: "2.0" },
    meshes: [{
      extras: {
        frames: packed.frames.map((_, frame) => [4 + frame * 2, 5 + frame * 2]),
        minimal: { indices: 3, partTriangles: minimal.partTriangles },
        partTriangles: high.partTriangles,
        winterThickness: packed.thickness ? 4 + packed.frames.length * 2 : undefined
      },
      name: build.name,
      primitives: [{ attributes: { COLOR_0: 0, COLOR_1: 1, NORMAL: 5, POSITION: 4 }, indices: 2 }]
    }]
  };
  mkdirSync(resolve(build.target, ".."), { recursive: true });
  writeFileSync(resolve(build.target), writeGlb(json, accessors));
  console.log(build.name, packed.vertices, "vertices,", packed.high.length / 3, "triangles,",
    packed.minimal.length / 3, "minimal,", frames.length, "frames,", high.partTriangles, "optional");
  return packed;
};

/** Review data for the raster scripts (summer / winter colours, frames, index sets). */
export const writeReview = (path: string | undefined, packed: Awaited<ReturnType<typeof buildSkinnedCritter>>) => {
  if (!path) return;
  writeFileSync(path, JSON.stringify({
    colors: Array.from(packed.coats.summer),
    frames: packed.frames.map((frame) => ({ nor: Array.from(frame.normals), pos: Array.from(frame.positions) })),
    high: packed.high,
    minimal: packed.minimal,
    winter: Array.from(packed.coats.winter)
  }));
};

/** Scale that makes the standing pose's length (nose to tail, source units) `length` island units. */
export const getScaleForLength = (
  source: SkinSource,
  stand: { clip: number; time?: number },
  length: number,
  forward: Forward = "z"
) => {
  const { positions } = skinPose(source, stand.clip, stand.time ?? 0);
  let [low, high] = [Infinity, -Infinity];
  for (let index = forward === "z" ? 2 : 0; index < positions.length; index += 3) {
    low = Math.min(low, positions[index]!);
    high = Math.max(high, positions[index]!);
  }
  return length / (high - low);
};
