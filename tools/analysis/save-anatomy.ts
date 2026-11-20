import { readFileSync } from "node:fs";
import { brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";

import { fromBytePlanes } from "../../src/shared/world/save/map-bytes";
import { MAP_CODEC_OFFSET, MAP_PREFIX_BYTES } from "../../src/shared/world/save/map-format";
import { residualName } from "../../src/shared/world/save/map-prediction";
import { TYPE_BYTES } from "../../src/shared/world/save/map-layers";
import { PROP_REMOVED } from "../../src/shared/world/world-data";

/**
 * Read-only save anatomy: per-section raw and gzip-6 bytes, the map's layers and derivability
 * checks (research 12, section 1.3 and 1.4). Usage: npx tsx tools/analysis/save-anatomy.ts <save.json>.
 * Plain node:zlib only, no browser modules, no writes.
 */

interface ChunkInfo { length: number; name: string; type: "f32" | "u16" | "u8" }
interface DecodedMap {
  chunks: Map<string, Uint8Array>;
  codec: "brotli" | "gzip";
  compressed: number;
  formatVersion: number;
  header: { chunks: ChunkInfo[]; propCount: number } & Record<string, unknown>;
  headerBytes: number;
  raw: number;
}
type JsonRecord = Record<string, unknown>;

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value) ?? "");
const gzipBytes = (bytes: Uint8Array) => gzipSync(bytes, { level: 6 }).length;
const gzipJson = (value: unknown) => gzipBytes(Buffer.from(JSON.stringify(value) ?? ""));

const sizeOf = (value: unknown) => ({ gzip: gzipJson(value), json: jsonBytes(value) });

const sizesOfChildren = (value: unknown) => {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value as JsonRecord).map(([key, child]) => [key, sizeOf(child)]));
};

const decodeMap = (base64: string): DecodedMap => {
  const file = Buffer.from(base64, "base64");
  const codec = file[MAP_CODEC_OFFSET] === 1 ? "brotli" : "gzip";
  const raw = (codec === "brotli" ? brotliDecompressSync : gunzipSync)(file.subarray(MAP_PREFIX_BYTES));
  const headerLength = raw.readUInt32LE(0);
  const header = JSON.parse(raw.subarray(4, 4 + headerLength).toString("utf8")) as DecodedMap["header"];
  const chunks = new Map<string, Uint8Array>();
  let offset = 4 + headerLength;
  for (const chunk of header.chunks) {
    const end = offset + chunk.length * TYPE_BYTES[chunk.type];
    chunks.set(chunk.name, new Uint8Array(raw.subarray(offset, end)));
    offset = end;
  }
  return { chunks, codec, compressed: file.length, formatVersion: file.readUInt16LE(4), header, headerBytes: headerLength, raw: raw.length };
};

const describeLayers = (map: DecodedMap) => map.header.chunks.map((chunk) => {
  const bytes = map.chunks.get(chunk.name)!;
  return { gzip: gzipBytes(bytes), length: chunk.length, name: chunk.name, raw: bytes.length, type: chunk.type };
});

const readStored = (map: DecodedMap, name: string) => {
  if (!map.header.chunks.some((entry) => entry.name === name)) return undefined;
  return new Uint32Array(fromBytePlanes(map.chunks.get(name)!, 4).buffer);
};

/** A 4 byte layer as its original bits (a residual chunk, map format 3, is restored from the heights). */
const readLayer = (map: DecodedMap, name: string): Uint32Array | undefined => {
  const plain = readStored(map, name);
  const residual = readStored(map, residualName(name));
  if (plain || !residual) return plain;
  const heights = readStored(map, "heights")!;
  if (name !== "waterDepth") return residual.map((bits, index) => bits ^ heights[index]!);
  const surface = asFloats(readStored(map, "waterSurface")!), height = asFloats(heights);
  return residual.map((bits, index) =>
    bits ^ new Uint32Array(new Float32Array([Math.max(0, surface[index]! - height[index]!)]).buffer)[0]!);
};

const asFloats = (bits: Uint32Array) => new Float32Array(bits.buffer, bits.byteOffset, bits.length);

const countDifferingBits = (first: Uint32Array, second: Uint32Array) => {
  let differing = 0;
  for (let index = 0; index < first.length; index += 1) if (first[index] !== second[index]) differing += 1;
  return differing;
};

const countDepthMismatches = (heights: Uint32Array, surface: Uint32Array, depth: Uint32Array) => {
  const height = asFloats(heights), water = asFloats(surface);
  let mismatches = 0;
  for (let index = 0; index < heights.length; index += 1) {
    const predicted = new Uint32Array(new Float32Array([Math.max(0, water[index]! - height[index]!)]).buffer)[0];
    if (predicted !== depth[index]) mismatches += 1;
  }
  return mismatches;
};

const derivabilityChecks = (map: DecodedMap) => {
  const heights = readLayer(map, "heights");
  const surface = readLayer(map, "waterSurface");
  const depth = readLayer(map, "waterDepth");
  const base = readLayer(map, "roadGradeBase");
  const applied = readLayer(map, "roadGradeApplied");
  return {
    roadGradeAppliedDiffering: heights && applied ? countDifferingBits(heights, applied) : null,
    roadGradeBaseDiffering: heights && base ? countDifferingBits(heights, base) : null,
    waterDepthMismatches: heights && surface && depth ? countDepthMismatches(heights, surface, depth) : null
  };
};

const countRemovedProps = (map: DecodedMap) => {
  const types = map.chunks.get("props.types");
  if (!types) return null;
  return types.reduce((count, type) => count + (type === PROP_REMOVED ? 1 : 0), 0);
};

const describeMap = (base64: string) => {
  const map = decodeMap(base64);
  const header = { ...map.header, chunks: undefined };
  const layers = describeLayers(map);
  return {
    checks: derivabilityChecks(map),
    codec: map.codec,
    compressed: map.compressed,
    formatVersion: map.formatVersion,
    header: { bytes: map.headerBytes, children: sizesOfChildren(header) },
    layers,
    props: { count: map.header.propCount, removed: countRemovedProps(map) },
    raw: map.raw
  };
};

const describeSettlement = (settlement: JsonRecord) => {
  const actors = settlement.actors as { path?: unknown }[] | undefined;
  return {
    actorCount: actors?.length ?? 0,
    actorPathJsonBytes: actors ? jsonBytes(actors.map((actor) => actor.path)) : 0
  };
};

const describeSave = (file: string) => {
  const text = readFileSync(file, "utf8");
  const save = JSON.parse(text) as JsonRecord;
  const sections = Object.fromEntries(Object.entries(save).map(([key, value]) => [key, sizeOf(value)]));
  return {
    file,
    map: typeof save.map === "string" && save.map ? describeMap(save.map) : null,
    progress: sizesOfChildren(save.progress),
    runtime: sizesOfChildren(save.runtime),
    sections,
    settlement: { ...describeSettlement((save.settlement ?? {}) as JsonRecord),
      children: sizesOfChildren(save.settlement) },
    wholeFile: { gzip6: gzipBytes(Buffer.from(text)), json: Buffer.byteLength(text) }
  };
};

const file = process.argv[2];
if (!file) throw new Error("Usage: npx tsx tools/analysis/save-anatomy.ts <save.json>");
console.log(JSON.stringify(describeSave(file), null, 2));
