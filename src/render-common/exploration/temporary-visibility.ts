/**
 * EXPLORE-01E presentation-only exploration visibility. The bubble is composed into a private RGBA
 * display-fog buffer; `world.fog`, `world.permanentFog`, `world.fogRevision`, normal viewers and every
 * gameplay fog consumer remain untouched. The only intended consumers are the renderer's live fog
 * texture adapter and renderer-only visual surfaces wired by the coordinator (01G).
 */
import {
  type CellRegion,
  clampRegion,
  EMPTY_REGION,
  expandRegion,
  type GridSize,
  isRegionEmpty
} from "../../shared/world/grid-geometry";
import { FOG, type WorldData } from "../../shared/world/world-data";
import { createVertexFog, type VertexFogWorkspace } from "../chunk-sampling";
import type { ExplorationBubble } from "./exploration-frame";

/** The display texture uses the same clipped 6x6 cell kernel as `createVertexFog`. */
const FOG_BLUR_MARGIN = 3;

/** A renderer-owned composed fog texture; `pixels` is owned by the visibility composer. */
export interface TemporaryVisibilityFrame {
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly revision: number;
  readonly width: number;
}

export interface TemporaryVisibilityUpdate {
  /** Cells whose display pixels this update wrote. */
  readonly cells: number;
  /** The update recomposed the whole texture instead of a bounded bubble region. */
  readonly full: boolean;
  /** Number of bounded regions written by this update. */
  readonly regions: number;
  /** Cells covered by the current bubble mask (never outside the map). */
  readonly revealedCells: number;
}

export interface TemporaryVisibilityStats {
  readonly active: boolean;
  /** Last base `world.fogRevision` the display was composed against. */
  readonly baseRevision: number;
  readonly disposed: boolean;
  readonly fullUpdates: number;
  readonly lastUpdate: TemporaryVisibilityUpdate;
  /** Largest bounded region write; full-texture rebuilds are excluded. */
  readonly maxRegionCells: number;
  readonly regionUpdates: number;
  /** Bubble cells in the current mask, clamped to the map. */
  readonly revealedCells: number;
  readonly revision: number;
  readonly totalCellsWritten: number;
  readonly updates: number;
}

/**
 * The small EXPLORE-01E surface. `setBubble` and `clear` only queue presentation intent; `update`
 * composes pending movement/base changes once. `displayFog` is null while no bubble is active, so the
 * live fog can use its normal base path.
 */
export interface TemporaryVisibility {
  clear: () => void;
  dispose: () => void;
  displayFog: () => TemporaryVisibilityFrame | null;
  revision: () => number;
  setBubble: (bubble: ExplorationBubble | null) => void;
  stats: () => TemporaryVisibilityStats;
  update: () => boolean;
}

/** A cell is revealed when its centre is inside the moving bubble. */
export const explorationBubbleRevealsCell = (
  bubble: Pick<ExplorationBubble, "centerX" | "centerZ" | "radiusCells">,
  x: number,
  z: number
) => {
  if (!Number.isFinite(bubble.centerX) || !Number.isFinite(bubble.centerZ) ||
    !Number.isFinite(bubble.radiusCells)) return false;
  const radius = Math.max(0, bubble.radiusCells);
  const dx = x + 0.5 - bubble.centerX;
  const dz = z + 0.5 - bubble.centerZ;
  return dx * dx + dz * dz <= radius * radius;
};

/**
 * The bounded cell rectangle whose display pixels can change when the bubble moves: the mask disk
 * plus the display blur margin on every side. Used for dirty-region updates and tests.
 */
export const explorationBubbleRegion = (
  grid: Pick<GridSize, "cellsX" | "cellsZ">,
  bubble: Pick<ExplorationBubble, "centerX" | "centerZ" | "radiusCells">
): CellRegion => {
  if (!Number.isFinite(bubble.centerX) || !Number.isFinite(bubble.centerZ) ||
    !Number.isFinite(bubble.radiusCells)) return EMPTY_REGION;
  const radius = Math.max(0, bubble.radiusCells);
  const mask = clampRegion(grid, {
    maxX: Math.ceil(bubble.centerX + radius),
    maxZ: Math.ceil(bubble.centerZ + radius),
    minX: Math.floor(bubble.centerX - radius),
    minZ: Math.floor(bubble.centerZ - radius)
  });
  return expandRegion(grid, mask, FOG_BLUR_MARGIN);
};

