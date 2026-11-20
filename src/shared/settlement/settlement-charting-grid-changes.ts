import { BLOCKING, type WorldData } from "../world/world-data";
import type { SettlementContext } from "./settlement-types";

/**
 * HARBOUR-RECHECK: retained copies of the grid inputs of harbour site proofs (terrain, blocking,
 * walkability, build ground, occupancy, props), compared at the next panel query. A changed value
 * marks its tiles; a change that can move the coastline or sea connectivity makes the answer unknown.
 */

type Grid = Uint8Array | Float32Array;
/** Marks the inclusive tile rectangle as changed. */
export type MarkChangedTiles = (minX: number, minZ: number, maxX: number, maxZ: number) => void;

const CELL_GRIDS = ["blocking", "buildCap", "buildClass", "slopeClass", "walkCost"] as const;
const PROP_ARRAYS = ["form", "rotation", "scale", "types", "x", "y", "z"] as const;
/** Bytes compared at once before the differing elements of a word are looked at. */
const WORD_BYTES = 4;
type CellGrid = typeof CELL_GRIDS[number];
type PropArray = typeof PROP_ARRAYS[number];

export interface ChartingGridSnapshot {
  cells: Record<CellGrid, Grid | undefined>;
  heights: Float32Array;
  lakeWater: Uint8Array | undefined;
  occupied: Uint8Array;
  propCount: number;
  props: Partial<Record<PropArray, Grid>>;
}

/** Copies `source` into `previous` when the shapes match (no allocation on later marks). */
const retain = <Value extends Grid>(source: Value | undefined, previous: Grid | undefined): Value | undefined => {
  if (!source) return undefined;
  if (previous?.constructor !== source.constructor || previous.length !== source.length) return source.slice() as Value;
  (previous as Value).set(source as never);
  return previous as Value;
};

const sameShape = (first: Grid | undefined, second: Grid | undefined) =>
  first?.length === second?.length && first?.constructor === second?.constructor;

/** Whole 4-byte words of a typed array whose bytes start 4-aligned, else null (element compare only). */
const words = (grid: Grid) => grid.byteOffset % WORD_BYTES === 0
  ? new Uint32Array(grid.buffer, grid.byteOffset, Math.floor(grid.byteLength / WORD_BYTES)) : null;

const compareElements = (current: Grid, copy: Grid, from: number, to: number, visit: (index: number) => void) => {
  for (let index = from; index < to; index++) if (!Object.is(current[index], copy[index])) visit(index);
};

/** Calls `visit` for every element index whose bits differ (whole words first, then the elements). */
const forEachChange = (current: Grid, copy: Grid, visit: (index: number) => void) => {
  const currentWords = words(current), copyWords = words(copy);
  if (!currentWords || !copyWords) {
    compareElements(current, copy, 0, current.length, visit);
    return;
  }
  const perWord = WORD_BYTES / current.BYTES_PER_ELEMENT;
  for (let word = 0; word < currentWords.length; word++)
    if (currentWords[word] !== copyWords[word])
      compareElements(current, copy, word * perWord, (word + 1) * perWord, visit);
  compareElements(current, copy, currentWords.length * perWord, current.length, visit);
};

const worldCells = (world: WorldData) => world as unknown as Record<CellGrid, Grid | undefined>;
const worldProps = (world: WorldData) => world.props as unknown as Record<PropArray, Grid | undefined>;

export const captureChartingGrids = (context: SettlementContext, previous: ChartingGridSnapshot | null):
  ChartingGridSnapshot => {
  const { world } = context.options, cells = worldCells(world), props = worldProps(world);
  const retained = {} as Record<CellGrid, Grid | undefined>;
  for (const name of CELL_GRIDS) retained[name] = retain(cells[name], previous?.cells[name]);
  const propCopies: Partial<Record<PropArray, Grid>> = {};
  for (const name of PROP_ARRAYS) propCopies[name] = retain(props[name], previous?.props[name]);
  return { cells: retained, heights: retain(world.heights, previous?.heights)!,
    lakeWater: retain(world.lakeWater, previous?.lakeWater), occupied: retain(context.occupied, previous?.occupied)!,
    propCount: world.props.count, props: propCopies };
};

