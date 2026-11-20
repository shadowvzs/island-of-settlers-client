import { ROCK_CLEARANCE } from "../build-class";
import { MINE_FOOTPRINT } from "../building-footprints";
import { type BuildSite,countFootprints } from "../building-space";
import { type GridSize,readVertex } from "../grid-geometry";
import { BUILD, SLOPE } from "../world-data";
import { toSlopeClass } from "./gameplay";
import type { RoughGround } from "./rough-ground";

/**
 * What the count reads. `loose`: land outside the gravel counts as access ground too (an upper
 * bound: trees may still block it); otherwise only gravel does (a lower bound).
 */
export interface DepositLand {
  apron: Uint8Array;
  deposit: Uint8Array;
  loose: boolean;
  /** Rough ground and the rock distance of the world's build cap (rough-ground.ts). */
  rough: RoughGround;
  waterDepth: Float32Array;
}

/** Cells around a deposit's bounding box the local site keeps (the access strips). */
const SITE_MARGIN = 2;

interface Box {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

const getBox = (grid: GridSize, cells: readonly number[]): Box => {
  const box = { maxX: 0, maxZ: 0, minX: grid.cellsX, minZ: grid.cellsZ };
  for (const cell of cells) {
    const x = cell % grid.cellsX;
    const z = Math.floor(cell / grid.cellsX);
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minZ = Math.min(box.minZ, z);
    box.maxZ = Math.max(box.maxZ, z);
  }
  return {
    maxX: Math.min(grid.cellsX - 1, box.maxX + SITE_MARGIN),
    maxZ: Math.min(grid.cellsZ - 1, box.maxZ + SITE_MARGIN),
    minX: Math.max(0, box.minX - SITE_MARGIN),
    minZ: Math.max(0, box.minZ - SITE_MARGIN)
  };
};

/** Highest minus lowest corner height of a cell. */
const getCellRise = (grid: GridSize, heights: Float32Array, cellX: number, cellZ: number) => {
  const corners = [
    readVertex(grid, heights, cellX, cellZ),
    readVertex(grid, heights, cellX + 1, cellZ),
    readVertex(grid, heights, cellX, cellZ + 1),
    readVertex(grid, heights, cellX + 1, cellZ + 1)
  ];
  return Math.max(...corners) - Math.min(...corners);
};

/** A deposit cell as the build cap has it: a mine, or a road only against the rock. */
const getMineCellClass = (slope: number, rockDistance: number) => {
  if (slope > SLOPE.steep) return BUILD.none;
  return rockDistance >= ROCK_CLEARANCE.mine ? BUILD.mine : BUILD.flag;
};

const isDry = (grid: GridSize, waterDepth: Float32Array, cellX: number, cellZ: number) =>
  readVertex(grid, waterDepth, cellX, cellZ) <= 0 &&
  readVertex(grid, waterDepth, cellX + 1, cellZ + 1) <= 0;

/**
 * Build class of a cell as the finished world will have it (the mine fields are cleared):
 * deposit cells are mine land, other gravel cells passable access ground, other dry land too
 * when loose; too steep (a cliff for the access, steeper than steep for a mine): neither.
 */
const getSiteClass = (grid: GridSize, heights: Float32Array, land: DepositLand, cell: number) => {
  const cellX = cell % grid.cellsX;
  const cellZ = Math.floor(cell / grid.cellsX);
  const slope = toSlopeClass(getCellRise(grid, heights, cellX, cellZ));
  const isTooClose = land.rough.rockDistance[cell]! < ROCK_CLEARANCE.flag;
  if (land.rough.rough[cell] === 1 || isTooClose) return BUILD.none;
  if (land.deposit[cell] === 1) return getMineCellClass(slope, land.rough.rockDistance[cell]!);
  const isAccess =
    land.apron[cell] === 1 || (land.loose && isDry(grid, land.waterDepth, cellX, cellZ));
  return isAccess && slope < SLOPE.cliff ? BUILD.flag : BUILD.none;
};

/**
 * Counts the mine buildings (MINE_FOOTPRINT, greedy packing like every footprint count) a
 * deposit holds: foundations on its cells, access strips on the gravel around it. Works on a
 * small local site around the deposit, so it is cheap enough to call while the deposit grows.
 */
export const countDepositMines = (
  grid: GridSize,
  heights: Float32Array,
  land: DepositLand,
  cells: readonly number[]
) => {
  const box = getBox(grid, cells);
  const cellsX = box.maxX - box.minX + 1;
  const cellsZ = box.maxZ - box.minZ + 1;
  const site: BuildSite = {
    buildClass: new Uint8Array(cellsX * cellsZ),
    cellsX,
    cellsZ,
    heights: new Float32Array((cellsX + 1) * (cellsZ + 1))
  };
  for (let z = 0; z <= cellsZ; z += 1) {
    for (let x = 0; x <= cellsX; x += 1) {
      site.heights[z * (cellsX + 1) + x] = readVertex(grid, heights, box.minX + x, box.minZ + z);
    }
  }
  for (let z = 0; z < cellsZ; z += 1) {
    for (let x = 0; x < cellsX; x += 1) {
      const cell = (box.minZ + z) * grid.cellsX + box.minX + x;
      site.buildClass[z * cellsX + x] = getSiteClass(grid, heights, land, cell);
    }
  }
  return countFootprints(site, MINE_FOOTPRINT);
};
