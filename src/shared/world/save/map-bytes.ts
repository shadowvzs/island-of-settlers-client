import { compressBytes, decompressBytes } from "../../../../../island-of-settlers-shared/src/map-file";
import type { MapCodec } from "./map-format";

/** The platform compression streams live with the shared map-file envelope (the API reads headers too). */
export { compressBytes, decompressBytes };

/**
 * Byte helpers of the map file: byte planes (all first bytes of a typed array, then all second
 * bytes...: floats compress far better that way), gzip or brotli through the platform's compression
 * streams (browsers and Node), a growing byte writer.
 */

const toBytes = (array: ArrayBufferView) =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

/** The array's bytes regrouped into planes, one plane per byte of an element. */
export const toBytePlanes = (array: ArrayBufferView, elementBytes: number) => {
  const source = toBytes(array);
  if (elementBytes === 1) return source;
  const count = source.length / elementBytes;
  const planes = new Uint8Array(source.length);
  for (let plane = 0; plane < elementBytes; plane += 1) {
    const offset = plane * count;
    for (let index = 0; index < count; index += 1) {
      planes[offset + index] = source[index * elementBytes + plane]!;
    }
  }
  return planes;
};

/** The element bytes back from their planes, in a new buffer of their own. */
export const fromBytePlanes = (planes: Uint8Array, elementBytes: number) => {
  if (elementBytes === 1) return planes.slice();
  const count = planes.length / elementBytes;
  const bytes = new Uint8Array(planes.length);
  for (let plane = 0; plane < elementBytes; plane += 1) {
    const offset = plane * count;
    for (let index = 0; index < count; index += 1) {
      bytes[index * elementBytes + plane] = planes[offset + index]!;
    }
  }
  return bytes;
};

/**
 * Byte wise XOR of two arrays of the same byte length, in a new buffer: zero where they agree
 * (a layer stored against a similar one compresses to almost nothing), and XOR again restores it.
 */
export const xorBytes = (first: ArrayBufferView, second: ArrayBufferView) => {
  const left = toBytes(first);
  const right = toBytes(second);
  const result = new Uint8Array(left.length);
  for (let index = 0; index < left.length; index += 1) result[index] = left[index]! ^ right[index]!;
  return result;
};

/** Collects byte parts and joins them once. */
export const createByteWriter = () => {
  const parts: Uint8Array[] = [];
  let length = 0;
  return {
    join: () => {
      const joined = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        joined.set(part, offset);
        offset += part.length;
      }
      return joined;
    },
    push: (part: Uint8Array) => {
      parts.push(part);
      length += part.length;
    }
  };
};

const BROTLI_SAMPLE_BYTES = 256 * 1024;
/**
 * Brotli through `CompressionStream` has no quality setting: some platforms use their slowest level
 * (Node: 7 s for a 512 x 512 map, gzip 0.1 s). Brotli is used only when a sample compresses faster
 * than this (milliseconds per 256 KiB; a fast level takes about 1).
 */
export const BROTLI_SAMPLE_MAX_MS = 16;

let brotliIsFast: Promise<boolean> | undefined;

const measureBrotli = async (sample: Uint8Array) => {
  try {
    const startedAt = performance.now();
    await compressBytes(sample, "brotli");
    return performance.now() - startedAt <= BROTLI_SAMPLE_MAX_MS;
  } catch {
    return false;
  }
};

/** The codec for a payload: brotli where the platform has it and compresses fast, else gzip (cached). */
export const chooseMapCodec = async (payload: Uint8Array): Promise<MapCodec> => {
  brotliIsFast ??= typeof CompressionStream === "undefined" ? Promise.resolve(false) :
    measureBrotli(payload.subarray(0, BROTLI_SAMPLE_BYTES));
  return (await brotliIsFast) ? "brotli" : "gzip";
};
