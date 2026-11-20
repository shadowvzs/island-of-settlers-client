import type { AtlasMip } from "./atlas-mips";

/**
 * Minimal KTX2 container for uncompressed RGBA8 textures with an explicit, offline-built mip
 * chain (Khronos KTX 2.0: R8G8B8A8_UNORM / R8G8B8A8_SRGB, one face, one layer). Levels may be
 * zlib-supercompressed (KHR_SUPERCOMPRESSION_ZLIB), which browsers inflate natively with
 * `DecompressionStream("deflate")`. Pure and worker-safe; compression is injected by the caller.
 */

const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
const VK_FORMAT_R8G8B8A8_UNORM = 37;
const VK_FORMAT_R8G8B8A8_SRGB = 43;
const SUPERCOMPRESSION_NONE = 0;
const SUPERCOMPRESSION_ZLIB = 3;
const HEADER_BYTES = 80;
const LEVEL_INDEX_BYTES = 24;
const DFD_BYTES = 4 + 24 + 4 * 16;
const KHR_DF_MODEL_RGBSDA = 1;
const KHR_DF_PRIMARIES_BT709 = 1;
const KHR_DF_TRANSFER_LINEAR = 1;
const KHR_DF_TRANSFER_SRGB = 2;
const KHR_DF_SAMPLE_DATATYPE_LINEAR = 0x10;
const ALPHA_CHANNEL_ID = 15;

export interface Ktx2Rgba8Texture {
  height: number;
  levels: AtlasMip[];
  /** True for R8G8B8A8_SRGB (colour data), false for UNORM (normal/material data). */
  srgb: boolean;
  width: number;
}

export interface Ktx2EncodeOptions {
  /** zlib (RFC 1950) compressor, e.g. `node:zlib` `deflateSync`; omit for no supercompression. */
  compress?: (bytes: Uint8Array) => Uint8Array;
  srgb: boolean;
  /** Recorded as `KTXwriter`. */
  writer: string;
}

const align = (value: number, multiple: number) => Math.ceil(value / multiple) * multiple;

const keyValue = (key: string, value: string) => {
  const text = new TextEncoder().encode(`${key}\0${value}\0`);
  const entry = new Uint8Array(align(4 + text.length, 4));
  new DataView(entry.buffer).setUint32(0, text.length, true);
  entry.set(text, 4);
  return entry;
};

const writeDataFormatDescriptor = (view: DataView, offset: number, srgb: boolean) => {
  view.setUint32(offset, DFD_BYTES, true);
  view.setUint32(offset + 4, 0, true);
  view.setUint16(offset + 8, 2, true);
  view.setUint16(offset + 10, DFD_BYTES - 4, true);
  view.setUint8(offset + 12, KHR_DF_MODEL_RGBSDA);
  view.setUint8(offset + 13, KHR_DF_PRIMARIES_BT709);
  view.setUint8(offset + 14, srgb ? KHR_DF_TRANSFER_SRGB : KHR_DF_TRANSFER_LINEAR);
  view.setUint8(offset + 15, 0);
  view.setUint8(offset + 20, 4);
  [0, 1, 2, ALPHA_CHANNEL_ID].forEach((channel, sample) => {
    const at = offset + 28 + sample * 16;
    const linearAlpha = srgb && channel === ALPHA_CHANNEL_ID ? KHR_DF_SAMPLE_DATATYPE_LINEAR : 0;
    view.setUint16(at, sample * 8, true);
    view.setUint8(at + 2, 7);
    view.setUint8(at + 3, channel | linearAlpha);
    view.setUint32(at + 8, 0, true);
    view.setUint32(at + 12, 255, true);
  });
};

const assertMipChain = (levels: readonly AtlasMip[]) => {
  if (levels.length === 0) throw new Error("KTX2 needs at least one level");
  levels.forEach((level, index) => {
    const width = Math.max(1, levels[0]!.width >> index), height = Math.max(1, levels[0]!.height >> index);
    if (level.width !== width || level.height !== height || level.data.length !== width * height * 4) {
      throw new Error(`KTX2 level ${index} must be ${width}x${height} RGBA8`);
    }
  });
};

