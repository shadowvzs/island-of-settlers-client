import { isBlockingProp } from "./generation/gameplay";
import type { RoughGround } from "./generation/rough-ground";
import {
  type CellRegion,
  expandRegion,
  forEachRegionCell,
  getCellCount,
  getCellsRegion,
  type GridSize
} from "./grid-geometry";
import { explainWorldNavigationChange, propTileRect } from "./navigation-change-log";
import { somePropInCell } from "./prop-cell-index";
import { bumpBuildRevision, markWorldCellChanged } from "./save/world-change-journal";
import { BLOCKING, BUILD, NO_MINE_ZONE, SLOPE, type WorldData } from "./world-data";

/**
 * Clearance from the mountain rock (cells) so no model cuts into it: nothing (not even a flag,
 * a road) closer than `flag`, houses keep `house` (closer, at most a flag), mines `mine`.
 */
export const ROCK_CLEARANCE = { flag: 1.5, house: 2.5, mine: 1.5 } as const;
/**
 * Clearance of houses from a river bed (cells; closer, at most a flag). A harbour will be the
 * exception once it exists (it stands at the water on purpose).
 */
export const RIVER_CLEARANCE = 2;

/** What the terrain cap reads: rough ground, rock / river distances, mine land, slopes. */
export interface CapGround extends RoughGround {
  mineZone: Uint16Array;
  slopeClass: Uint8Array;
}

/** The layers a cell's build class is derived from (they live on the world). */
export interface BuildLayers extends GridSize {
  blocking: Uint8Array;
  buildCap: Uint8Array;
  slopeClass: Uint8Array;
}

/** The terrain cap of one cell (see createBuildCap). */
export const getTerrainCap = (ground: CapGround, index: number) => {
  if (ground.rough[index] === 1 || ground.rockDistance[index]! < ROCK_CLEARANCE.flag) {
    return BUILD.none;
  }
  if (ground.mineZone[index] !== NO_MINE_ZONE) {
    if (ground.slopeClass[index]! > SLOPE.steep) return BUILD.none;
    return ground.rockDistance[index]! >= ROCK_CLEARANCE.mine ? BUILD.mine : BUILD.flag;
  }
  if (ground.massif[index] === 1) return BUILD.none;
  const isCrowded =
    ground.rockDistance[index]! < ROCK_CLEARANCE.house ||
    ground.riverDistance[index]! < RIVER_CLEARANCE;
  return isCrowded ? BUILD.flag : BUILD.large;
};

/**
 * The most the terrain alone allows per cell (BUILD value): nothing on rough ground (river beds,
 * rock, harsh slopes), a mine (or, against the rock, a road) on mine land, nothing else on the
 * mountain body (its gaps are mine land), at most a flag next to
 * the mountain rock or a river (no building model cuts into the rock or stands in the water),
 * else up to a large building. Trees and other props are applied on top (they can be felled).
 */
export const createBuildCap = (grid: GridSize, ground: CapGround) =>
  Uint8Array.from({ length: getCellCount(grid) }, (_, index) => getTerrainCap(ground, index));

const getBaseBuildClass = (slope: number) => {
  if (slope === SLOPE.flat) return BUILD.large;
  if (slope === SLOPE.gentle) return BUILD.small;
  if (slope === SLOPE.steep) return BUILD.flag;
  return BUILD.none;
};

/** Cells around a house kept free of trees, bushes and stones (a crown spreads about 2 cells). */
export const PROP_CLEARANCE = 2;

/** A tree, bush or stone within PROP_CLEARANCE cells (its trunk cell is blocked by it). */
const hasPropNearby = (layers: BuildLayers, cellX: number, cellZ: number) => {
  for (let dz = -PROP_CLEARANCE; dz <= PROP_CLEARANCE; dz += 1) {
    for (let dx = -PROP_CLEARANCE; dx <= PROP_CLEARANCE; dx += 1) {
      const x = cellX + dx;
      const z = cellZ + dz;
      if (x < 0 || z < 0 || x >= layers.cellsX || z >= layers.cellsZ) continue;
      if (layers.blocking[z * layers.cellsX + x] === BLOCKING.prop) return true;
    }
  }
  return false;
};

/** The 8-neighbourhood: anything blocked, steepest slope. */
const inspectNeighbours = (layers: BuildLayers, cellX: number, cellZ: number) => {
  let blocked = false;
  let steepest = 0;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dz === 0) continue;
      const x = cellX + dx;
      const z = cellZ + dz;
      if (x < 0 || z < 0 || x >= layers.cellsX || z >= layers.cellsZ) {
        blocked = true;
        continue;
      }
      const index = z * layers.cellsX + x;
      blocked ||= layers.blocking[index] !== BLOCKING.free;
      steepest = Math.max(steepest, layers.slopeClass[index]!);
    }
  }
  return { blocked, steepest };
};

/**
 * The slope gives the base size, blocked or steep
 * neighbours shrink it, a tree (or bush, stone) next to it leaves at most a flag (no building
 * model cuts into a crown; `propClearance` off: the land once the trees are felled, which the
 * generation's building guarantee counts), and the terrain cap limits it (mine land: a mine).
 */
