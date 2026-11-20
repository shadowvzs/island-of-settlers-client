import type { GridSize } from "../../grid-geometry";

/** The up to four cardinal neighbour vertices of a vertex (map border aware). */
export const cardinalNeighbours = (grid: GridSize, vertex: number) => {
  const stride = grid.cellsX + 1,
    x = vertex % stride,
    z = Math.floor(vertex / stride);
  const neighbours: number[] = [];
  if (x > 0) neighbours.push(vertex - 1);
  if (x < grid.cellsX) neighbours.push(vertex + 1);
  if (z > 0) neighbours.push(vertex - stride);
  if (z < grid.cellsZ) neighbours.push(vertex + stride);
  return neighbours;
};