const markCell = (world: WorldData, cell: number, mark: MarkChangedTiles) => {
  const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
  mark(x, z, x, z);
};

/** Cell grids: a value change marks the cell; water appearing or disappearing is unknown. */
const cellGridChanges = (context: SettlementContext, snapshot: ChartingGridSnapshot, mark: MarkChangedTiles) => {
  const { world } = context.options, cells = worldCells(world);
  for (const name of CELL_GRIDS) {
    const current = cells[name], copy = snapshot.cells[name];
    if (!sameShape(current, copy)) return false;
    if (current) forEachChange(current, copy!, cell => markCell(world, cell, mark));
  }
  const blocking = snapshot.cells.blocking;
  let water = false;
  if (blocking) forEachChange(world.blocking, blocking, cell => {
    water ||= world.blocking[cell] === BLOCKING.water || blocking[cell] === BLOCKING.water;
  });
  if (water || !sameShape(context.occupied, snapshot.occupied)) return false;
  forEachChange(context.occupied, snapshot.occupied, cell => markCell(world, cell, mark));
  return true;
};

/**
 * Terrain vertices: only dry ground may move (above the sea before and after), so the sea mask,
 * draft water, landmasses and every submerged depth stay as they were. Lake membership is fixed.
 */
const terrainChanges = (world: WorldData, snapshot: ChartingGridSnapshot, mark: MarkChangedTiles) => {
  if (!sameShape(world.heights, snapshot.heights) || !sameShape(world.lakeWater, snapshot.lakeWater)) return false;
  let lakeChanged = false, wet = false;
  if (world.lakeWater) forEachChange(world.lakeWater, snapshot.lakeWater!, () => { lakeChanged = true; });
  const stride = world.cellsX + 1;
  forEachChange(world.heights, snapshot.heights, vertex => {
    wet ||= world.heights[vertex]! <= world.seaLevel || snapshot.heights[vertex]! <= world.seaLevel;
    const x = vertex % stride, z = Math.floor(vertex / stride);
    mark(x - 1, z - 1, x, z);
  });
  return !lakeChanged && !wet;
};

const markProp = (world: WorldData, x: number, z: number, mark: MarkChangedTiles) => {
  const tileX = Math.floor(x), tileZ = Math.floor(z);
  mark(tileX, tileZ, tileX, tileZ);
};

/** Props: a changed, added or removed prop marks its tile before and after the change. */
const propChanges = (world: WorldData, snapshot: ChartingGridSnapshot, mark: MarkChangedTiles) => {
  const props = worldProps(world), count = world.props.count;
  if (count < snapshot.propCount) return false;
  const changed = new Set<number>();
  for (const name of PROP_ARRAYS) {
    const current = props[name], copy = snapshot.props[name];
    if (!current !== !copy) return false;
    if (!current) continue;
    const shared = Math.min(current.length, copy!.length, snapshot.propCount);
    forEachChange(current.subarray(0, shared), copy!.subarray(0, shared), index => changed.add(index));
  }
  for (let index = snapshot.propCount; index < count; index++) changed.add(index);
  const { x, z } = snapshot.props;
  for (const index of changed) {
    markProp(world, world.props.x[index]!, world.props.z[index]!, mark);
    if (index < snapshot.propCount && x && z) markProp(world, x[index]!, z[index]!, mark);
  }
  return true;
};

/** Marks every grid change since `snapshot`; false when one may have changed the coast or the map shape. */
export const chartingGridChanges = (context: SettlementContext, snapshot: ChartingGridSnapshot,
  mark: MarkChangedTiles) => {
  const { world } = context.options;
  return cellGridChanges(context, snapshot, mark) && terrainChanges(world, snapshot, mark) &&
    propChanges(world, snapshot, mark);
};
