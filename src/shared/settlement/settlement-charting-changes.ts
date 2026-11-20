import { navigationInvalidation } from "./navigation-change-journal";
import {
  captureChartingGrids, chartingGridChanges, type ChartingGridSnapshot, type MarkChangedTiles
} from "./settlement-charting-grid-changes";
import {
  captureChartingObjects, chartingObjectChanges, type ChartingObjectSnapshot
} from "./settlement-charting-object-changes";
import type { SettlementContext } from "./settlement-types";

export interface ChartingChangeBounds { minX: number; minZ: number; maxX: number; maxZ: number }

/** Changed tiles are reported per block: few bounds for the renewal, at most 7 tiles wider. */
const CHANGE_BLOCK = 8;

/** Inputs whose change renews every proof: map shape, stored spots, nation and adventure camps. */
interface ChartingIdentity {
  /** Adventure camp layout; without camps (a reload moves the revision) there is nothing to read. */
  camps: string;
  cellsX: number;
  cellsZ: number;
  nation: string;
  playableIslands: unknown;
  seaLevel: number;
}
interface ChartingSnapshot {
  grids: ChartingGridSnapshot;
  identity: ChartingIdentity;
  objects: ChartingObjectSnapshot;
}

const campIdentity = (context: SettlementContext) => {
  const count = context.adventure?.campCount?.() ?? 0;
  return count ? `${count}:${context.adventure?.campRevision?.() ?? 0}` : "";
};
const identityOf = (context: SettlementContext): ChartingIdentity => {
  const { world } = context.options;
  return { camps: campIdentity(context), cellsX: world.cellsX, cellsZ: world.cellsZ,
    nation: context.playerNation ?? "roman", playableIslands: world.playableIslands, seaLevel: world.seaLevel };
};
const sameIdentity = (first: ChartingIdentity, second: ChartingIdentity) =>
  (Object.keys(first) as (keyof ChartingIdentity)[]).every(key => first[key] === second[key]);

/** Collects marked tile rectangles as distinct blocks, clamped to the world. */
const createBlockCollector = (cellsX: number, cellsZ: number) => {
  const blocksX = Math.ceil(cellsX / CHANGE_BLOCK), blocks = new Set<number>();
  const lastX = blocksX - 1, lastZ = Math.ceil(cellsZ / CHANGE_BLOCK) - 1;
  const block = (tile: number, last: number) => Math.min(last, Math.max(0, Math.floor(tile / CHANGE_BLOCK)));
  const mark: MarkChangedTiles = (minX, minZ, maxX, maxZ) => {
    for (let z = block(minZ, lastZ); z <= block(maxZ, lastZ); z++)
      for (let x = block(minX, lastX); x <= block(maxX, lastX); x++) blocks.add(z * blocksX + x);
  };
  const bounds = (): ChartingChangeBounds[] => [...blocks].map(id => {
    const x = id % blocksX, z = Math.floor(id / blocksX);
    return { maxX: Math.min(cellsX - 1, (x + 1) * CHANGE_BLOCK - 1),
      maxZ: Math.min(cellsZ - 1, (z + 1) * CHANGE_BLOCK - 1), minX: x * CHANGE_BLOCK, minZ: z * CHANGE_BLOCK };
  });
  return { bounds, mark };
};

/**
 * HARBOUR-RECHECK: where the inputs of harbour charting proofs changed since the last `mark` (null:
 * unknown, so every proof must be renewed). The mark keeps copies of everything a proof reads (grid
 * values, props, buildings, roads and bridges, decorations, field sites, boat jetties); the next query
 * compares them, so every edit kind is local without a log of its own: placement, demolition and
 * destruction, roads, decorations, bridges, levelling, tree and crop churn and in-place reloads alike.
 * Unknown: the A03 rollback mode, `findWorkerPath` contexts, a changed map shape, stored harbour spots,
 * nation or adventure camps, water appearing or disappearing, and a change of landmass ownership.
 * Cost: one comparison pass when a query follows a revision move, nothing per tick.
 */
export const createChartingChanges = (context: SettlementContext) => {
  let snapshot: ChartingSnapshot | null = null;

  const changedBounds = (): ChartingChangeBounds[] | null => {
    if (!snapshot || navigationInvalidation().mode === "global" || context.options.findWorkerPath) return null;
    if (!sameIdentity(snapshot.identity, identityOf(context))) return null;
    const { world } = context.options, collector = createBlockCollector(world.cellsX, world.cellsZ);
    if (!chartingGridChanges(context, snapshot.grids, collector.mark)) return null;
    if (!chartingObjectChanges(snapshot.objects, captureChartingObjects(context), collector.mark)) return null;
    return collector.bounds();
  };

  /** Call before validating proofs: a change made while they are computed then counts as later. */
  const mark = () => {
    snapshot = { grids: captureChartingGrids(context, snapshot?.grids ?? null), identity: identityOf(context),
      objects: captureChartingObjects(context) };
  };
  const clear = () => { snapshot = null; };

  return { changedBounds, clear, mark };
};
