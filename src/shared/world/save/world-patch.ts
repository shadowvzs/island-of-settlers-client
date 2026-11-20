import type { PropSet, WorldData } from "../world-data";
import { type LayerArray, type LayerShape, MAP_LAYERS } from "./map-layers";
import {
  currentJournalEpoch,
  hasUnexplainedRevisions,
  JOURNAL_CHUNK,
  journalOf,
  settleJournal,
  type WorldJournal
} from "./world-change-journal";

/**
 * World patches (research 12, S06): what the main thread hands the save worker instead of a clone of
 * the live world. The worker keeps a mirror of the saved layers and applies each patch to it:
 * - a keyframe carries a full copy of every saved layer (first save, a lost mirror, anything the
 *   change journal could not explain);
 * - an incremental patch carries only the dirty 32 x 32 chunks of the cell and vertex layers, the
 *   prop type column (trees are felled in place) and the props appended since the last patch.
 * Every array is a fresh copy and is transferred, so the live world is never detached.
 */
export interface PatchLayer { data: LayerArray; name: string }

/** The world's plain fields (everything but typed arrays and the prop set): small, cloned each save. */
export type WorldShell = Record<string, unknown>;

export interface WorldPatch {
  /** Layers no longer present (an optional layer the world dropped). */
  absent?: string[];
  /** Sequence the mirror must be at to take this patch; null for a keyframe. */
  base: number | null;
  /** Dirty chunk indices (vertex grid), ascending: the packed layers hold their rows in this order. */
  chunks?: Uint32Array;
  fog: Uint8Array;
  /** Incremental: layers sent whole because the world replaced the array or created it (`layers` holds them). */
  full?: string[];
  /** Keyframe: every saved layer. Incremental: packed chunk rows, `props.types` and appended prop columns. */
  layers: PatchLayer[];
  permanentFog?: Uint8Array;
  /** First index of the appended prop columns in an incremental patch. */
  propTailFrom?: number;
  sequence: number;
  shell: WorldShell;
  /** A full copy to compare against the mirror after applying (periodic self check). */
  verify?: PatchLayer[];
  worldId: number;
}

export interface CapturedPatch {
  /** Why the patch is a keyframe; absent for an incremental patch. */
  keyframeReason?: string;
  patch: WorldPatch;
  transfer: ArrayBuffer[];
}

/**
 * Every `VERIFY_EVERY`th patch also carries a full copy for the worker to compare (self healing). The copy is the
 * only whole-world work left on the main thread (3-9 ms at 1x, ~4x that on a phone), so release builds run it
 * rarely (about hourly at the 2-minute autosave); development builds and tests keep the dense schedule that
 * catches a writer the journal audit missed (owner decision 2026-11-07).
 */
export const VERIFY_EVERY = import.meta.env?.DEV ? 10 : 30;
export const MIRROR_OUT_OF_SYNC = "The save worker's world mirror is out of sync";

const isProp = (spec: LayerShape) => spec.scope === "prop";
const NON_PROP_LAYERS = MAP_LAYERS.filter(spec => !isProp(spec));
const PROP_COLUMNS = ["form", "phase", "rotation", "scale", "x", "y", "z"] as const;

const layerArrays = (world: WorldData) => MAP_LAYERS.map(spec => spec.get(world));

const worldShell = (world: WorldData): WorldShell => {
  const shell: WorldShell = {};
  for (const [key, value] of Object.entries(world)) {
    if (key === "props" || ArrayBuffer.isView(value) || typeof value === "function") continue;
    shell[key] = value;
  }
  return shell;
};

/** Visits each row run of the chunks in a layer: its offset in the layer, in the packed rows, and its length. */
const forEachChunkRun = (
  spec: LayerShape, size: { cellsX: number; cellsZ: number }, chunks: ArrayLike<number>,
  visit: (layerOffset: number, packedOffset: number, length: number) => void
) => {
  const extra = spec.scope === "vertex" ? 1 : 0;
  const width = size.cellsX + extra, height = size.cellsZ + extra;
  const chunksX = Math.ceil((size.cellsX + 1) / JOURNAL_CHUNK);
  let packed = 0;
  for (let at = 0; at < chunks.length; at++) {
    const chunk = chunks[at]!;
    const fromX = (chunk % chunksX) * JOURNAL_CHUNK, fromZ = Math.floor(chunk / chunksX) * JOURNAL_CHUNK;
    const length = (Math.min(width, fromX + JOURNAL_CHUNK) - fromX) * spec.stride;
    if (length <= 0) continue;
    for (let z = fromZ; z < Math.min(height, fromZ + JOURNAL_CHUNK); z++) {
      visit((z * width + fromX) * spec.stride, packed, length);
      packed += length;
    }
  }
  return packed;
};

