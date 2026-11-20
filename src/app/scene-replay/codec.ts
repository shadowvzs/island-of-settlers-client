import { isForbiddenKey } from "../../../../island-of-settlers-shared/src/validation/index";
import { base64ToBytes, bytesToBase64 } from "../base64";

/** Data-only scene transport: preserve typed arrays used by actual renderer frame/world contracts. */
const arrays = {
  Float32Array, Float64Array, Int16Array, Int32Array, Int8Array,
  Uint16Array, Uint32Array, Uint8Array, Uint8ClampedArray
};
type ArrayName = keyof typeof arrays;
/** Raw little-endian bytes as base64: about a third of the size of decimal JSON and far faster. */
interface EncodedArray { $sceneArray: string; base64: string }

export const SCENE_REPLAY_MAX_BYTES = 64 * 1024 * 1024;


const encodeArray = (item: ArrayBufferView): EncodedArray => ({
  $sceneArray: item.constructor.name,
  base64: bytesToBase64(new Uint8Array(item.buffer, item.byteOffset, item.byteLength))
});

export const encodeSceneData = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => {
  if (!ArrayBuffer.isView(item) || item instanceof DataView) return item;
  return encodeArray(item);
});

const decodeArray = (data: EncodedArray) => {
  if (!Object.hasOwn(arrays, data.$sceneArray) || typeof data.base64 !== "string")
    throw new Error("Invalid scene typed array");
  const type = arrays[data.$sceneArray as ArrayName];
  const bytes = base64ToBytes(data.base64);
  if (bytes.length % type.BYTES_PER_ELEMENT) throw new Error("Invalid scene typed array");
  return new type(bytes.buffer, 0, bytes.length / type.BYTES_PER_ELEMENT);
};

export const decodeSceneData = (text: string): unknown => {
  if (text.length > SCENE_REPLAY_MAX_BYTES) throw new Error("Scene replay exceeds 64 MiB limit");
  return JSON.parse(text, (key, item: unknown) => {
    if (isForbiddenKey(key)) throw new Error("Invalid scene replay key");
    if (item && typeof item === "object" && "$sceneArray" in item) return decodeArray(item as EncodedArray);
    return item;
  });
};

const streamBytes = async (bytes: Uint8Array, transform: CompressionStream | DecompressionStream) => {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** Packed typed array: its place in the binary tail of a packed value. */
interface PackedArray { $sceneBytes: string; length: number; offset: number }

/** JSON skeleton plus the typed arrays' raw bytes appended: gzip then sees the bytes unencoded. */
const packSceneData = (value: unknown) => {
  const parts: Uint8Array[] = [];
  let offset = 0;
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (!ArrayBuffer.isView(item) || item instanceof DataView) return item;
    const bytes = new Uint8Array(item.buffer, item.byteOffset, item.byteLength);
    const packed: PackedArray = { $sceneBytes: item.constructor.name, length: bytes.length, offset };
    parts.push(bytes);
    offset += bytes.length;
    return packed;
  });
  const head = new TextEncoder().encode(json);
  const packed = new Uint8Array(4 + head.length + offset);
  new DataView(packed.buffer).setUint32(0, head.length);
  packed.set(head, 4);
  let at = 4 + head.length;
  for (const part of parts) {
    packed.set(part, at);
    at += part.length;
  }
  return packed;
};

const unpackArray = (data: PackedArray, tail: Uint8Array) => {
  const type = Object.hasOwn(arrays, data.$sceneBytes) ? arrays[data.$sceneBytes as ArrayName] : undefined;
  const valid = type && Number.isSafeInteger(data.offset) && Number.isSafeInteger(data.length) && data.offset >= 0 &&
    data.length >= 0 && data.offset + data.length <= tail.length && data.length % type.BYTES_PER_ELEMENT === 0;
  if (!valid) throw new Error("Invalid scene typed array");
  const bytes = tail.slice(data.offset, data.offset + data.length);
  return new type(bytes.buffer, 0, data.length / type.BYTES_PER_ELEMENT);
};

export const unpackSceneData = (packed: Uint8Array): unknown => {
  const headLength = new DataView(packed.buffer, packed.byteOffset).getUint32(0);
  if (4 + headLength > packed.length) throw new Error("Invalid scene world");
  const tail = packed.subarray(4 + headLength);
  return JSON.parse(new TextDecoder().decode(packed.subarray(4, 4 + headLength)), (key, item: unknown) => {
    if (isForbiddenKey(key)) throw new Error("Invalid scene replay key");
    if (item && typeof item === "object" && "$sceneBytes" in item) return unpackArray(item as PackedArray, tail);
    return item;
  });
};

/** A whole island world, gzipped from its raw bytes, as base64 (512²: 18 MiB of arrays to ~8 MiB). */
export const compressSceneData = async (value: unknown) =>
  bytesToBase64(await streamBytes(packSceneData(value), new CompressionStream("gzip")));

/** The packed world bytes; `unpackSceneData` turns them into a fresh world each time. */
export const decompressSceneBytes = async (text: string) =>
  streamBytes(base64ToBytes(text), new DecompressionStream("gzip"));
