/** Nav cells per world unit: half a world cell, fine enough for cliff lips and river banks. */
export const NAV_RES = 2;
export const NAV_CELL = 1 / NAV_RES;
/** Map border kept free (world units): nothing walks off the island's edge. */
const BORDER = 1;
/** Water deeper than this at a cell centre (or a corner, a bit more) is not walkable. */
const WATER_CENTRE = 0.02;
const WATER_CORNER = 0.06;

/** Why a nav cell is not walkable for anybody (bit flags; slope is judged per species). */
export const NAV_FLAG = { water: 1, rock: 2, cliff: 4, border: 8 } as const;

/** What the nav layer needs to know about the ground (the island or a synthetic test map). */
export interface NavTerrainInput {
  cellsX: number;
  cellsZ: number;
  /** The rendered (smooth) surface height. */
  height: (x: number, z: number) => number;
  /** Designated non-walkable ground: gameplay cliffs, the sculpted mountain rock. */
  isBlockedGround: (x: number, z: number) => boolean;
  waterDepth: (x: number, z: number) => number;
}

/**
 * Collision terrain of the animals, separate from the render geometry: a lattice of surface
 * heights every NAV_CELL and per nav cell the steepest rise across it and blocking flags.
 */
export interface NavTerrain {
  cellsX: number;
  cellsZ: number;
  flags: Uint8Array;
  /** Lattice heights, (width + 1) * (depth + 1). */
  heights: Float32Array;
  /** Steepest rise per world unit along any edge or diagonal of the nav cell. */
  slope: Float32Array;
  /** Nav cells along x and z. */
  width: number;
  depth: number;
}

const sampleLattice = (input: NavTerrainInput, width: number, depth: number) => {
  const heights = new Float32Array((width + 1) * (depth + 1));
  const water = new Float32Array((width + 1) * (depth + 1));
  for (let row = 0; row <= depth; row += 1) {
    for (let column = 0; column <= width; column += 1) {
      const index = row * (width + 1) + column;
      heights[index] = input.height(column * NAV_CELL, row * NAV_CELL);
      water[index] = input.waterDepth(column * NAV_CELL, row * NAV_CELL);
    }
  }
  return { heights, water };
};

/** Steepest rise of a cell from its four corner heights: edges and both diagonals. */
const getCellRise = (h00: number, h10: number, h01: number, h11: number) => {
  const edges = Math.max(
    Math.abs(h10 - h00),
    Math.abs(h01 - h00),
    Math.abs(h11 - h10),
    Math.abs(h11 - h01)
  );
  const diagonals = Math.max(Math.abs(h11 - h00), Math.abs(h10 - h01)) / Math.SQRT2;
  return Math.max(edges, diagonals) / NAV_CELL;
};

const isBorderCell = (column: number, row: number, width: number, depth: number) => {
  const margin = BORDER * NAV_RES;
  return column < margin || row < margin || column >= width - margin || row >= depth - margin;
};

const getCellFlags = (
  input: NavTerrainInput,
  water: Float32Array,
  column: number,
  row: number,
  width: number
) => {
  const x = (column + 0.5) * NAV_CELL;
  const z = (row + 0.5) * NAV_CELL;
  const corner = row * (width + 1) + column;
  const deepestCorner = Math.max(
    water[corner]!,
    water[corner + 1]!,
    water[corner + width + 1]!,
    water[corner + width + 2]!
  );
  let flags = 0;
  if (input.waterDepth(x, z) > WATER_CENTRE || deepestCorner > WATER_CORNER) {
    flags |= NAV_FLAG.water;
  }
  if (input.isBlockedGround(x, z)) flags |= NAV_FLAG.rock;
  return flags;
};

/** Builds the nav lattice once per world (pure: synthetic maps in tests use the same code). */
export const createNavTerrain = (input: NavTerrainInput): NavTerrain => {
  const width = input.cellsX * NAV_RES;
  const depth = input.cellsZ * NAV_RES;
  const { heights, water } = sampleLattice(input, width, depth);
  const slope = new Float32Array(width * depth);
  const flags = new Uint8Array(width * depth);
  for (let row = 0; row < depth; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const cell = row * width + column;
      const corner = row * (width + 1) + column;
      slope[cell] = getCellRise(
        heights[corner]!,
        heights[corner + 1]!,
        heights[corner + width + 1]!,
        heights[corner + width + 2]!
      );
      flags[cell] = getCellFlags(input, water, column, row, width);
      if (isBorderCell(column, row, width, depth)) flags[cell] |= NAV_FLAG.border;
    }
  }
  return { cellsX: input.cellsX, cellsZ: input.cellsZ, depth, flags, heights, slope, width };
};

/** Nav cell index at a world point, -1 outside the map. */
export const getNavCell = (terrain: NavTerrain, x: number, z: number) => {
  const column = Math.floor(x * NAV_RES);
  const row = Math.floor(z * NAV_RES);
  if (column < 0 || row < 0 || column >= terrain.width || row >= terrain.depth) return -1;
  return row * terrain.width + column;
};

/** Bilinear height on the nav lattice (no allocation; the collision surface). */
export const sampleNavHeight = (terrain: NavTerrain, x: number, z: number) => {
  const fx = Math.min(Math.max(x * NAV_RES, 0), terrain.width - 1e-4);
  const fz = Math.min(Math.max(z * NAV_RES, 0), terrain.depth - 1e-4);
  const column = Math.floor(fx);
  const row = Math.floor(fz);
  const tx = fx - column;
  const tz = fz - row;
  const stride = terrain.width + 1;
  const corner = row * stride + column;
  const { heights } = terrain;
  const top = heights[corner]! + (heights[corner + 1]! - heights[corner]!) * tx;
  const bottom =
    heights[corner + stride]! + (heights[corner + stride + 1]! - heights[corner + stride]!) * tx;
  return top + (bottom - top) * tz;
};
