import { isMountedPointSurelyClear } from "./mounted-clearance-fast-path";
import {
  type CorridorEdgeRead,
  freshNavigationStamp,
  haloRect,
  invalidateNavigationIfGlobal,
  isNavigationRegionFresh,
  navigationJournalWork,
  navigationRevisionNow,
  recordCorridorEdgeRead,
  shouldVerifyNavigationReuse
} from "./navigation-change-journal";
import {
  buildingNavigationRevision, hasBuildingNavigationNearby, navigationSearchMemo
} from "./settlement-building-navigation";
import {
  isGroundSegmentClear, isMountedGroundSegmentClear, isMountedNavigationClear, isNavigationClear
} from "./settlement-navigation";
import { createTransientMap } from "./settlement-transient-state";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

const OFFSETS = [[0, 0], [.3, 0], [-.3, 0], [0, .3], [0, -.3], [.3, .3], [-.3, -.3], [.3, -.3], [-.3, .3]] as const;
/**
 * The tile representative shared with ordinary corridor standing points (off-centre yards included):
 * the first clear offset in `OFFSETS` order, undefined when none is. The point predicates are pure,
 * so stopping at the first clear one answers as testing them all would.
 */
const searchStandingPoint = (context: SettlementContext, point: SettlementPoint, mounted: boolean) => {
  for (const [dx, dz] of OFFSETS) {
    const candidate = { x: point.x + dx, z: point.z + dz };
    // Where a horse surely fits, the walker's test passes too (the horse's test includes it).
    if (mounted && isMountedPointSurelyClear(context, candidate)) return candidate;
    if (isNavigationClear(context, candidate) && (!mounted || isMountedNavigationClear(context, candidate)))
      return candidate;
  }
  return undefined;
};
/** Memo slot: a tile centre's standing point within one navigation search (every edge of a tile asks). */
const STANDING_POINTS = {};
const isTileCentre = (point: SettlementPoint) =>
  point.x === Math.floor(point.x) + .5 && point.z === Math.floor(point.z) + .5;
export const firstCorridorStandingPoint = (context: SettlementContext, point: SettlementPoint, mounted: boolean) => {
  const memo = isTileCentre(point)
    ? navigationSearchMemo(context, STANDING_POINTS, () => new Map<number, SettlementPoint | undefined>())
    : undefined;
  if (!memo) return searchStandingPoint(context, point, mounted);
  const key = ((point.z - .5) * context.options.world.cellsX + point.x - .5) * 2 + (mounted ? 1 : 0);
  if (memo.has(key)) return memo.get(key);
  const standing = searchStandingPoint(context, point, mounted);
  memo.set(key, standing);
  return standing;
};

/** One direction's value: the segment test samples its end but not its start, so it may differ. */
interface EdgeSide {
  clear: boolean;
  stamp: number;
}
/**
 * One edge for both directions, as before A03: within an epoch the first read decides `clear` for
 * both. Each direction's value is kept apart, so a later epoch reuses only the direction it reads.
 */
interface EdgeEntry {
  clear: boolean;
  epoch: number;
  /** [forward (from the lexically smaller end), backward]. */
  sides: [EdgeSide | null, EdgeSide | null];
  stamp: number;
}
interface EdgeStore {
  edges: Map<string, EdgeEntry>;
  epoch: number;
  key: string;
}
/** Beyond this many edges a boundary starts empty again (about 5 MB; no epoch value is lost). */
const EDGE_LIMIT = 1 << 15;
const edgeStores = createTransientMap<EdgeStore>();

interface EdgeKeyParts { build: number; buildings: string; decorations: number; props: number; value: string }
const edgeKeys = new WeakMap<SettlementContext, EdgeKeyParts>();
/** The pre-A03 cache key, kept as the epoch boundary; equal parts return the same string. */
const edgeRevision = (context: SettlementContext) => {
  const { world } = context.options;
  const buildings = buildingNavigationRevision(context), build = world.buildRevision ?? 0;
  const props = world.props.count, decorations = context.roadDecorations?.revision() ?? 0;
  const previous = edgeKeys.get(context);
  if (previous && previous.build === build && previous.props === props &&
    previous.decorations === decorations && previous.buildings === buildings) return previous.value;
  const value = `${buildings}|${build}:${props}:${decorations}`;
  edgeKeys.set(context, { build, buildings, decorations, props, value });
  return value;
};
const edgeStore = (context: SettlementContext) => {
  const key = edgeRevision(context), store = edgeStores.get(context);
  if (!store) {
    const created = { edges: new Map<string, EdgeEntry>(), epoch: 1, key };
    edgeStores.set(context, created);
    return created;
  }
  if (store.key === key) return store;
  store.key = key;
  store.epoch++;
  if (store.edges.size > EDGE_LIMIT) store.edges.clear();
  invalidateNavigationIfGlobal(context);
  return store;
};

