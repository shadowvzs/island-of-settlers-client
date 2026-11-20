import {
  changedNavigationBlocks,
  checkWorldNavigationCounters,
  explainWorldNavigationChange,
  invalidateWorldNavigation,
  isWorldNavigationBlockListUnchanged,
  isWorldNavigationRegionUnchanged,
  markNavigationChange,
  NAVIGATION_BLOCK,
  navigationChangeRevision,
  type TileRect
} from "../world/navigation-change-log";
import {
  buildingNavigationReach,
  type BuildingNavigationShape,
  buildingNavigationShape,
  navigationBuildingBlocks,
  sameBuildingNavigationShape,
  withBuildingNavigationSearch
} from "./settlement-building-navigation";
import { createTransientMap } from "./settlement-transient-state";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * Context side of the A03 navigation change journal (docs/plans/a03-navigation-invalidation-2026-11-07.md).
 * Building stock, completion and level changes are found by comparing each building's navigation
 * shape (its stock volumes, not its counts) with the last one seen, and mark the building's index
 * reach. Context counters (navigation, camp and decoration revisions, nation, building list,
 * occupancy array) that move outside an explained change invalidate everything.
 */

/** Tiles round a read point its answer may depend on: trunk/boulder buckets reach ceil(1.2 + 1.05). */
export const NAVIGATION_HALO = 3;

export type NavigationInvalidationMode = "global" | "local";
export interface NavigationInvalidationSettings {
  /** "global": every cache boundary invalidates everything (the pre-A03 behaviour, rollback). */
  mode: NavigationInvalidationMode;
  /** Every reused value is recomputed and compared; a stale one throws (tests). */
  strict: boolean;
}
let settings: NavigationInvalidationSettings = { mode: "local", strict: false };
export const navigationInvalidation = (): Readonly<NavigationInvalidationSettings> => settings;
/** Returns the previous settings so a caller can restore them. */
export const setNavigationInvalidation = (next: Partial<NavigationInvalidationSettings>) => {
  const previous = settings;
  settings = { ...settings, ...next };
  return previous;
};
/**
 * Deterministic work counters of the journal and its caches (diagnostics and tests; never saved).
 * `*Builds`/`*Computes`: values recomputed; `*Keeps`: values kept across a boundary.
 */
export const navigationJournalWork = {
  buildingChanges: 0,
  campInvalidations: 0,
  contextInvalidations: 0,
  edgeComputes: 0,
  edgeKeeps: 0,
  fieldBuilds: 0,
  fieldKeeps: 0,
  /** Of the kept fields, those confirmed by re-reading the inputs of changed blocks (A03b). */
  fieldRereads: 0,
  fieldShares: 0,
  riderComputes: 0,
  riderKeeps: 0,
  worldInvalidations: 0
};
/** Development builds (vitest) verify every `DEV_VERIFY_EVERY`-th reuse even when not strict. */
const DEV_VERIFY_EVERY = import.meta.env?.DEV ? 32 : 0;
let reuses = 0;
/** Also restarts the development reuse sampling, so a test's reuse count never depends on earlier files. */
export const resetNavigationJournalWork = () => {
  for (const key of Object.keys(navigationJournalWork) as (keyof typeof navigationJournalWork)[])
    navigationJournalWork[key] = 0;
  reuses = 0;
};
/** True when this reuse is recomputed and compared. */
export const shouldVerifyNavigationReuse = () =>
  settings.strict || (DEV_VERIFY_EVERY > 0 && ++reuses % DEV_VERIFY_EVERY === 0);

interface ContextCounters {
  buildingCount: number;
  buildings: readonly SettlementBuilding[];
  camps: number;
  campRevision: number;
  decorations: number;
  nation: string;
  navigation: number;
  occupied: Uint8Array;
}
interface ShapeRecord { session: number; shape: BuildingNavigationShape }
interface ContextJournal {
  active: boolean;
  checkedSession: number;
  counters: ContextCounters;
  depth: number;
  /** `activeNavigationSession` of the open session. */
  serial: number;
  session: number;
  shapes: WeakMap<SettlementBuilding, ShapeRecord>;
  worldBuild: number;
  worldProps: number;
  worldTerrain: number;
}