const packChunks = (spec: LayerShape, source: LayerArray, size: { cellsX: number; cellsZ: number },
  chunks: Uint32Array): LayerArray => {
  const total = forEachChunkRun(spec, size, chunks, () => undefined);
  const packed = new (source.constructor as new (length: number) => LayerArray)(total);
  forEachChunkRun(spec, size, chunks, (layerOffset, packedOffset, length) =>
    packed.set(source.subarray(layerOffset, layerOffset + length), packedOffset));
  return packed;
};

/** Copies the packed chunk rows into the layer. */
const unpackChunks = (spec: LayerShape, target: LayerArray, packed: LayerArray,
  size: { cellsX: number; cellsZ: number }, chunks: Uint32Array) => {
  forEachChunkRun(spec, size, chunks, (layerOffset, packedOffset, length) =>
    target.set(packed.subarray(packedOffset, packedOffset + length), layerOffset));
};

const dirtyChunks = (journal: WorldJournal) => {
  const list = new Uint32Array(journal.dirtyCount);
  let count = 0;
  for (let index = 0; index < journal.dirty.length; index++) if (journal.dirty[index]) list[count++] = index;
  return list;
};

const copyLayers = (world: WorldData): PatchLayer[] => MAP_LAYERS.flatMap(spec => {
  const array = spec.get(world);
  return array ? [{ data: array.slice(), name: spec.name }] : [];
});

/** Why this capture must be a full copy, or null when the journal explains every change. */
const keyframeReason = (world: WorldData, journal: WorldJournal, force: boolean) => {
  if (force) return "forced";
  if (journal.sequence === 0 || journal.propCount < 0) return "first";
  if (journal.epoch !== currentJournalEpoch()) return "worker-lost";
  if (journal.unexplained) return "unexplained";
  if (hasUnexplainedRevisions(journal, world)) return "revision";
  return world.props.count < journal.propCount ? "props-shrunk" : null;
};

interface IncrementalLayers { absent: string[]; full: string[]; layers: PatchLayer[] }

/**
 * The changed part of every layer. A layer the world replaced (the settlement ground clearance and the
 * road grade layers are rebuilt as new arrays) or created is sent whole: no mark describes it.
 */
const incrementalLayers = (world: WorldData, journal: WorldJournal, chunks: Uint32Array): IncrementalLayers => {
  const layers: PatchLayer[] = [], full: string[] = [], absent: string[] = [];
  MAP_LAYERS.forEach((spec, index) => {
    if (isProp(spec)) return;
    const array = spec.get(world);
    if (!array) {
      if (journal.layers[index]) absent.push(spec.name);
      return;
    }
    const replaced = array !== journal.layers[index];
    if (replaced) full.push(spec.name);
    layers.push({ data: replaced ? array.slice() : packChunks(spec, array, world, chunks), name: spec.name });
  });
  const { count, types } = world.props;
  layers.push({ data: types.slice(0, count), name: "props.types" });
  for (const column of PROP_COLUMNS)
    layers.push({ data: world.props[column].slice(journal.propCount, count), name: `props.${column}` });
  return { absent, full, layers };
};

const transferOf = (patch: WorldPatch) => {
  const buffers = [...patch.layers, ...(patch.verify ?? [])].map(layer => layer.data.buffer as ArrayBuffer);
  buffers.push(patch.fog.buffer as ArrayBuffer);
  if (patch.permanentFog) buffers.push(patch.permanentFog.buffer as ArrayBuffer);
  return buffers;
};

/**
 * Takes the journal's marks as a patch for the save worker (main thread, at the tick boundary).
 * Costs copies proportional to the changed chunks, plus the fog and the prop type column; a keyframe
 * copies the whole saved world once. The caller must send the patch: the marks are gone afterwards
 * (a failed send calls `invalidateAllWorldMirrors`).
 */
export const captureWorldPatch = (world: WorldData, options: { forceKeyframe?: boolean } = {}): CapturedPatch | null => {
  const journal = journalOf(world);
  if (!journal) return null;
  const reason = keyframeReason(world, journal, options.forceKeyframe === true);
  const sequence = journal.sequence + 1;
  const keyframe = reason !== null;
  const chunks = keyframe ? undefined : dirtyChunks(journal);
  const verify = !keyframe && sequence % VERIFY_EVERY === 0 ? copyLayers(world) : undefined;
  const changes = keyframe ? undefined : incrementalLayers(world, journal, chunks!);
  const patch: WorldPatch = { absent: changes?.absent, base: keyframe ? null : journal.sequence, chunks,
    fog: world.fog.slice(), full: changes?.full, layers: changes?.layers ?? copyLayers(world),
    permanentFog: world.permanentFog?.slice(), propTailFrom: keyframe ? undefined : journal.propCount,
    sequence, shell: worldShell(world), verify, worldId: journal.id };
  settleJournal(journal, world);
  journal.sequence = sequence;
  journal.epoch = currentJournalEpoch();
  journal.propCount = world.props.count;
  journal.layers = layerArrays(world);
  return { keyframeReason: reason ?? undefined, patch, transfer: transferOf(patch) };
};

