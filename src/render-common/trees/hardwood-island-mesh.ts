import type { PropMesh } from "../props/mesh-builder";
import meta from "./hardwood-mesh-meta.json";
import type { GrowthStage } from "./tree-model";

/** A slice of the unpacked hardwood payload (`hardwood-mesh-data.gz.bin`). */
interface PayloadRange {
  length: number;
  offset: number;
}

/** Negative UV slot between plain props and bark: opaque source-derived sculpted foliage. */
const HARDWOOD_LEAF_U = -1.25;
const STAGE_SCALE: Record<GrowthStage, number> = { 1: .12, 2: .28, 3: .54, 4: .78, 5: 1 };
const source = (form: number) => meta.variants[(form & 0x0f) % meta.variants.length]!;

/** Vertex and index bytes of every variant, loaded asynchronously (hardwood-mesh-loader.ts). */
let payload: ArrayBuffer | undefined;

export const isHardwoodMeshPayloadInstalled = () => payload !== undefined;

export const installHardwoodMeshPayload = (buffer: ArrayBuffer) => {
  if (buffer.byteLength !== meta.payloadBytes)
    throw new Error(`Hardwood mesh payload has ${buffer.byteLength} bytes, expected ${meta.payloadBytes}`);
  payload = buffer;
};

/** A private copy of one payload slice: each mesh owns (and may transfer) its own buffers. */
const bytes = ({ length, offset }: PayloadRange) => {
  if (!payload) throw new Error("Hardwood mesh payload not loaded (loadHardwoodMeshPayload)");
  return new Uint8Array(payload.slice(offset, offset + length));
};

export const getHardwoodCrown = (form: number, stage: GrowthStage) => {
  const variant = source(form), size = STAGE_SCALE[stage];
  return { height: variant.crownHeight * size, radius: variant.crownRadius * size };
};

export const getHardwoodStumpRadius = (form: number) => source(form).trunkRadius;

/**
 * Offline source simplification and texture-colour bake; shared normal/wind/impostor pipelines remain native.
 * Needs the installed payload: the crown and stump metadata above do not.
 */
export const createHardwoodIslandMesh = (form: number, stage: GrowthStage): PropMesh => {
  const variant = source(form), packed = bytes(variant.vertices), indexBytes = bytes(variant.indices);
  const minimalBytes = bytes(variant.minimalIndices);
  const view = new DataView(packed.buffer), count = packed.length / meta.vertexBytes;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3), uvs = new Float32Array(count * 2), wind = new Float32Array(count * 2);
  const size = STAGE_SCALE[stage];
  for (let id = 0; id < count; id++) {
    const offset = id * meta.vertexBytes;
    const leaf = view.getUint8(offset + 12) === 1;
    for (let axis = 0; axis < 3; axis++) {
      positions[id * 3 + axis] = (variant.min[axis]! + view.getUint16(offset + axis * 2, true) /
        65535 * (variant.max[axis]! - variant.min[axis]!)) * size;
      normals[id * 3 + axis] = view.getInt8(offset + 6 + axis) / 127;
      colors[id * 3 + axis] = view.getUint8(offset + 9 + axis) / 255;
    }
    const length = Math.hypot(normals[id * 3]!, normals[id * 3 + 1]!, normals[id * 3 + 2]!) || 1;
    for (let axis = 0; axis < 3; axis++) normals[id * 3 + axis] = normals[id * 3 + axis]! / length;
    const y = Math.max(0, positions[id * 3 + 1]! / (3.25 * size));
    // The root stays anchored; branch bending and leaf flutter reuse the established shader.
    wind[id * 2] = Math.pow(y, 2) * .65;
    wind[id * 2 + 1] = leaf ? .45 : 0;
    uvs[id * 2] = leaf ? HARDWOOD_LEAF_U : -2 - Math.abs(view.getInt16(offset + 14, true) / 32767);
    uvs[id * 2 + 1] = leaf ? -1 : view.getInt16(offset + 16, true) / 1000;
  }
  return { colors, contactRadius: variant.trunkRadius * size * 1.8,
    coreIndexCount: variant.coreIndexCount, height: 3.25 * size,
    indices: new Uint16Array(indexBytes.buffer), minimalIndices: new Uint16Array(minimalBytes.buffer),
    normals, positions, radius: variant.radius * size, uvs, wind };
};