const countersOf = (context: SettlementContext): ContextCounters => ({
  buildingCount: context.buildings.length, buildings: context.buildings,
  camps: context.adventure?.campCount?.() ?? 0, campRevision: context.adventure?.campRevision?.() ?? 0,
  decorations: context.roadDecorations?.revision() ?? 0, nation: context.playerNation ?? "roman",
  navigation: context.navigationRevision ?? 0, occupied: context.occupied
});
const sameCounters = (first: ContextCounters, second: ContextCounters) =>
  first.navigation === second.navigation && first.buildings === second.buildings &&
  first.buildingCount === second.buildingCount && first.occupied === second.occupied &&
  first.nation === second.nation && first.decorations === second.decorations &&
  first.campRevision === second.campRevision && first.camps === second.camps;

const journals = createTransientMap<ContextJournal>();
const journalOf = (context: SettlementContext) => {
  let journal = journals.get(context);
  if (journal) return journal;
  const { world } = context.options;
  journal = { active: false, checkedSession: 0, counters: countersOf(context), depth: 0, serial: 0, session: 1,
    shapes: new WeakMap(), worldBuild: world.buildRevision ?? 0, worldProps: world.props.count,
    worldTerrain: world.terrainRevision ?? 0 };
  journals.set(context, journal);
  // A new journal (first use, or a load replaced the transient state) knows no earlier shape or
  // counter: values kept from before are stale unless an epoch already froze them.
  invalidateWorldNavigation(world);
  return journal;
};
/** Outermost sessions opened on any context so far: a session's serial is never reused. */
let sessionSerial = 0;
const sessionOf = (journal: ContextJournal) => journal.active ? journal.session : ++journal.session;

/**
 * One synchronous navigation operation (a search, a flood step, a field build): nothing the
 * predicates read changes inside it, so each building and counter is checked once, and the
 * building point queries reuse one geometry snapshot (prepared clearances, per-bucket volumes).
 */
export const withNavigationSession = <Result>(context: SettlementContext, run: () => Result): Result => {
  const journal = journalOf(context);
  if (journal.active) return run();
  journal.session++;
  journal.serial = ++sessionSerial;
  journal.active = true;
  try {
    return withBuildingNavigationSearch(context, run);
  } finally {
    journal.active = false;
  }
};

/** The open session's serial (unique across contexts and journal resets), 0 outside every session. */
export const activeNavigationSession = (context: SettlementContext) => {
  const journal = journalOf(context);
  return journal.active ? journal.serial : 0;
};

/** Camp layouts follow the whole world and building list, so with camps any world change is global. */
const checkCampWorld = (context: SettlementContext, journal: ContextJournal) => {
  const { world } = context.options;
  const build = world.buildRevision ?? 0, props = world.props.count, terrain = world.terrainRevision ?? 0;
  if (build === journal.worldBuild && props === journal.worldProps && terrain === journal.worldTerrain) return;
  journal.worldBuild = build; journal.worldProps = props; journal.worldTerrain = terrain;
  if (journal.counters.camps === 0) return;
  navigationJournalWork.campInvalidations++;
  invalidateWorldNavigation(world);
};
const checkContextCounters = (context: SettlementContext, journal: ContextJournal) => {
  const live = countersOf(context);
  if (sameCounters(journal.counters, live)) return;
  journal.counters = live;
  navigationJournalWork.contextInvalidations++;
  invalidateWorldNavigation(context.options.world);
};
const checkCounters = (context: SettlementContext, journal: ContextJournal, session: number) => {
  if (journal.checkedSession === session) return;
  journal.checkedSession = session;
  if (checkWorldNavigationCounters(context.options.world)) navigationJournalWork.worldInvalidations++;
  if (journal.depth === 0) checkContextCounters(context, journal);
  checkCampWorld(context, journal);
};