/** How many cells the current bubble covers inside the map (diagnostics and tests). */
export const countExplorationBubbleCells = (
  grid: Pick<GridSize, "cellsX" | "cellsZ">,
  bubble: Pick<ExplorationBubble, "centerX" | "centerZ" | "radiusCells">
) => {
  if (!Number.isFinite(bubble.centerX) || !Number.isFinite(bubble.centerZ) ||
    !Number.isFinite(bubble.radiusCells)) return 0;
  const radius = Math.max(0, bubble.radiusCells);
  let count = 0;
  const minX = Math.max(0, Math.floor(bubble.centerX - radius));
  const maxX = Math.min(grid.cellsX - 1, Math.ceil(bubble.centerX + radius));
  const minZ = Math.max(0, Math.floor(bubble.centerZ - radius));
  const maxZ = Math.min(grid.cellsZ - 1, Math.ceil(bubble.centerZ + radius));
  for (let z = minZ; z <= maxZ; z++)
    for (let x = minX; x <= maxX; x++)
      if (explorationBubbleRevealsCell(bubble, x, z)) count++;
  return count;
};

const normalizedBubble = (bubble: ExplorationBubble): ExplorationBubble | null => {
  if (!Number.isFinite(bubble.centerX) || !Number.isFinite(bubble.centerZ) ||
    !Number.isFinite(bubble.radiusCells)) return null;
  return {
    centerX: bubble.centerX,
    centerZ: bubble.centerZ,
    radiusCells: Math.max(0, bubble.radiusCells),
    revision: bubble.revision
  };
};

const sameBubble = (left: ExplorationBubble | null, right: ExplorationBubble | null) =>
  left === right || (left !== null && right !== null &&
    left.centerX === right.centerX && left.centerZ === right.centerZ &&
    left.radiusCells === right.radiusCells);