const computeEdgeClear = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint, mounted: boolean) => {
  const start = firstCorridorStandingPoint(context, from, mounted);
  const end = start && firstCorridorStandingPoint(context, to, mounted);
  // One consistent representative per cell prevents separate sides of a fence from being
  // connected through different incoming/outgoing offsets in that same coarse tile.
  if (!start || !end) return false;
  return mounted ? isMountedGroundSegmentClear(context, start, end) : isGroundSegmentClear(context, start, end);
};
const edgeRect = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint) => {
  const fromX = Math.floor(from.x), fromZ = Math.floor(from.z), toX = Math.floor(to.x), toZ = Math.floor(to.z);
  return haloRect(context, Math.min(fromX, toX), Math.min(fromZ, toZ), Math.max(fromX, toX), Math.max(fromZ, toZ));
};
interface EdgeQuery { forward: boolean; from: SettlementPoint; key: string; mounted: boolean; to: SettlementPoint }
/** The value this direction has now: its stored one while its region is unchanged, else a new one. */
const freshSide = (context: SettlementContext, side: EdgeSide | null, query: EdgeQuery): EdgeSide => {
  const { from, key, mounted, to } = query, rect = edgeRect(context, from, to);
  if (side && isNavigationRegionFresh(context, rect, side.stamp)) {
    if (shouldVerifyNavigationReuse() && computeEdgeClear(context, from, to, mounted) !== side.clear)
      throw new Error(`Stale corridor edge ${key}: kept ${side.clear} across a navigation change`);
    navigationJournalWork.edgeKeeps++;
    side.stamp = navigationRevisionNow(context);
    return side;
  }
  navigationJournalWork.edgeComputes++;
  const stamp = freshNavigationStamp(context, rect);
  return { clear: computeEdgeClear(context, from, to, mounted), stamp };
};
/** The first read of an edge in this epoch decides its value for the epoch (both directions). */
const firstEdgeRead = (context: SettlementContext, store: EdgeStore, query: EdgeQuery) => {
  const entry = store.edges.get(query.key), direction = query.forward ? 0 : 1;
  const side = freshSide(context, entry?.sides[direction] ?? null, query);
  if (!entry) {
    const created: EdgeEntry = { clear: side.clear, epoch: store.epoch, sides: [null, null], stamp: side.stamp };
    created.sides[direction] = side;
    store.edges.set(query.key, created);
    return created;
  }
  entry.sides[direction] = side;
  entry.clear = side.clear;
  entry.epoch = store.epoch;
  entry.stamp = side.stamp;
  return entry;
};
const cellOf = (context: SettlementContext, point: SettlementPoint) =>
  Math.floor(point.z) * context.options.world.cellsX + Math.floor(point.x);
const storedEdgeClear = (context: SettlementContext, store: EdgeStore, query: EdgeQuery) => {
  const known = store.edges.get(query.key);
  const entry = known?.epoch === store.epoch ? known : firstEdgeRead(context, store, query);
  recordCorridorEdgeRead(query.key, { clear: entry.clear, forward: query.forward,
    from: cellOf(context, query.from), to: cellOf(context, query.to) }, entry.stamp);
  return entry.clear;
};

/** Public cells on opposite sides of a thin wall are not a connected flow-field edge. */
export const isBuildingCorridorEdgeClear = (context: SettlementContext, from: SettlementPoint,
  to: SettlementPoint, mounted: boolean) => {
  if (!hasBuildingNavigationNearby(context, from) && !hasBuildingNavigationNearby(context, to)) return true;
  const store = edgeStore(context);
  const first = `${from.x}:${from.z}`, second = `${to.x}:${to.z}`;
  const key = `${mounted ? 1 : 0}:${first < second ? `${first}/${second}` : `${second}/${first}`}`;
  return storedEdgeClear(context, store, { forward: first < second, from, key, mounted, to });
};

const keyPoint = (text: string) => {
  const [x, z] = text.split(":");
  return { x: Number(x), z: Number(z) };
};
/** The edge between two tile centres, from its key ("mounted:x:z/x:z", lexically smaller end first). */
const edgeQuery = (key: string, forward: boolean): EdgeQuery => {
  const [smaller, larger] = key.slice(2).split("/").map(keyPoint);
  return { forward, from: forward ? smaller! : larger!, key, mounted: key[0] === "1", to: forward ? larger! : smaller! };
};
/**
 * A flow field kept or shared at a boundary stands in for the rebuild that would read these edges
 * now: each takes its first read of this epoch in the recorded direction (`fieldStamp`: the field is
 * fresh since then, so a direction stamped after it is still fresh). An edge near a changed block
 * (`isDirty`, either end) is read for real. False when an edge now answers other than the field read
 * it (the field must be rebuilt).
 */
export const touchCorridorEdges = (context: SettlementContext, edges: ReadonlyMap<string, CorridorEdgeRead>,
  fieldStamp: number, isDirty: ((tile: number) => boolean) | null) => {
  const store = edgeStore(context), now = navigationRevisionNow(context);
  for (const [key, read] of edges) {
    const entry = store.edges.get(key), side = entry?.sides[read.forward ? 0 : 1];
    const dirty = isDirty !== null && (isDirty(read.from) || isDirty(read.to));
    if (!dirty && entry?.epoch === store.epoch) {
      if (entry.clear !== read.clear) return false;
      continue;
    }
    if (!dirty && entry && side && side.stamp >= fieldStamp) {
      if (side.clear !== read.clear) return false;
      side.stamp = now;
      entry.clear = side.clear; entry.epoch = store.epoch; entry.stamp = now;
      continue;
    }
    if (storedEdgeClear(context, store, edgeQuery(key, read.forward)) !== read.clear) return false;
  }
  return true;
};