/** Marks a world as unsent after a failed save: its next capture is a full copy. */
export const forgetWorldPatches = (world: WorldData) => {
  const journal = journalOf(world);
  if (journal) journal.unexplained = true;
};

// ---- worker side -------------------------------------------------------------------------

interface WorldMirror {
  layers: Map<string, LayerArray>;
  sequence: number;
}

const MIRRORS_KEPT = 2;
const mirrors = new Map<number, WorldMirror>();

const remember = (worldId: number, mirror: WorldMirror) => {
  mirrors.delete(worldId);
  mirrors.set(worldId, mirror);
  while (mirrors.size > MIRRORS_KEPT) mirrors.delete(mirrors.keys().next().value!);
};

/** The worker forgets its mirrors (tests, a restarted session). */
export const clearWorldMirrors = () => mirrors.clear();

const sameLayer = (first: LayerArray, second: LayerArray) => {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index++) if (!Object.is(first[index], second[index])) return false;
  return true;
};

const adoptLayers = (layers: PatchLayer[]) => new Map(layers.map(layer => [layer.name, layer.data]));

const applyProps = (mirror: WorldMirror, patch: WorldPatch, count: number) => {
  const first = patch.propTailFrom!;
  for (const layer of patch.layers) {
    if (!layer.name.startsWith("props.")) continue;
    const column = layer.name === "props.types" ? layer.data : undefined;
    if (column) { mirror.layers.set("props.types", column); continue; }
    const current = mirror.layers.get(layer.name)!;
    if (!layer.data.length && current.length === count) continue;
    const target = new (current.constructor as new (length: number) => LayerArray)(count);
    target.set(current.subarray(0, Math.min(first, count)));
    target.set(layer.data, first);
    mirror.layers.set(layer.name, target);
  }
};

const applyIncremental = (mirror: WorldMirror, patch: WorldPatch, size: { cellsX: number; cellsZ: number }) => {
  const chunks = patch.chunks!, full = new Set(patch.full);
  for (const name of patch.absent ?? []) mirror.layers.delete(name);
  for (const layer of patch.layers) {
    const spec = NON_PROP_LAYERS.find(entry => entry.name === layer.name);
    if (!spec) continue;
    if (full.has(layer.name)) { mirror.layers.set(layer.name, layer.data); continue; }
    const target = mirror.layers.get(layer.name);
    if (!target) throw new Error(MIRROR_OUT_OF_SYNC);
    unpackChunks(spec, target, layer.data, size, chunks);
  }
  const first = patch.propTailFrom!;
  const count = patch.layers.find(layer => layer.name === "props.types")!.data.length;
  if (mirror.layers.get("props.types")!.length !== first) throw new Error(MIRROR_OUT_OF_SYNC);
  applyProps(mirror, patch, count);
};

const compareWithVerify = (mirror: WorldMirror, verify: PatchLayer[]) => {
  const wrong: string[] = [];
  for (const layer of verify) {
    const have = mirror.layers.get(layer.name);
    if (!have || !sameLayer(have, layer.data)) wrong.push(layer.name);
  }
  return wrong;
};

/** The mirror's layers as a world the map writer reads (the patch's shell and fog around them). */
const mirrorWorld = (mirror: WorldMirror, patch: WorldPatch): WorldData => {
  const world: Record<string, unknown> = { ...patch.shell, fog: patch.fog, permanentFog: patch.permanentFog };
  const props: Record<string, unknown> = { count: mirror.layers.get("props.types")!.length };
  for (const [name, data] of mirror.layers) {
    if (name.startsWith("props.")) props[name.slice(6)] = data;
    else world[name] = data;
  }
  world.props = props as unknown as PropSet;
  return world as unknown as WorldData;
};

export interface AppliedPatch {
  /** Layers where the periodic self check found the mirror differing from the live world (healed). */
  healed: string[];
  world: WorldData;
}

/**
 * Applies a patch to the worker's mirror and returns the mirrored world. Throws `MIRROR_OUT_OF_SYNC`
 * when an incremental patch does not follow the mirror's last sequence.
 */
export const applyWorldPatch = (patch: WorldPatch): AppliedPatch => {
  const size = patch.shell as unknown as { cellsX: number; cellsZ: number };
  if (patch.base === null) {
    const mirror = { layers: adoptLayers(patch.layers), sequence: patch.sequence };
    remember(patch.worldId, mirror);
    return { healed: [], world: mirrorWorld(mirror, patch) };
  }
  const mirror = mirrors.get(patch.worldId);
  if (!mirror || mirror.sequence !== patch.base) throw new Error(MIRROR_OUT_OF_SYNC);
  applyIncremental(mirror, patch, size);
  mirror.sequence = patch.sequence;
  const healed = patch.verify ? compareWithVerify(mirror, patch.verify) : [];
  if (healed.length) for (const layer of patch.verify!) mirror.layers.set(layer.name, layer.data);
  return { healed, world: mirrorWorld(mirror, patch) };
};
