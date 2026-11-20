/**
 * Minimal GLB writer for offline asset tools: one binary buffer, one buffer view per accessor,
 * the caller's JSON (meshes, extras) referencing the accessors by index.
 */

const COMPONENT = { byte: 5120, float: 5126, short: 5122, unsignedByte: 5121, unsignedShort: 5123 } as const;
type ComponentName = keyof typeof COMPONENT;
const BYTES: Record<ComponentName, number> = { byte: 1, float: 4, short: 2, unsignedByte: 1, unsignedShort: 2 };
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as const;
/** Integer value of 1.0 for normalised components (glTF). */
const NORMALIZED_LIMIT: Record<ComponentName, number> = {
  byte: 127,
  float: 1,
  short: 32767,
  unsignedByte: 255,
  unsignedShort: 65535
};

export interface AccessorInput {
  component: ComponentName;
  normalized?: boolean;
  type: keyof typeof COMPONENTS;
  /** Values (normalised components already in -1..1 / 0..1 for normalized integers). */
  values: ArrayLike<number>;
}

const encode = (input: AccessorInput) => {
  const bytes = BYTES[input.component];
  const buffer = new ArrayBuffer(input.values.length * bytes);
  const view = new DataView(buffer);
  const limit = NORMALIZED_LIMIT[input.component];
  for (let index = 0; index < input.values.length; index += 1) {
    const raw = input.values[index]!;
    const value = input.normalized ? Math.round(Math.max(-1, Math.min(1, raw)) * limit) : raw;
    const at = index * bytes;
    if (input.component === "float") view.setFloat32(at, value, true);
    else if (input.component === "short") view.setInt16(at, value, true);
    else if (input.component === "unsignedShort") view.setUint16(at, value, true);
    else if (input.component === "byte") view.setInt8(at, value);
    else view.setUint8(at, value);
  }
  return new Uint8Array(buffer);
};

const pad = (length: number) => (4 - (length % 4)) % 4;

/** The GLB bytes of `json` (accessors, bufferViews and buffers are filled in). */
export const writeGlb = (json: Record<string, unknown>, accessors: AccessorInput[]) => {
  const chunks: Uint8Array[] = [];
  const bufferViews: unknown[] = [];
  const accessorJson: unknown[] = [];
  let offset = 0;
  for (const input of accessors) {
    const data = encode(input);
    bufferViews.push({ buffer: 0, byteLength: data.length, byteOffset: offset });
    accessorJson.push({
      bufferView: bufferViews.length - 1,
      componentType: COMPONENT[input.component],
      count: input.values.length / COMPONENTS[input.type],
      normalized: input.normalized || undefined,
      type: input.type
    });
    chunks.push(data, new Uint8Array(pad(data.length)));
    offset += data.length + pad(data.length);
  }
  const binary = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) {
    binary.set(chunk, at);
    at += chunk.length;
  }
  const text = new TextEncoder().encode(
    JSON.stringify({ ...json, accessors: accessorJson, bufferViews, buffers: [{ byteLength: offset }] })
  );
  const jsonChunk = new Uint8Array(text.length + pad(text.length)).fill(0x20);
  jsonChunk.set(text);
  const total = 12 + 8 + jsonChunk.length + 8 + binary.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonChunk, 20);
  view.setUint32(20 + jsonChunk.length, binary.length, true);
  view.setUint32(24 + jsonChunk.length, 0x004e4942, true);
  out.set(binary, 28 + jsonChunk.length);
  return out;
};
