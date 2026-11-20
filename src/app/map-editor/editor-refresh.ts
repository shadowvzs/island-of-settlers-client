import { refreshCanopyField } from "../../render-common/canopy-field";
import { refreshGroundZoneField } from "../../render-common/ground-zone-field";
import { refreshMineVertexField } from "../../render-common/mine-field";
import type { RendererMapEdit } from "../../render-common/renderer-contract";
import { listRegionChunks } from "../../render-common/terrain-chunks";
import {
  type CellRegion,
  EMPTY_REGION,
  isRegionEmpty,
  unionRegions} from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import type { EditOutcome } from "./editor-apply";

/** While dragging, the renderers rebuild at most this often (ms); the rest is batched. */
const REBUILD_INTERVAL_MS = 60;

/** Rebuild time per flush (ms): the editor's performance numbers (info, Playwright). */
export interface RefreshStats {
  /** Slowest field cover regrowth at a stroke's end (ms). */
  coverMs: number;
  flushes: number;
  lastMs: number;
  maxMs: number;
  totalMs: number;
}

/** What an edit (or its undo / redo) asks to rebuild. */
export type RefreshWork = Pick<
  EditOutcome,
  "cells" | "ground" | "mineStones" | "props" | "removed" | "stoneCells"
>;

interface PendingRefresh {
  cells: CellRegion;
  mineStones: boolean;
  props: boolean;
  removed: number[];
  stoneCells: CellRegion;
}

const createPending = (): PendingRefresh => ({
  cells: EMPTY_REGION,
  mineStones: false,
  props: false,
  removed: [],
  stoneCells: EMPTY_REGION
});

export interface EditRefresherOptions {
  firstPlacedProp: number;
  mapEdit: RendererMapEdit;
  /** The animal homes follow the edited cells (after a stroke). */
  refreshHomes: (cells: CellRegion) => void;
  /** Rebakes the minimap (after a stroke). */
  refreshMinimap: () => void;
  refreshNavigation?: (cells: CellRegion) => void;
  world: WorldData;
}

/**
 * Collects what edits changed and lets the renderer rebuild it in batches: the shared render
 * caches (mine vertex field, canopy shade) of the touched cells, then the touched terrain chunks
 * (and their mine stones), then the placed props. The frame tick flushes at most every
 * REBUILD_INTERVAL_MS; a stroke's end flushes at once, regrows the field cover of the painted
 * ground, rebuilds the animal homes of the edited cells and rebakes the minimap.
 */
export const createEditRefresher = (options: EditRefresherOptions) => {
  const { mapEdit, world } = options;
  let pending = createPending();
  /** Ground painted during the stroke: its field cover regrows when the stroke ends. */
  let coverCells = EMPTY_REGION;
  /** Every cell the stroke edited: the animal homes follow them when the stroke ends. */
  let homeCells = EMPTY_REGION;
  let navigationCells = EMPTY_REGION;
  let lastFlush = 0;
  const stats: RefreshStats = { coverMs: 0, flushes: 0, lastMs: 0, maxMs: 0, totalMs: 0 };

  const rebuild = (work: PendingRefresh) => {
    if (work.mineStones) refreshMineVertexField(world, work.cells);
    const propsChanged = work.props || work.removed.length > 0;
    if (propsChanged) refreshCanopyField(world, work.cells);
    const stonesChanged = !isRegionEmpty(work.stoneCells);
    if (work.removed.length > 0 || stonesChanged)
      mapEdit.removeProps(work.removed, work.stoneCells);
    const chunks = listRegionChunks(world, work.cells);
    if (chunks.length > 0) {
      refreshGroundZoneField(world, work.cells);
      mapEdit.refreshChunks(chunks, work.mineStones);
    }
    if (work.props) mapEdit.refreshPlacedProps(options.firstPlacedProp);
  };

  const flush = () => {
    const work = pending;
    if (isRegionEmpty(work.cells) && !work.props && work.removed.length === 0) return;
    pending = createPending();
    lastFlush = performance.now();
    rebuild(work);
    const spent = performance.now() - lastFlush;
    stats.flushes += 1;
    stats.lastMs = spent;
    stats.maxMs = Math.max(stats.maxMs, spent);
    stats.totalMs += spent;
  };

  const queue = (outcome: RefreshWork) => {
    if (outcome.ground) coverCells = unionRegions(coverCells, outcome.cells);
    if (outcome.ground || outcome.props || outcome.removed.length > 0)
      navigationCells = unionRegions(navigationCells, outcome.cells);
    homeCells = unionRegions(homeCells, outcome.cells);
    pending = {
      cells: unionRegions(pending.cells, outcome.cells),
      mineStones: pending.mineStones || outcome.mineStones,
      props: pending.props || outcome.props,
      removed: [...pending.removed, ...outcome.removed],
      stoneCells: unionRegions(pending.stoneCells, outcome.stoneCells)
    };
  };

  /** Called every frame: flushes the batch once the interval has passed. */
  const tick = () => {
    if (performance.now() - lastFlush >= REBUILD_INTERVAL_MS) flush();
  };

  const finishStroke = () => {
    flush();
    if (!isRegionEmpty(coverCells)) {
      const started = performance.now();
      mapEdit.refreshFieldCover(coverCells);
      stats.coverMs = Math.max(stats.coverMs, performance.now() - started);
    }
    coverCells = EMPTY_REGION;
    options.refreshHomes(homeCells);
    if (!isRegionEmpty(navigationCells)) options.refreshNavigation?.(navigationCells);
    navigationCells = EMPTY_REGION;
    homeCells = EMPTY_REGION;
    options.refreshMinimap();
  };

  /**
   * A terrain edit was applied and its area rebuilt (terrain, rocks): what is left is the props
   * it removed or added, the field cover on the new ground and the minimap.
   */
  const afterTerrain = (batch: { cells: CellRegion; propsChanged: boolean; removed: number[] }) => {
    if (batch.removed.length > 0) mapEdit.removeProps(batch.removed, EMPTY_REGION);
    if (batch.propsChanged) mapEdit.refreshPlacedProps(options.firstPlacedProp);
    const coverStarted = performance.now();
    mapEdit.refreshFieldCover(batch.cells);
    stats.coverMs = Math.max(stats.coverMs, performance.now() - coverStarted);
    options.refreshMinimap();
  };

  return { afterTerrain, finishStroke, queue, stats, tick };
};

export type EditRefresher = ReturnType<typeof createEditRefresher>;
