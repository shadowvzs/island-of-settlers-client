import { getBiomeGrassParameters } from "../biome-grass";
import type { PropMesh } from "../mesh-builder";
import { NO_UV } from "../mesh-builder";
import { COVER } from "../prop-mesh-layout";
import meta from "./biome-grass-meta.json";

interface PayloadRange {
  length: number;
  offset: number;
}

interface LodBlock {
  indices: PayloadRange;
  payload: "hero" | "runtime";
  triangles: number;
  vertices: PayloadRange;
}

interface VariantMeta {
  height: number;
  lods: Record<"hero" | "high" | "min", LodBlock>;
  max: [number, number, number];
  min: [number, number, number];
  radius: number;
  variant: number;
}

interface KindMeta {
  variants: VariantMeta[];
}

interface BiomeGrassMeta {
  heroBytes: number;
  heroSha256: string;
  kinds: Record<string, KindMeta>;
  runtimeBytes: number;
  runtimeSha256: string;
  version: number;
  vertexBytes: number;
}

const GRASS_META = meta as unknown as BiomeGrassMeta;

/** Vertex layout of biome-grass-payload.py: u16 position, i16 normal, u8 colour, u8 wind. */
const VERTEX_BYTES = 16;

/** Runtime and hero payloads, installed once per context (page or worker). */
let runtimePayload: ArrayBuffer | undefined;
let heroPayload: ArrayBuffer | undefined;

const BIOME_OF_KIND: Partial<Record<number, string>> = {
  [COVER.forestGrass]: "forest",
  [COVER.jungleGrass]: "jungle",
  [COVER.savannaGrass]: "savanna"
};

export const isBiomeGrassPayloadInstalled = () => runtimePayload !== undefined;
export const isBiomeGrassHeroPayloadInstalled = () => heroPayload !== undefined;

/** Both payloads carry a sha256 in the meta: a truncated or stale download fails loudly. */
export const installBiomeGrassPayload = (buffer: ArrayBuffer) => {
  if (buffer.byteLength !== GRASS_META.runtimeBytes)
    throw new Error(`Biome grass payload has ${buffer.byteLength} bytes, expected ${GRASS_META.runtimeBytes}`);
  runtimePayload = buffer;
};

export const installBiomeGrassHeroPayload = (buffer: ArrayBuffer) => {
  if (buffer.byteLength !== GRASS_META.heroBytes)
    throw new Error(`Biome grass hero payload has ${buffer.byteLength} bytes, expected ${GRASS_META.heroBytes}`);
  heroPayload = buffer;
};

const getPayload = (name: "hero" | "runtime") => {
  const buffer = name === "hero" ? heroPayload : runtimePayload;
  if (!buffer) throw new Error(`Biome grass ${name} payload not loaded`);
  return buffer;
};

const getVariant = (kind: number, variant: number) => {
  const biome = BIOME_OF_KIND[kind];
  if (!biome) throw new Error(`Kind ${kind} is not a biome grass`);
  const entry = GRASS_META.kinds[biome]!.variants[variant];
  if (!entry) throw new Error(`Biome grass ${biome} has no variant ${variant}`);
  return entry;
};

interface DecodedVertices {
  colors: Float32Array;
  count: number;
  normals: Float32Array;
  positions: Float32Array;
  wind: Float32Array;
}

const decodeVertices = (bytes: Uint8Array, entry: VariantMeta, sway: number, flutter: number) => {
  const count = bytes.byteLength / VERTEX_BYTES;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const wind = new Float32Array(count * 2);
  const size = [entry.max[0] - entry.min[0], entry.max[1] - entry.min[1], entry.max[2] - entry.min[2]];
  for (let index = 0; index < count; index += 1) {
    const offset = index * VERTEX_BYTES;
    for (let axis = 0; axis < 3; axis += 1) {
      positions[index * 3 + axis] = entry.min[axis]! +
        view.getUint16(offset + axis * 2, true) / 65535 * size[axis]!;
      normals[index * 3 + axis] = view.getInt16(offset + 6 + axis * 2, true) / 32767;
      colors[index * 3 + axis] = view.getUint8(offset + 12 + axis) / 255;
    }
    const length = Math.hypot(normals[index * 3]!, normals[index * 3 + 1]!, normals[index * 3 + 2]!) || 1;
    for (let axis = 0; axis < 3; axis += 1) normals[index * 3 + axis] = normals[index * 3 + axis]! / length;
    wind[index * 2] = view.getUint8(offset + 15) / 255 * sway;
    wind[index * 2 + 1] = flutter;
  }
  return { colors, count, normals, positions, wind } satisfies DecodedVertices;
};

