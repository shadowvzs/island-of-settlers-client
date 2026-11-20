import type { LayerArray } from "../../save/map-layers";
import type { DiffSide } from "./history-meta";

/** Equal bytes shorter than this inside a change join it (fewer, longer spans). */
const SPAN_GAP_BYTES = 64;

/** A changed run of a layer: its first entry and its entries before and after the edit. */
export interface LayerSpan {
  after: LayerArray;
  before: LayerArray;
  start: number;
}

/** The layer's bytes (one monomorphic compare loop for every element type). */
const toBytes = (array: LayerArray) =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

/**
 * Byte runs [start, end) where the arrays differ; bytes only one array has (a longer prop list)
 * count as changed.
 */
const findChangedBytes = (before: Uint8Array, after: Uint8Array) => {
  const shared = Math.min(before.length, after.length);
  const runs: [number, number][] = [];
  let start = -1;
  let end = -1;
  const addRun = (from: number, until: number) => {
    if (start >= 0 && from - end <= SPAN_GAP_BYTES) {
      end = until;
      return;
    }
    if (start >= 0) runs.push([start, end]);
    start = from;
    end = until;
  };
  for (let index = 0; index < shared; index += 1) {
    if (before[index] !== after[index]) addRun(index, index + 1);
  }
  const longest = Math.max(before.length, after.length);
  if (longest > shared) addRun(shared, longest);
  if (start >= 0) runs.push([start, end]);
  return runs;
};

/** Where the two versions of a layer differ, as spans of whole entries with both versions. */
export const findChangedSpans = (before: LayerArray, after: LayerArray): LayerSpan[] => {
  const bytes = after.BYTES_PER_ELEMENT;
  return findChangedBytes(toBytes(before), toBytes(after)).map(([from, until]) => {
    const start = Math.floor(from / bytes);
    const end = Math.ceil(until / bytes);
    return { after: after.slice(start, end), before: before.slice(start, end), start };
  });
};

/**
 * Writes one side of a span into the layer where it still holds the other side: entries changed
 * since (a felled tree frees its cells) keep their value, entries the other side lacks (props
 * added by the edit) are written. Clipped to the layer's length.
 */
export const writeSpan = (target: LayerArray, span: LayerSpan, side: DiffSide) => {
  const values = span[side];
  const other = span[side === "after" ? "before" : "after"];
  const end = Math.min(values.length, target.length - span.start);
  for (let offset = 0; offset < end; offset += 1) {
    const index = span.start + offset;
    const expected = other[offset];
    if (expected === undefined || Object.is(target[index], expected)) {
      target[index] = values[offset]!;
    }
  }
};

/** Memory a span keeps (both versions). */
export const getSpanBytes = ({ after, before }: LayerSpan) => after.byteLength + before.byteLength;

/** An empty layer of the same type (a layer that did not exist yet compares as zeros). */
export const createZeroLayer = (like: LayerArray): LayerArray =>
  new (like.constructor as new (length: number) => LayerArray)(like.length);

/** Copies the layer into `buffer` when it fits (no allocation), else into a new array. */
export const copyLayer = (buffer: LayerArray | undefined, source: LayerArray): LayerArray => {
  const fits = buffer?.constructor === source.constructor && buffer.length >= source.length;
  if (!fits) return source.slice();
  buffer.set(source);
  return buffer.subarray(0, source.length);
};
