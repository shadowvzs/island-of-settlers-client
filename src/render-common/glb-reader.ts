/**
 * Minimal binary glTF (GLB) reader for the shipped model assets (animals, plants): accessors
 * as typed arrays, node names, the skin's bind matrices and embedded images. No DOM, no loader
 * classes, so the same code parses in the browser and in Node (tests). Only what the asset
 * pipeline writes is supported (one binary chunk, embedded buffer views).
 */

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  normalized?: boolean;
  type: keyof typeof COMPONENTS;
}

interface GltfPrimitive {
  attributes: Record<string, number>;
  indices: number;
  material?: number;
}

interface GltfJson {
  accessors: GltfAccessor[];
  bufferViews: { byteLength: number; byteOffset?: number; byteStride?: number }[];
  images?: { bufferView: number; mimeType: string }[];
  materials?: {
    name?: string;
    normalTexture?: { index: number };
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      baseColorTexture?: { index: number };
    };
  }[];
  meshes: { name?: string; primitives: GltfPrimitive[] }[];
  nodes: { mesh?: number; name?: string; skin?: number }[];
  skins?: { inverseBindMatrices: number; joints: number[] }[];
  textures?: { extensions?: Record<string, { source: number }>; source?: number }[];
}

const COMPONENTS = { MAT4: 16, SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as const;

const ARRAYS: Record<number, { bytes: number; read: (view: DataView, at: number) => number }> = {
  5120: { bytes: 1, read: (view, at) => view.getInt8(at) },
  5121: { bytes: 1, read: (view, at) => view.getUint8(at) },
  5122: { bytes: 2, read: (view, at) => view.getInt16(at, true) },
  5123: { bytes: 2, read: (view, at) => view.getUint16(at, true) },
  5125: { bytes: 4, read: (view, at) => view.getUint32(at, true) },
  5126: { bytes: 4, read: (view, at) => view.getFloat32(at, true) }
};
/** Normalised integers map to 0..1 (unsigned) or -1..1 (signed, clamped as glTF defines). */
const NORMALIZERS: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

export interface GlbFile {
  binary: DataView;
  json: GltfJson;
}

export const readGlb = (buffer: ArrayBuffer): GlbFile => {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("not a GLB file");
  let offset = 12;
  let json: GltfJson | null = null;
  let binary: DataView | null = null;
  while (offset < buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === CHUNK_JSON) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
    }
    if (type === CHUNK_BIN) binary = new DataView(buffer, start, length);
    offset = start + length;
  }
  if (!json || !binary) throw new Error("GLB without JSON or binary chunk");
  return { binary, json };
};

/** Bytes of a base64 data URL (GLBs inlined by Vite: decoded without a fetch, also in workers). */
export const decodeDataUrl = (url: string) => {
  const binary = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
};

/** Every element of an accessor as floats (normalised integers mapped to 0..1 or -1..1). */
export const readAccessor = (file: GlbFile, index: number): Float32Array => {
  const accessor = file.json.accessors[index]!;
  const view = file.json.bufferViews[accessor.bufferView]!;
  const components = COMPONENTS[accessor.type];
  const array = ARRAYS[accessor.componentType]!;
  const stride = view.byteStride ?? components * array.bytes;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const scale = accessor.normalized ? 1 / NORMALIZERS[accessor.componentType]! : 1;
  const signed = accessor.componentType === 5120 || accessor.componentType === 5122;
  const clampSigned = Boolean(accessor.normalized) && signed;
  const result = new Float32Array(accessor.count * components);
  for (let element = 0; element < accessor.count; element += 1) {
    for (let component = 0; component < components; component += 1) {
      const at = start + element * stride + component * array.bytes;
      const value = array.read(file.binary, at) * scale;
      result[element * components + component] = clampSigned ? Math.max(-1, value) : value;
    }
  }
  return result;
};

/** The image bytes of a texture (core source or the WebP extension's). */
export const readTextureImage = (file: GlbFile, textureIndex: number) => {
  const texture = file.json.textures![textureIndex]!;
  const source = texture.source ?? texture.extensions?.EXT_texture_webp?.source;
  const image = file.json.images![source!]!;
  const view = file.json.bufferViews[image.bufferView]!;
  const bytes = new Uint8Array(
    file.binary.buffer,
    file.binary.byteOffset + (view.byteOffset ?? 0),
    view.byteLength
  );
  return { bytes, mimeType: image.mimeType };
};

export type GlbImage = ReturnType<typeof readTextureImage>;
