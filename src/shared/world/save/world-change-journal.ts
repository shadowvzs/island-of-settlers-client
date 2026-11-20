import type { WorldData } from "../world-data";

/**
 * World change journal (research 12, S06). Every gameplay writer of a saved world layer says which
 * cells it changed, so a save can copy and write only the dirty 32 x 32 chunks instead of the whole
 * map. Anything the journal cannot explain degrades to a full copy, never to a lost edit:
 * - a writer that bumps `buildRevision` / `terrainRevision` through the helpers below is explained;
 *   a direct bump leaves the counter ahead of the journal and the next capture is a full copy;
 * - a layer array that was replaced or appeared, a shrunk prop set, or `markWorldChangedAll` too.
 * The marks cost a WeakMap lookup and a few byte writes; nothing here runs per frame.
 */
export const JOURNAL_CHUNK = 32;

/** Inclusive cell rectangle. */
export interface JournalRect {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

/** What the journal reads of a world (road networks and tests pass narrower world objects). */
export type JournalWorld = Pick<WorldData, "cellsX" | "cellsZ"> &
  Partial<Pick<WorldData, "buildRevision" | "terrainRevision">>;

export interface WorldJournal {
  /** Revision bumps made through the helpers since the last capture. */
  builds: number;
  chunksX: number;
  chunksZ: number;
  /** Capture-time epoch: a lost worker mirror bumps the global epoch and forces a full copy. */
  epoch: number;
  /** Chunks (vertex grid index) marked since the last capture. */
  dirty: Uint8Array;
  dirtyCount: number;
  id: number;
  /** True when something changed that no mark describes: the next capture is a full copy. */
  unexplained: boolean;
  lastBuild: number;
  lastTerrain: number;
  /** The sequence number of the last patch taken (0: none yet). */
  sequence: number;
  terrains: number;
  /** Layer arrays (and their lengths) seen by the last capture; a replaced array is unexplained. */
  layers: (ArrayBufferView | undefined)[];
  propCount: number;
}

const journals = new WeakMap<object, WorldJournal>();
let nextWorldId = 1;
/** Bumped when a patch may not have reached its mirror (worker lost or restarted). */
let globalEpoch = 1;

/** The mirror in the save worker is gone or unknown: every world sends a full copy next. */
export const invalidateAllWorldMirrors = () => { globalEpoch++; };
export const currentJournalEpoch = () => globalEpoch;

const createJournal = (world: JournalWorld): WorldJournal => {
  const chunksX = Math.ceil((world.cellsX + 1) / JOURNAL_CHUNK);
  const chunksZ = Math.ceil((world.cellsZ + 1) / JOURNAL_CHUNK);
  return { builds: 0, chunksX, chunksZ, dirty: new Uint8Array(chunksX * chunksZ), dirtyCount: 0, epoch: 0,
    id: nextWorldId++, lastBuild: world.buildRevision ?? 0, lastTerrain: world.terrainRevision ?? 0,
    layers: [], propCount: -1, sequence: 0, terrains: 0, unexplained: true };
};

/** The journal of a world (created on first use; a new journal starts unexplained: full copy first). */
export const journalOf = (world: JournalWorld): WorldJournal | null => {
  if (!Number.isFinite(world.cellsX) || !Number.isFinite(world.cellsZ)) return null;
  let journal = journals.get(world);
  if (!journal) {
    journal = createJournal(world);
    journals.set(world, journal);
  }
  return journal;
};

const markChunk = (journal: WorldJournal, chunkX: number, chunkZ: number) => {
  const index = chunkZ * journal.chunksX + chunkX;
  if (journal.dirty[index]) return;
  journal.dirty[index] = 1;
  journal.dirtyCount++;
};

/**
 * A writer changed these cells (inclusive, clamped to the world) and the vertices on their corners.
 * Cell layers and vertex layers share one chunk grid; a change at a chunk's last cell marks the
 * neighbour that owns the corner vertex.
 */
export const markWorldChanged = (world: JournalWorld, rect: JournalRect) => {
  const journal = journalOf(world);
  if (!journal) return;
  const minX = Math.max(0, Math.floor(rect.minX)), minZ = Math.max(0, Math.floor(rect.minZ));
  const maxX = Math.min(world.cellsX, Math.floor(rect.maxX) + 1), maxZ = Math.min(world.cellsZ, Math.floor(rect.maxZ) + 1);
  if (maxX < minX || maxZ < minZ) return;
  const lastX = Math.floor(maxX / JOURNAL_CHUNK), lastZ = Math.floor(maxZ / JOURNAL_CHUNK);
  for (let chunkZ = Math.floor(minZ / JOURNAL_CHUNK); chunkZ <= lastZ; chunkZ++)
    for (let chunkX = Math.floor(minX / JOURNAL_CHUNK); chunkX <= lastX; chunkX++) markChunk(journal, chunkX, chunkZ);
};

/** The one cell and its corner vertices. */
export const markWorldCellChanged = (world: JournalWorld, cell: number) => {
  const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
  markWorldChanged(world, { maxX: x, maxZ: z, minX: x, minZ: z });
};

/** A change no region describes (a layer swapped, an undo, a whole-layer copy): next capture is a full copy. */
export const markWorldChangedAll = (world: JournalWorld) => {
  const journal = journalOf(world);
  if (journal) journal.unexplained = true;
};

const markRevisionRegion = (world: JournalWorld, rect: JournalRect | null | undefined) => {
  if (rect === null) return;
  if (rect) markWorldChanged(world, rect);
  else markWorldChangedAll(world);
};

/**
 * `buildRevision` + 1. `rect` is the changed cells; `null` says the bump changes no saved layer (the
 * layer writers mark their own cells); `undefined` (unknown) makes the next capture a full copy.
 */
export const bumpBuildRevision = (world: JournalWorld, rect?: JournalRect | null) => {
  world.buildRevision = (world.buildRevision ?? 0) + 1;
  const journal = journalOf(world);
  if (journal) journal.builds++;
  markRevisionRegion(world, rect);
};

/** `terrainRevision` + 1, with the same `rect` meaning as `bumpBuildRevision`. */
export const bumpTerrainRevision = (world: JournalWorld, rect?: JournalRect | null) => {
  world.terrainRevision = (world.terrainRevision ?? 0) + 1;
  const journal = journalOf(world);
  if (journal) journal.terrains++;
  markRevisionRegion(world, rect);
};

/** True when a revision counter moved by more than the helpers explained (a direct bump). */
export const hasUnexplainedRevisions = (journal: WorldJournal, world: JournalWorld) =>
  (world.buildRevision ?? 0) - journal.lastBuild !== journal.builds ||
  (world.terrainRevision ?? 0) - journal.lastTerrain !== journal.terrains;

/** Forgets the marks after a capture took them. */
export const settleJournal = (journal: WorldJournal, world: JournalWorld) => {
  journal.dirty.fill(0);
  journal.dirtyCount = 0;
  journal.unexplained = false;
  journal.builds = journal.terrains = 0;
  journal.lastBuild = world.buildRevision ?? 0;
  journal.lastTerrain = world.terrainRevision ?? 0;
};
