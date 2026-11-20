import type { GridSize } from "../grid-geometry";

interface BlurLine {
  /** First vertex of the line, vertex step along it and its vertex count. */
  length: number;
  start: number;
  step: number;
}

/** Running sum box filter of one line (edges repeat): O(length) for any radius. */
const blurLine = (values: Float32Array, line: Float32Array, radius: number, blur: BlurLine) => {
  const { length, start, step } = blur;
  for (let index = 0; index < length; index += 1) line[index] = values[start + index * step]!;
  const last = length - 1;
  const at = (index: number) => line[Math.min(last, Math.max(0, index))]!;
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) sum += at(offset);
  const width = radius * 2 + 1;
  for (let index = 0; index < length; index += 1) {
    values[start + index * step] = sum / width;
    sum += at(index + radius + 1) - at(index - radius);
  }
};

/**
 * Separable box blur of a vertex layer in place; repeated passes approach a gaussian (three
 * passes of radius r: sigma about r). Cost per pass is independent of the radius.
 */
export const boxBlurVertices = (
  grid: GridSize,
  values: Float32Array,
  options: { passes: number; radius: number }
) => {
  const stride = grid.cellsX + 1;
  const rows = grid.cellsZ + 1;
  const line = new Float32Array(Math.max(stride, rows));
  for (let pass = 0; pass < options.passes; pass += 1) {
    for (let z = 0; z < rows; z += 1) {
      blurLine(values, line, options.radius, { length: stride, start: z * stride, step: 1 });
    }
    for (let x = 0; x < stride; x += 1) {
      blurLine(values, line, options.radius, { length: rows, start: x, step: stride });
    }
  }
  return values;
};