const refreshBuilding = (context: SettlementContext, journal: ContextJournal, building: SettlementBuilding,
  session: number) => {
  const record = journal.shapes.get(building);
  if (record?.session === session) return;
  const shape = buildingNavigationShape(context, building);
  if (record && sameBuildingNavigationShape(record.shape, shape)) {
    record.session = session;
    return;
  }
  journal.shapes.set(building, { session, shape });
  navigationJournalWork.buildingChanges++;
  markNavigationChange(context.options.world, buildingNavigationReach(context.options.world, building));
};
type BuildingBlocks = ReturnType<typeof navigationBuildingBlocks>["blocks"];
const refreshBuildingsOfBlock = (context: SettlementContext, journal: ContextJournal, blocks: BuildingBlocks,
  block: number, session: number) => {
  for (const building of blocks.get(block) ?? []) refreshBuilding(context, journal, building, session);
};
/** Compares every indexed building that can reach `rect` with the shape it had when last seen. */
const refreshBuildingsIn = (context: SettlementContext, journal: ContextJournal, rect: TileRect,
  session: number) => {
  const { blocks, blocksX } = navigationBuildingBlocks(context);
  const lastX = blocksX - 1, lastZ = Math.ceil(context.options.world.cellsZ / NAVIGATION_BLOCK) - 1;
  const fromX = Math.max(0, Math.floor(rect.minX / NAVIGATION_BLOCK));
  const toX = Math.min(lastX, Math.floor(rect.maxX / NAVIGATION_BLOCK));
  const fromZ = Math.max(0, Math.floor(rect.minZ / NAVIGATION_BLOCK));
  const toZ = Math.min(lastZ, Math.floor(rect.maxZ / NAVIGATION_BLOCK));
  for (let z = fromZ; z <= toZ; z++)
    for (let x = fromX; x <= toX; x++) refreshBuildingsOfBlock(context, journal, blocks, z * blocksX + x, session);
};
const observe = (context: SettlementContext, rect: TileRect) => {
  const journal = journalOf(context), session = sessionOf(journal);
  checkCounters(context, journal, session);
  refreshBuildingsIn(context, journal, rect, session);
};
/** `observe` for a list of journal blocks (ids `z * ceil(cellsX / NAVIGATION_BLOCK) + x`), in one session. */
const observeBlocks = (context: SettlementContext, blockIds: ArrayLike<number>) => {
  const journal = journalOf(context), session = sessionOf(journal);
  checkCounters(context, journal, session);
  const { blocks } = navigationBuildingBlocks(context);
  for (let index = 0; index < blockIds.length; index++)
    refreshBuildingsOfBlock(context, journal, blocks, blockIds[index]!, session);
};

/** Observes `rect` and returns the revision a value computed from it now is fresh as of. */
export const freshNavigationStamp = (context: SettlementContext, rect: TileRect) => {
  observe(context, rect);
  return navigationChangeRevision(context.options.world);
};
/** True while nothing a value stamped `stamp` read in `rect` has changed since. */
export const isNavigationRegionFresh = (context: SettlementContext, rect: TileRect, stamp: number) => {
  observe(context, rect);
  return isWorldNavigationRegionUnchanged(context.options.world, rect, stamp);
};
/**
 * The blocks of `rect` that changed since `stamp` (empty: fresh); null when nothing stamped then can
 * be kept. A value whose reads are known per tile re-reads only the changed blocks (plus the halo).
 */
export const staleNavigationBlocks = (context: SettlementContext, rect: TileRect, stamp: number) => {
  observe(context, rect);
  return changedNavigationBlocks(context.options.world, rect, stamp);
};
/** Observes the listed journal blocks and returns the revision a value computed from them now is fresh as of. */
export const freshNavigationBlocksStamp = (context: SettlementContext, blocks: ArrayLike<number>) => {
  observeBlocks(context, blocks);
  return navigationChangeRevision(context.options.world);
};
/** True while nothing a value stamped `stamp` read in the listed journal blocks has changed since. */
export const areNavigationBlocksFresh = (context: SettlementContext, blocks: ArrayLike<number>, stamp: number) => {
  observeBlocks(context, blocks);
  return isWorldNavigationBlockListUnchanged(context.options.world, blocks, stamp);
};
/** The current change revision (call after `isNavigationRegionFresh` to restamp a reused value). */
export const navigationRevisionNow = (context: SettlementContext) =>
  navigationChangeRevision(context.options.world);
/** A cache boundary in the rollback mode: everything recomputes, exactly as before A03. */
export const invalidateNavigationIfGlobal = (context: SettlementContext) => {
  if (settings.mode === "global") invalidateWorldNavigation(context.options.world);
};

/**
 * Runs a settlement change whose whole navigation effect lies in `rect` (null: none, e.g. a field
 * reservation that only road traffic reads). Counter moves inside it are explained.
 */