export const createTemporaryVisibility = (world: WorldData): TemporaryVisibility => {
  const { cellsX, cellsZ } = world;
  const pixels = new Uint8Array(cellsX * cellsZ * 4);
  const vertexCount = (cellsX + 1) * (cellsZ + 1);
  const workspace: VertexFogWorkspace = {
    sums: new Uint32Array(vertexCount),
    vertices: new Float32Array(vertexCount)
  };
  const frame = { height: cellsZ, pixels, revision: 0, width: cellsX };
  let rowA = new Float32Array(0);
  let rowB = new Float32Array(0);
  let current: ExplorationBubble | null = null;
  let pending: ExplorationBubble | null = null;
  let pendingChange = false;
  let initialized = false;
  let baseRevision = world.fogRevision ?? 0;
  let displayRevision = 0;
  let disposed = false;
  const counters = {
    fullUpdates: 0,
    lastCells: 0,
    lastFull: false,
    lastRegions: 0,
    maxRegionCells: 0,
    regionUpdates: 0,
    revealedCells: 0,
    totalCellsWritten: 0,
    updates: 0
  };

  const readBaseRevision = () => world.fogRevision ?? 0;
  const baseChanged = () => readBaseRevision() !== baseRevision;

  const ensureRowCapacity = (width: number) => {
    if (rowA.length >= width) return;
    rowA = new Float32Array(width);
    rowB = new Float32Array(width);
  };

  /**
   * One display vertex, using the same clipped asymmetry as `createVertexFog`: cells
   * [x - 3, x + 2] by [z - 3, z + 2]. Bubble cells are composed at the fog-byte stage so the normal
   * display blur softens the disk exactly like base fog boundaries.
   */
  const writeVertexRow = (
    vertexZ: number,
    minX: number,
    width: number,
    bubble: ExplorationBubble | null,
    target: Float32Array
  ) => {
    if (world.fogDisplayDisabled) {
      target.fill(1, 0, width);
      return;
    }
    const top = Math.max(0, vertexZ - FOG_BLUR_MARGIN);
    const bottom = Math.min(cellsZ, vertexZ + FOG_BLUR_MARGIN);
    for (let index = 0; index < width; index++) {
      const vertexX = minX + index;
      const left = Math.max(0, vertexX - FOG_BLUR_MARGIN);
      const right = Math.min(cellsX, vertexX + FOG_BLUR_MARGIN);
      let sum = 0;
      let samples = 0;
      for (let z = top; z < bottom; z++) {
        const row = z * cellsX;
        for (let x = left; x < right; x++) {
          sum += bubble !== null && explorationBubbleRevealsCell(bubble, x, z)
            ? FOG.visible
            : world.fog[row + x] ?? FOG.hidden;
          samples++;
        }
      }
      target[index] = samples > 0 ? sum / FOG.visible / samples : 0;
    }
  };

  /** Writes the display pixels of one bounded cell rectangle from the current base fog. */
  const writeRegion = (region: CellRegion, bubble: ExplorationBubble | null) => {
    if (isRegionEmpty(region)) return 0;
    const minX = Math.max(0, region.minX);
    const maxX = Math.min(cellsX - 1, region.maxX);
    const minZ = Math.max(0, region.minZ);
    const maxZ = Math.min(cellsZ - 1, region.maxZ);
    if (minX > maxX || minZ > maxZ) return 0;
    const width = maxX - minX + 2;
    ensureRowCapacity(width);
    writeVertexRow(minZ, minX, width, bubble, rowA);
    let source = rowA;
    let target = rowB;
    for (let z = minZ; z <= maxZ; z++) {
      writeVertexRow(z + 1, minX, width, bubble, target);
      for (let x = minX; x <= maxX; x++) {
        const index = x - minX;
        const value = Math.round(
          (source[index]! + source[index + 1]! + target[index]! + target[index + 1]!) * 255 / 4
        );
        const offset = (z * cellsX + x) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
        pixels[offset + 3] = 255;
      }
      const swap = source;
      source = target;
      target = swap;
    }
    return (maxX - minX + 1) * (maxZ - minZ + 1);
  };

  /** Full base rebuild. Only base revisions, activation and clearing pay this cost. */
  const composeBase = () => {
    const vertices = createVertexFog(world, workspace);
    const stride = cellsX + 1;
    for (let z = 0; z < cellsZ; z++)
      for (let x = 0; x < cellsX; x++) {
        const vertex = z * stride + x;
        const value = Math.round(
          (vertices[vertex]! + vertices[vertex + 1]! + vertices[vertex + stride]! +
            vertices[vertex + stride + 1]!) * 255 / 4
        );
        const offset = (z * cellsX + x) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
        pixels[offset + 3] = 255;
      }
    baseRevision = readBaseRevision();
    initialized = true;
    return cellsX * cellsZ;
  };

  const recordUpdate = (full: boolean, regions: number, cells: number) => {
    displayRevision++;
    frame.revision = displayRevision;
    counters.updates++;
    if (full) counters.fullUpdates++;
    else counters.maxRegionCells = Math.max(counters.maxRegionCells, cells);
    counters.regionUpdates += regions;
    counters.totalCellsWritten += cells;
    counters.lastCells = cells;
    counters.lastFull = full;
    counters.lastRegions = regions;
    counters.revealedCells = current ? countExplorationBubbleCells(world, current) : 0;
  };

  const applyPending = () => {
    pendingChange = false;
    const previous = current;
    const next = pending;
    if (sameBubble(previous, next)) {
      current = next;
      return false;
    }
    let full = false;
    let regions = 0;
    let cells = 0;
    if (next === null) {
      // Clearing always rebuilds from the current base: no snapshot is ever restored.
      cells += composeBase();
      full = true;
    } else {
      if (!initialized || baseChanged()) {
        cells += composeBase();
        full = true;
      }
      if (previous !== null && !full) {
        const restored = writeRegion(explorationBubbleRegion(world, previous), null);
        if (restored > 0) {
          cells += restored;
          regions++;
        }
      }
      // Restore first, then compose the new bubble, so overlapping moves cannot leave a trail.
      const written = writeRegion(explorationBubbleRegion(world, next), next);
      if (written > 0) {
        cells += written;
        regions++;
      }
    }
    current = next;
    recordUpdate(full, regions, cells);
    return true;
  };

  const update = () => {
    if (disposed) return false;
    let changed = false;
    if (pendingChange) changed = applyPending();
    // A legitimate Scout/tower/territory write during possession must appear and survive clearing.
    if (current !== null && baseChanged()) {
      let cells = composeBase();
      let regions = 0;
      const written = writeRegion(explorationBubbleRegion(world, current), current);
      if (written > 0) {
        cells += written;
        regions++;
      }
      recordUpdate(true, regions, cells);
      changed = true;
    }
    return changed;
  };

  const setBubble = (bubble: ExplorationBubble | null) => {
    if (disposed) return;
    pending = bubble ? normalizedBubble(bubble) : null;
    pendingChange = true;
  };

  const clear = () => setBubble(null);

  const dispose = () => {
    if (disposed) return;
    const wasActive = current !== null;
    if (wasActive) {
      const cells = composeBase();
      current = null;
      recordUpdate(true, 0, cells);
    }
    disposed = true;
    current = null;
    pending = null;
    pendingChange = false;
  };

  return {
    clear,
    dispose,
    displayFog: () => disposed || current === null ? null : frame,
    revision: () => displayRevision,
    setBubble,
    stats: () => ({
      active: current !== null,
      baseRevision,
      disposed,
      fullUpdates: counters.fullUpdates,
      lastUpdate: {
        cells: counters.lastCells,
        full: counters.lastFull,
        regions: counters.lastRegions,
        revealedCells: counters.revealedCells
      },
      maxRegionCells: counters.maxRegionCells,
      regionUpdates: counters.regionUpdates,
      revealedCells: current ? counters.revealedCells : 0,
      revision: displayRevision,
      totalCellsWritten: counters.totalCellsWritten,
      updates: counters.updates
    }),
    update
  };
};
