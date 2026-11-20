import { type TileRect, worldNavigationEpoch } from "./navigation-change-log";
import type { PropSet, WorldData } from "./world-data";

/**
 * Prop indices bucketed by the grid cell they stand on (counting sort, index order per cell), for
 * one kind of prop (`accepts` the type at insertion; callers filter the live type and state at query
 * time). The index is keyed by the navigation epoch (S12, A03 part b): explained changes (felling,
 * stump removal, planting, boulders) never rebuild it, an unexplained world counter move does.
 * Props appended since the build wait in a per-cell overflow in index order, so a query visits every
 * cell's props in the order a cold build would, and a bounded number of appends costs no rebuild.
 */
interface PropCellIndex {
  epoch: number;
  /** Prop indices below this are in the CSR arrays. */
  indexed: number;
  /** Prop indices, cell by cell. */
  indices: Uint32Array;
  /** Props appended after the build, per cell in index order. */
  overflow: Map<number, number[]>;
  overflowCount: number;
  /** Props examined so far (CSR plus overflow). */
  seen: number;
  /** Where each cell's run starts in `indices` (cells + 1 entries). */
  starts: Uint32Array;
}

/** Beyond this many appended props the next query rebuilds the CSR arrays. */
const OVERFLOW_LIMIT = 4096;
const EMPTY: readonly number[] = [];

/** Deterministic work counters (diagnostics and tests; never saved). */
export const propIndexWork = { appends: 0, builds: 0 };

const cellOf = (world: WorldData, x: number, z: number) => {
  const column = Math.min(world.cellsX - 1, Math.max(0, Math.floor(x)));
  const row = Math.min(world.cellsZ - 1, Math.max(0, Math.floor(z)));
  return row * world.cellsX + column;
};

type PropVisitor = (index: number) => boolean;
type TypeFilter = (type: number) => boolean;

const buildIndex = (world: WorldData, accepts: TypeFilter): PropCellIndex => {
  const { props } = world, starts = new Uint32Array(world.cellsX * world.cellsZ + 1);
  let accepted = 0;
  for (let index = 0; index < props.count; index++) {
    if (!accepts(props.types[index]!)) continue;
    starts[cellOf(world, props.x[index]!, props.z[index]!) + 1]!++;
    accepted++;
  }
  for (let cell = 1; cell < starts.length; cell++) starts[cell]! += starts[cell - 1]!;
  const next = starts.slice(0, -1), indices = new Uint32Array(accepted);
  for (let index = 0; index < props.count; index++) {
    if (!accepts(props.types[index]!)) continue;
    indices[next[cellOf(world, props.x[index]!, props.z[index]!)]!++] = index;
  }
  propIndexWork.builds++;
  return { epoch: worldNavigationEpoch(world), indexed: props.count, indices, overflow: new Map(),
    overflowCount: 0, seen: props.count, starts };
};

/** Files the props appended since the index last looked (in index order per cell). */
const appendProps = (world: WorldData, index: PropCellIndex, accepts: TypeFilter) => {
  const { props } = world;
  for (let prop = index.seen; prop < props.count; prop++) {
    if (!accepts(props.types[prop]!)) continue;
    const cell = cellOf(world, props.x[prop]!, props.z[prop]!), list = index.overflow.get(cell);
    if (list) list.push(prop);
    else index.overflow.set(cell, [prop]);
    index.overflowCount++;
  }
  propIndexWork.appends += props.count - index.seen;
  index.seen = props.count;
};

const registry: WeakMap<PropSet, PropCellIndex>[] = [];

/** One cell-bucketed index over the props whose type `accepts`. */
export const createPropCellIndex = (accepts: TypeFilter) => {
  const indexes = new WeakMap<PropSet, PropCellIndex>();
  registry.push(indexes);
  /** The index as of now: kept while the epoch holds and no prop was removed from the set. */
  const current = (world: WorldData) => {
    const epoch = worldNavigationEpoch(world), cached = indexes.get(world.props);
    const stale = !cached || cached.epoch !== epoch || cached.seen > world.props.count ||
      cached.overflowCount > OVERFLOW_LIMIT;
    if (stale) {
      const built = buildIndex(world, accepts);
      indexes.set(world.props, built);
      return built;
    }
    if (cached.seen < world.props.count) appendProps(world, cached, accepts);
    return cached;
  };
  const someInCell = (index: PropCellIndex, cell: number, visit: PropVisitor) => {
    const { indices, starts } = index;
    for (let slot = starts[cell]!; slot < starts[cell + 1]!; slot++) if (visit(indices[slot]!)) return true;
    for (const prop of index.overflow.get(cell) ?? EMPTY) if (visit(prop)) return true;
    return false;
  };
  /**
   * Calls `visit` for every indexed prop standing in the cells of `rect` (clamped to the world), cell
   * by cell in index order. Stops at the first `visit` returning true and returns whether one did.
   */
  const someInRect = (world: WorldData, rect: TileRect, visit: PropVisitor) => {
    const index = current(world);
    const minX = Math.max(0, rect.minX), maxX = Math.min(world.cellsX - 1, rect.maxX);
    const minZ = Math.max(0, rect.minZ), maxZ = Math.min(world.cellsZ - 1, rect.maxZ);
    for (let row = minZ; row <= maxZ; row++)
      for (let cell = row * world.cellsX + minX; cell <= row * world.cellsX + maxX; cell++)
        if (someInCell(index, cell, visit)) return true;
    return false;
  };
  return {
    /** The props of one cell (index order). */
    someInCell: (world: WorldData, cell: number, visit: PropVisitor) => someInCell(current(world), cell, visit),
    someInRect
  };
};

const allProps = createPropCellIndex(() => true);

/**
 * Calls `visit` for every prop whose cell lies within `radius` cells of (x, z) (a superset of the
 * props within `radius`, so callers keep their exact distance test). Stops at the first `visit`
 * returning true and returns whether one did.
 */
export const somePropNear = (world: WorldData, x: number, z: number, radius: number, visit: PropVisitor) =>
  allProps.someInRect(world, { maxX: Math.floor(x + radius), maxZ: Math.floor(z + radius),
    minX: Math.floor(x - radius), minZ: Math.floor(z - radius) }, visit);

/** Calls `visit` for every prop standing in `cell` (index order); true when one returned true. */
export const somePropInCell = (world: WorldData, cell: number, visit: PropVisitor) =>
  allProps.someInCell(world, cell, visit);

/** Stable IDs can move in place; invalidate before any query in the same edit transaction. */
export const invalidatePropCellIndex = (world: WorldData) => {
  for (const indexes of registry) indexes.delete(world.props);
};