const decodeIndices = (bytes: Uint8Array, vertexOffset = 0) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const indices = new Uint16Array(bytes.byteLength / 2);
  for (let index = 0; index < indices.length; index += 1)
    indices[index] = view.getUint16(index * 2, true) + vertexOffset;
  return indices;
};

const appendDecoded = (first: DecodedVertices, second: DecodedVertices): DecodedVertices => {
  const join = (from: Float32Array, to: Float32Array) => {
    const joined = new Float32Array(from.length + to.length);
    joined.set(from);
    joined.set(to, from.length);
    return joined;
  };
  return {
    colors: join(first.colors, second.colors),
    count: first.count + second.count,
    normals: join(first.normals, second.normals),
    positions: join(first.positions, second.positions),
    wind: join(first.wind, second.wind)
  };
};

const slice = (buffer: ArrayBuffer, range: PayloadRange) => new Uint8Array(buffer, range.offset, range.length);

/** Bounds over every decoded vertex block (min can be taller or wider than the high mesh). */
const getBounds = (positions: Float32Array) => {
  let height = 0.01, radius = 0.01;
  for (let index = 0; index < positions.length; index += 3) {
    height = Math.max(height, positions[index + 1]!);
    radius = Math.max(radius, Math.hypot(positions[index]!, positions[index + 2]!));
  }
  return { height, radius };
};

/** The shared path: high geometry with the authored min triangles as its far/zoom-out LOD. */
export const createBiomeGrassMesh = (kind: number, variant: number): PropMesh => {
  const parameters = getBiomeGrassParameters(kind);
  if (!parameters) throw new Error(`Kind ${kind} is not a biome grass`);
  const entry = getVariant(kind, variant);
  const payload = getPayload("runtime");
  const high = decodeVertices(slice(payload, entry.lods.high.vertices), entry, parameters.sway,
    parameters.windFlutter);
  const min = decodeVertices(slice(payload, entry.lods.min.vertices), entry, parameters.sway,
    parameters.windFlutter);
  const vertices = appendDecoded(high, min);
  const indices = decodeIndices(slice(payload, entry.lods.high.indices));
  const lodMinimalIndices = decodeIndices(slice(payload, entry.lods.min.indices), high.count);
  const bounds = getBounds(vertices.positions);
  return {
    castsShadow: parameters.shadowCasting,
    colors: vertices.colors,
    height: bounds.height,
    indices,
    lodMinimalIndices,
    normals: vertices.normals,
    positions: vertices.positions,
    radius: bounds.radius,
    uvs: new Float32Array(vertices.count * 2).fill(NO_UV[0]),
    wind: vertices.wind
  };
};

/** Close-up hero geometry for editor icons and later near-camera passes (never the field cover). */
export const createBiomeGrassHeroMesh = (kind: number, variant: number): PropMesh => {
  const parameters = getBiomeGrassParameters(kind);
  if (!parameters) throw new Error(`Kind ${kind} is not a biome grass`);
  const entry = getVariant(kind, variant);
  const payload = getPayload("hero");
  const hero = decodeVertices(slice(payload, entry.lods.hero.vertices), entry, parameters.sway,
    parameters.windFlutter);
  const bounds = getBounds(hero.positions);
  return {
    castsShadow: parameters.shadowCasting,
    colors: hero.colors,
    height: bounds.height,
    indices: decodeIndices(slice(payload, entry.lods.hero.indices)),
    normals: hero.normals,
    positions: hero.positions,
    radius: bounds.radius,
    uvs: new Float32Array(hero.count * 2).fill(NO_UV[0]),
    wind: hero.wind
  };
};