/** Encodes level 0 first; level data is stored smallest level first as the format requires. */
export const encodeKtx2Rgba8 = (levels: readonly AtlasMip[], options: Ktx2EncodeOptions) => {
  assertMipChain(levels);
  const payloads = levels.map(level => options.compress?.(level.data) ?? level.data);
  const keyValues = [keyValue("KTXorientation", "ru"), keyValue("KTXwriter", options.writer)];
  const kvdBytes = keyValues.reduce((sum, entry) => sum + entry.length, 0);
  const dfdOffset = HEADER_BYTES + levels.length * LEVEL_INDEX_BYTES;
  const kvdOffset = dfdOffset + DFD_BYTES;
  const dataOffset = align(kvdOffset + kvdBytes, 8);
  const total = dataOffset + payloads.reduce((sum, payload) => sum + payload.length, 0);
  const bytes = new Uint8Array(total), view = new DataView(bytes.buffer);
  bytes.set(IDENTIFIER, 0);
  [options.srgb ? VK_FORMAT_R8G8B8A8_SRGB : VK_FORMAT_R8G8B8A8_UNORM, 1, levels[0]!.width,
    levels[0]!.height, 0, 0, 1, levels.length,
    options.compress ? SUPERCOMPRESSION_ZLIB : SUPERCOMPRESSION_NONE, dfdOffset, DFD_BYTES,
    kvdOffset, kvdBytes].forEach((value, index) => view.setUint32(12 + index * 4, value, true));
  writeDataFormatDescriptor(view, dfdOffset, options.srgb);
  let cursor = kvdOffset;
  for (const entry of keyValues) { bytes.set(entry, cursor); cursor += entry.length; }
  cursor = dataOffset;
  for (let level = levels.length - 1; level >= 0; level -= 1) {
    const index = HEADER_BYTES + level * LEVEL_INDEX_BYTES, payload = payloads[level]!;
    view.setBigUint64(index, BigInt(cursor), true);
    view.setBigUint64(index + 8, BigInt(payload.length), true);
    view.setBigUint64(index + 16, BigInt(levels[level]!.data.length), true);
    bytes.set(payload, cursor);
    cursor += payload.length;
  }
  return bytes;
};

const readHeader = (view: DataView) => {
  const field = (index: number) => view.getUint32(12 + index * 4, true);
  return { format: field(0), height: field(3), levelCount: Math.max(1, field(7)),
    supercompression: field(8), width: field(2) };
};

/** Parses an RGBA8 KTX2 file written by `encodeKtx2Rgba8` (or any equivalent writer). */
export const parseKtx2Rgba8 = async (buffer: ArrayBuffer | Uint8Array,
  inflate: (bytes: Uint8Array) => Promise<Uint8Array>): Promise<Ktx2Rgba8Texture> => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < HEADER_BYTES || IDENTIFIER.some((value, index) => bytes[index] !== value)) {
    throw new Error("Not a KTX2 file");
  }
  const header = readHeader(view);
  if (header.format !== VK_FORMAT_R8G8B8A8_SRGB && header.format !== VK_FORMAT_R8G8B8A8_UNORM) {
    throw new Error(`Unsupported KTX2 vkFormat ${header.format}`);
  }
  if (header.supercompression !== SUPERCOMPRESSION_NONE && header.supercompression !== SUPERCOMPRESSION_ZLIB) {
    throw new Error(`Unsupported KTX2 supercompression ${header.supercompression}`);
  }
  const levels = await Promise.all(Array.from({ length: header.levelCount }, async (_, level) => {
    const index = HEADER_BYTES + level * LEVEL_INDEX_BYTES;
    const offset = Number(view.getBigUint64(index, true)), length = Number(view.getBigUint64(index + 8, true));
    const stored = bytes.subarray(offset, offset + length);
    const data = header.supercompression === SUPERCOMPRESSION_ZLIB ? await inflate(stored) : stored.slice();
    const width = Math.max(1, header.width >> level), height = Math.max(1, header.height >> level);
    if (data.length !== width * height * 4) throw new Error(`KTX2 level ${level} has the wrong size`);
    return { data, height, width };
  }));
  return { height: header.height, levels, srgb: header.format === VK_FORMAT_R8G8B8A8_SRGB, width: header.width };
};

/** Browser and Node 18+ native zlib inflate (RFC 1950), off the main thread's JS work. */
export const inflateWithDecompressionStream = async (bytes: Uint8Array) => {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};