export const explainNavigationChange = <Result>(context: SettlementContext, rect: TileRect | null,
  change: () => Result): Result => {
  const journal = journals.get(context);
  if (!journal) return explainWorldNavigationChange(context.options.world, rect, change);
  if (journal.depth === 0) checkContextCounters(context, journal);
  journal.depth++;
  try {
    return explainWorldNavigationChange(context.options.world, rect, change);
  } finally {
    journal.depth--;
    if (journal.depth === 0) journal.counters = countersOf(context);
  }
};

/** A corridor edge as a flow field first read it: its direction, its value and its two tiles. */
export interface CorridorEdgeRead {
  clear: boolean;
  forward: boolean;
  /** World cells of both ends (for the test whether a changed block reaches the edge). */
  from: number;
  to: number;
}
/** A tile box (world tiles `minX`..`minX + width - 1`, same for z). */
export interface TileBox {
  height: number;
  minX: number;
  minZ: number;
  width: number;
}
/** Per box cell: never read, read true, read false. */
export const READ_NONE = 0, READ_TRUE = 1, READ_FALSE = 2;
/**
 * Everything a flow field read while it was built, per tile of its box, and the oldest cache stamp
 * among the reads: the field is fresh as of that stamp. At a boundary only the tiles near a changed
 * block are read again; the field is kept when every read answers as recorded.
 */
export interface NavigationReads {
  box: TileBox;
  cellsX: number;
  edges: Map<string, CorridorEdgeRead>;
  /** `isCellOpen` reads (READ_* per box cell). */
  open: Uint8Array;
  /** Rider tile reads (READ_* per box cell). */
  rider: Uint8Array;
  stamp: number;
  /** The walking cost of every box cell when the field was built. */
  walkCost: Uint8Array;
}
/** A read outside the box cannot be re-read by block: such a field is never kept (stamp below any floor). */
const UNCONFIRMABLE_STAMP = -1;
let reads: NavigationReads | null = null;
export const createNavigationReads = (stamp: number, box: TileBox, cellsX: number): NavigationReads => {
  const size = box.width * box.height;
  return { box, cellsX, edges: new Map(), open: new Uint8Array(size), rider: new Uint8Array(size), stamp,
    walkCost: new Uint8Array(size) };
};
/** Box cell of a world tile (-1 outside the box). */
export const readsCell = ({ box, cellsX }: NavigationReads, tile: number) => {
  const x = tile % cellsX - box.minX, z = Math.floor(tile / cellsX) - box.minZ;
  return x < 0 || z < 0 || x >= box.width || z >= box.height ? -1 : z * box.width + x;
};
/** Collects the open cells, rider tiles and corridor edges `run` reads (a flow field build). */
export const withNavigationReads = <Result>(target: NavigationReads | null, run: () => Result): Result => {
  const previous = reads;
  reads = target;
  try {
    return run();
  } finally {
    reads = previous;
  }
};
const recordTileRead = (values: Uint8Array, tile: number, value: boolean) => {
  const cell = readsCell(reads!, tile);
  if (cell < 0) reads!.stamp = UNCONFIRMABLE_STAMP;
  else values[cell] = value ? READ_TRUE : READ_FALSE;
};
export const recordCellOpenRead = (tile: number, open: boolean) => {
  if (reads) recordTileRead(reads.open, tile, open);
};
export const recordRiderTileRead = (tile: number, clear: boolean, stamp: number) => {
  if (!reads) return;
  recordTileRead(reads.rider, tile, clear);
  if (stamp < reads.stamp) reads.stamp = stamp;
};
export const recordCorridorEdgeRead = (key: string, read: CorridorEdgeRead, stamp: number) => {
  if (!reads) return;
  if (!reads.edges.has(key)) reads.edges.set(key, read);
  if (stamp < reads.stamp) reads.stamp = stamp;
};

/** A tile with `NAVIGATION_HALO` round it, clamped to the world. */
export const haloRect = (context: SettlementContext, minX: number, minZ: number, maxX: number, maxZ: number) => {
  const { cellsX, cellsZ } = context.options.world;
  return { maxX: Math.min(cellsX - 1, maxX + NAVIGATION_HALO), maxZ: Math.min(cellsZ - 1, maxZ + NAVIGATION_HALO),
    minX: Math.max(0, minX - NAVIGATION_HALO), minZ: Math.max(0, minZ - NAVIGATION_HALO) };
};
