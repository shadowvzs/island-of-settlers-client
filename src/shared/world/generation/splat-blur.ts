import { getVertexCount, type GridSize } from "../grid-geometry";
import { writeSplatWeights } from "../ground-buffer";
import { MATERIAL_COUNT } from "../world-data";

/** Coast distance (cells) from which a vertex is blurred: the shore row keeps its beach sand. */
const SHORE_KEPT = 1.5;

interface BlurAxis {
  /** Vertices that are blurred, and the land vertices they read. */
  isBlurred: (vertex: number) => boolean;
  isLand: (vertex: number) => boolean;
  /** Vertices along the axis, number of lines across it, vertex steps along and across. */
  length: number;
  lines: number;
  step: number;
  stride: number;
}

/** One [1 2 1] pass along an axis; only land neighbours count. */
const blurAxis = (from: Float32Array, to: Float32Array, axis: BlurAxis) => {
  to.set(from);
  for (let line = 0; line < axis.lines; line += 1) {
    for (let index = 0; index < axis.length; index += 1) {
      const vertex = line * axis.stride + index * axis.step;
      if (!axis.isBlurred(vertex)) continue;
      const before = index > 0 && axis.isLand(vertex - axis.step) ? vertex - axis.step : vertex;
      const after =
        index < axis.length - 1 && axis.isLand(vertex + axis.step) ? vertex + axis.step : vertex;
      for (let material = 0; material < MATERIAL_COUNT; material += 1) {
        to[vertex * MATERIAL_COUNT + material] =
          (from[before * MATERIAL_COUNT + material]! +
            from[vertex * MATERIAL_COUNT + material]! * 2 +
            from[after * MATERIAL_COUNT + material]!) /
          4;
      }
    }
  }
};

/**
 * Softens the ground splat over land (in place): a separable [1 2 1] blur, so no material jumps
 * from full to nothing within one cell. The terrain shader then breaks the two cell ramps with
 * noise and texture heights into natural edges instead of cell squares or staircases. Water and
 * the shore row keep their weights (the beach stays sand); water is not blurred into the land.
 */
export const blurLandSplat = (grid: GridSize, splat: Uint8Array, coastDistance: Float32Array) => {
  const stride = grid.cellsX + 1;
  const rows = grid.cellsZ + 1;
  const isLand = (vertex: number) => coastDistance[vertex]! > 0;
  const isBlurred = (vertex: number) => coastDistance[vertex]! >= SHORE_KEPT;
  const source = Float32Array.from(splat);
  const pass = new Float32Array(getVertexCount(grid) * MATERIAL_COUNT);
  const along = { isBlurred, isLand };
  blurAxis(source, pass, { ...along, length: stride, lines: rows, step: 1, stride });
  blurAxis(pass, source, { ...along, length: rows, lines: stride, step: stride, stride: 1 });
  for (let vertex = 0; vertex < getVertexCount(grid); vertex += 1) {
    if (!isBlurred(vertex)) continue;
    const offset = vertex * MATERIAL_COUNT;
    writeSplatWeights(splat, vertex, source.subarray(offset, offset + MATERIAL_COUNT));
  }
};
