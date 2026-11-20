import { getCellCount, getVertexSlope, type GridSize } from "../grid-geometry";
import { createMountainField, getRockSkinCover } from "../rock-cover";
import { MATERIAL, MATERIAL_COUNT } from "../world-data";
import { computeDistanceField } from "./distance-field";

/** What the rough ground test reads; without a splat (clearing planning) rock ground is skipped. */
export interface RoughGroundInputs {
  heights: Float32Array;
  riverDistance: Float32Array;
  splat?: Uint8Array;
}

/** A corner this close to the river bed (cells) puts the cell in the river. */
const RIVER_BED = 0.75;
/** Rock skin cover (sculpted mountain rock surface) or rock ground share above which it is rock. */
const ROCK_COVER = 0.5;
const ROCK_GROUND = 0.5;
/**
 * Cell rise above which the ground is too harsh even for a flag (a road); below it, steep ground
 * (rise 0.8 .. 1.5) still takes a flag.
 */
const HARSH_RISE = 1.15;
/** Mountain mass of the massif body (the same level the mine gravel rings). */
const MASSIF_LEVEL = 0.6;
/**
 * Rough ground and every cell's distances (cells) to the nearest mountain rock cell and to the
 * river bed (its nearest corner).
 */
export interface RoughGround {
  /** 1: the mountain body (massif); only its gravel (mine land) takes anything there. */
  massif: Uint8Array;
  riverDistance: Float32Array;
  rockDistance: Float32Array;
  rough: Uint8Array;
}

/** Vertex indices of a cell's four corners. */
const getCorners = (grid: GridSize, cell: number) => {
  const stride = grid.cellsX + 1;
  const corner = Math.floor(cell / grid.cellsX) * stride + (cell % grid.cellsX);
  return [corner, corner + 1, corner + stride, corner + stride + 1];
};

const isHarsh = (inputs: RoughGroundInputs, corners: number[]) => {
  const heights = corners.map((vertex) => inputs.heights[vertex]!);
  return Math.max(...heights) - Math.min(...heights) > HARSH_RISE;
};

const isRiverBed = (inputs: RoughGroundInputs, corners: number[]) =>
  corners.some((vertex) => inputs.riverDistance[vertex]! < RIVER_BED);

const isRockGround = (splat: Uint8Array | undefined, corners: number[]) =>
  splat !== undefined &&
  corners.some((vertex) => splat[vertex * MATERIAL_COUNT + MATERIAL.rock]! / 255 > ROCK_GROUND);

/** Rock ground under a corner of the cell: the splat part of the rough test (map editor). */
export const isRockGroundCell = (grid: GridSize, splat: Uint8Array, cell: number) =>
  isRockGround(splat, getCorners(grid, cell));

/** Rock skin cover per vertex: the sculpted mountain rock surface (heights only). */
const createRockCover = (grid: GridSize, heights: Float32Array, mountain: Float32Array) => {
  const stride = grid.cellsX + 1;
  return Float32Array.from(mountain, (share, vertex) => {
    if (share <= 0) return 0;
    const slope = getVertexSlope(grid, heights, vertex % stride, Math.floor(vertex / stride));
    return getRockSkinCover(slope, share);
  });
};

/**
 * Cells nothing may be built on, not even a flag (no road): river beds, the mountain rock (the
 * sculpted rock skin's cover formula, shared with props and animals, or rock ground) and slopes
 * too harsh for a road; plus every cell's distance to the mountain rock (the skin cover only,
 * so the mine field sizing, which has no splat yet, measures the same clearance) and the river.
 */
export const createRoughGround = (grid: GridSize, inputs: RoughGroundInputs): RoughGround => {
  const mountain = createMountainField(grid, inputs.heights);
  const rockCover = createRockCover(grid, inputs.heights, mountain);
  const rough = new Uint8Array(getCellCount(grid));
  const rock = new Uint8Array(rough.length);
  const massif = new Uint8Array(rough.length);
  const riverDistance = new Float32Array(rough.length);
  for (let cell = 0; cell < rough.length; cell += 1) {
    const corners = getCorners(grid, cell);
    riverDistance[cell] = Math.min(...corners.map((vertex) => inputs.riverDistance[vertex]!));
    rock[cell] = corners.some((vertex) => rockCover[vertex]! > ROCK_COVER) ? 1 : 0;
    massif[cell] = corners.some((vertex) => mountain[vertex]! >= MASSIF_LEVEL) ? 1 : 0;
    const isRough =
      rock[cell] === 1 ||
      isRockGround(inputs.splat, corners) ||
      isRiverBed(inputs, corners) ||
      isHarsh(inputs, corners);
    rough[cell] = isRough ? 1 : 0;
  }
  const cellGrid = { cellsX: grid.cellsX - 1, cellsZ: grid.cellsZ - 1 };
  const rockDistance = computeDistanceField(cellGrid, (cell) => rock[cell] === 1);
  return { massif, riverDistance, rockDistance, rough };
};
