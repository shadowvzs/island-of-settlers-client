import { getCellCount, type GridSize,readVertex } from "../grid-geometry";
import { BLOCKING, PROP, type PropSet,SLOPE } from "../world-data";

const SLOPE_LIMITS = { flat: 0.35, gentle: 0.8, steep: 1.5 } as const;
const BLOCKING_PROPS = new Set<number>([
  PROP.cedarTree,
  PROP.walnutTree,
  PROP.mahoganyTree,
  PROP.hardwoodTree,
  PROP.broadleafTree,
  PROP.coniferTree,
  PROP.palmTree,
  PROP.birchTree,
  PROP.bush,
  PROP.smallRock,
  PROP.largeRock,
  PROP.riverShrub,
  PROP.willowShrub,
  PROP.berryBush,
  PROP.sapling,
  PROP.fieldShrub
]);

/** Trees, bushes, shrubs and rocks: their cell is blocked for building. */
export const isBlockingProp = (type: number) => BLOCKING_PROPS.has(type);

export interface GameplayInputs {
  heights: Float32Array;
  props: PropSet;
  waterDepth: Float32Array;
}

const getCornerRange = (
  grid: GridSize,
  values: ArrayLike<number>,
  cellX: number,
  cellZ: number
) => {
  const corners = [
    readVertex(grid, values, cellX, cellZ),
    readVertex(grid, values, cellX + 1, cellZ),
    readVertex(grid, values, cellX, cellZ + 1),
    readVertex(grid, values, cellX + 1, cellZ + 1)
  ];
  return { max: Math.max(...corners), min: Math.min(...corners) };
};

/** Slope class of a cell from its rise (highest minus lowest corner). */
export const toSlopeClass = (rise: number) => {
  if (rise < SLOPE_LIMITS.flat) return SLOPE.flat;
  if (rise < SLOPE_LIMITS.gentle) return SLOPE.gentle;
  if (rise < SLOPE_LIMITS.steep) return SLOPE.steep;
  return SLOPE.cliff;
};

/** Slope class and static blocking (water, cliffs, blocking props stamped on their cell). */
/** Slope class and terrain blocking (water, cliff, else free) of one cell. */
export const getCellTerrain = (
  grid: GridSize,
  inputs: Omit<GameplayInputs, "props">,
  cellX: number,
  cellZ: number
) => {
  const heights = getCornerRange(grid, inputs.heights, cellX, cellZ);
  const depth = getCornerRange(grid, inputs.waterDepth, cellX, cellZ);
  const slopeClass = toSlopeClass(heights.max - heights.min);
  if (depth.max > 0.05) return { blocking: BLOCKING.water, slopeClass };
  return { blocking: slopeClass === SLOPE.cliff ? BLOCKING.cliff : BLOCKING.free, slopeClass };
};

export const createCellTerrain = (grid: GridSize, inputs: GameplayInputs) => {
  const count = getCellCount(grid);
  const slopeClass = new Uint8Array(count);
  const blocking = new Uint8Array(count);
  for (let cellZ = 0; cellZ < grid.cellsZ; cellZ += 1) {
    for (let cellX = 0; cellX < grid.cellsX; cellX += 1) {
      const index = cellZ * grid.cellsX + cellX;
      const terrain = getCellTerrain(grid, inputs, cellX, cellZ);
      slopeClass[index] = terrain.slopeClass;
      blocking[index] = terrain.blocking;
    }
  }
  const { props } = inputs;
  for (let index = 0; index < props.count; index += 1) {
    if (!isBlockingProp(props.types[index]!)) continue;
    const cellX = Math.min(grid.cellsX - 1, Math.floor(props.x[index]!));
    const cellZ = Math.min(grid.cellsZ - 1, Math.floor(props.z[index]!));
    const cell = cellZ * grid.cellsX + cellX;
    if (blocking[cell] === BLOCKING.free) blocking[cell] = BLOCKING.prop;
  }
  return { blocking, slopeClass };
};