const getCellBuildClass = (
  layers: BuildLayers,
  cellX: number,
  cellZ: number,
  propClearance = true
) => {
  const index = cellZ * layers.cellsX + cellX;
  if (layers.blocking[index] !== BLOCKING.free) return BUILD.none;
  const cap = layers.buildCap[index]!;
  if (cap === BUILD.mine || cap <= BUILD.flag) return cap;
  const neighbours = inspectNeighbours(layers, cellX, cellZ);
  let quality: number = getBaseBuildClass(layers.slopeClass[index]!);
  if (quality === BUILD.large && (neighbours.blocked || neighbours.steepest > SLOPE.gentle)) {
    quality = BUILD.medium;
  }
  if (quality === BUILD.medium && neighbours.steepest >= SLOPE.cliff) quality = BUILD.small;
  if (propClearance && hasPropNearby(layers, cellX, cellZ)) quality = Math.min(quality, BUILD.flag);
  return Math.min(quality, cap);
};

/**
 * Build class of every cell (the placement overlay and the building rules read it); without
 * `propClearance` the land as it is once the trees around are felled (building guarantee).
 */
export const createBuildClass = (layers: BuildLayers, propClearance = true) => {
  const buildClass = new Uint8Array(getCellCount(layers));
  for (let cellZ = 0; cellZ < layers.cellsZ; cellZ += 1) {
    for (let cellX = 0; cellX < layers.cellsX; cellX += 1) {
      const index = cellZ * layers.cellsX + cellX;
      buildClass[index] = getCellBuildClass(layers, cellX, cellZ, propClearance);
    }
  }
  return buildClass;
};

/** Recomputes the build class of a region (the caller includes the prop clearance reach). */
export const refreshBuildClassRegion = (world: WorldData, region: CellRegion) => {
  forEachRegionCell(world, region, (cell, cellX, cellZ) => {
    world.buildClass[cell] = getCellBuildClass(world, cellX, cellZ);
  });
  bumpBuildRevision(world, region);
};

/** Recomputes the build class of the cells a changed cell's blocking reaches (prop clearance). */
export const refreshBuildClassAround = (world: WorldData, cellX: number, cellZ: number) => {
  const cell = { maxX: cellX, maxZ: cellZ, minX: cellX, minZ: cellZ };
  refreshBuildClassRegion(world, expandRegion(world, cell, PROP_CLEARANCE));
};

/** Props already felled per world (their entries stay in the prop set as stumps). */
const felledProps = new WeakMap<WorldData, Set<number>>();

/** The prop stands and blocks its cell (not felled, a blocking kind). */
export const isStandingBlocker = (world: WorldData, index: number) =>
  isBlockingProp(world.props.types[index]!) && !felledProps.get(world)?.has(index);

/** A standing tree, bush or stone still blocks the cell (read from the prop cell index, S12). */
const isCellStillBlocked = (world: WorldData, cell: number) =>
  somePropInCell(world, cell, index => isStandingBlocker(world, index));

/**
 * A prop left the cell under (x, z) (felled, or removed from the prop set): the cell is free again
 * unless another standing tree, bush or stone blocks it; the build class around it is recomputed.
 */
const releasePropCell = (world: WorldData, x: number, z: number) => {
  const cellX = Math.min(world.cellsX - 1, Math.floor(x));
  const cellZ = Math.min(world.cellsZ - 1, Math.floor(z));
  const cell = cellZ * world.cellsX + cellX;
  if (world.blocking[cell] !== BLOCKING.prop) return;
  if (!isCellStillBlocked(world, cell)) {
    world.blocking[cell] = BLOCKING.free;
    markWorldCellChanged(world, cell);
  }
  refreshBuildClassAround(world, cellX, cellZ);
};

/** Batched erasers and river clearing: each released cell asks the prop cell index for survivors. */
export const releasePropCells = (world: WorldData, cells: ReadonlySet<number>) => {
  if (!cells.size) return;
  for (const cell of cells) if (world.blocking[cell] === BLOCKING.prop && !isCellStillBlocked(world, cell)) {
    world.blocking[cell] = BLOCKING.free;
    markWorldCellChanged(world, cell);
  }
  refreshBuildClassRegion(world, expandRegion(world, getCellsRegion(world, [...cells]), PROP_CLEARANCE));
};

/**
 * A felled tree frees its cell (unless another tree, bush or stone stands there) and its
 * neighbours' building room again: the build class around it is recomputed.
 */
export const releaseFelledProp = (world: WorldData, prop: number) =>
  // A felled trunk stops blocking navigation on its own tile at once (journal, A03).
  explainWorldNavigationChange(world, propTileRect(world, prop), () => {
    const felled = felledProps.get(world) ?? new Set<number>();
    felled.add(prop);
    felledProps.set(world, felled);
    releasePropCell(world, world.props.x[prop]!, world.props.z[prop]!);
  });

/**
 * Settlement land (cells) the island's building minimums are measured against: dry land the
 * terrain lets anything but a mine stand on (rough ground and mine land never hold a house).
 */
export const countSettlementLand = (layers: { blocking: Uint8Array; buildCap: Uint8Array }) => {
  let count = 0;
  for (let cell = 0; cell < layers.blocking.length; cell += 1) {
    const cap = layers.buildCap[cell]!;
    if (layers.blocking[cell] === BLOCKING.water || cap === BUILD.none || cap === BUILD.mine) {
      continue;
    }
    count += 1;
  }
  return count;
};
