import { deterministicPow,DMath } from "../../math/deterministic-math";
import { getVertexCount, getVertexSlope, type GridSize } from "../grid-geometry";
import { MinHeap } from "../min-heap";
import { clamp01 } from "../noise";
import { boxBlurVertices } from "./box-blur";
import { floodSea } from "./water";

export const NEIGHBOURS = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]
] as const;
const FILL_EPSILON = 1e-3;

/** Priority flood: every closed depression rises to its spill height (+ epsilon). */
export const fillDepressions = (grid: GridSize, heights: Float32Array, sea: Uint8Array) => {
  const stride = grid.cellsX + 1;
  const filled = Float32Array.from(heights);
  const visited = new Uint8Array(heights.length);
  const heap = new MinHeap(heights.length);
  for (let index = 0; index < heights.length; index += 1) {
    if (!sea[index]) continue;
    visited[index] = 1;
    heap.push(index, filled[index]!);
  }
  while (heap.size > 0) {
    const current = heap.pop();
    const x = current % stride, z = Math.floor(current / stride);
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx > grid.cellsX || nz > grid.cellsZ) continue;
      const neighbour = nz * stride + nx;
      if (visited[neighbour]) continue;
      visited[neighbour] = 1;
      filled[neighbour] = Math.max(heights[neighbour]!, filled[current]! + FILL_EPSILON);
      heap.push(neighbour, filled[neighbour]!);
    }
  }
  return filled;
};

export interface HydrologyFields {
  area: Float32Array;
  filled: Float32Array;
  receiver: Int32Array;
  wetness: Float32Array;
}

/**
 * Depression-filled surface, D8 receivers, multiple-flow drainage area and a 0..1 wetness index.
 * Pure and deterministic; river tracing reuses the identical fill function.
 */
export const createHydrology = (grid: GridSize, heights: Float32Array, seaLevel: number): HydrologyFields => {
  const sea = floodSea(grid, heights, seaLevel);
  const filled = fillDepressions(grid, heights, sea);
  const count = getVertexCount(grid), stride = grid.cellsX + 1;
  const order = new Int32Array(count);
  for (let index = 0; index < count; index += 1) order[index] = index;
  order.sort((first, second) => filled[second]! - filled[first]! || first - second);
  const receiver = new Int32Array(count).fill(-1);
  const area = new Float32Array(count);
  for (let index = 0; index < count; index += 1) area[index] = sea[index] ? 0 : 1;
  for (const index of order) {
    const x = index % stride, z = Math.floor(index / stride);
    let lowest = filled[index]!, lowestIndex = -1;
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx > grid.cellsX || nz > grid.cellsZ) continue;
      const neighbour = nz * stride + nx;
      if (filled[neighbour]! < lowest) { lowest = filled[neighbour]!; lowestIndex = neighbour; }
    }
    receiver[index] = lowestIndex;
    if (sea[index] || lowestIndex < 0) continue;
    let total = 0;
    const weights = NEIGHBOURS.map(([dx, dz]) => {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx > grid.cellsX || nz > grid.cellsZ) return 0;
      const neighbour = nz * stride + nx, drop = filled[index]! - filled[neighbour]!;
      if (drop <= 0) return 0;
      const distance = dx && dz ? Math.SQRT2 : 1;
      const weight = deterministicPow(drop / distance, 1.1);
      total += weight;
      return weight;
    });
    if (total <= 0) continue;
    for (let neighbourIndex = 0; neighbourIndex < NEIGHBOURS.length; neighbourIndex += 1) {
      const weight = weights[neighbourIndex]!;
      if (weight <= 0) continue;
      const [dx, dz] = NEIGHBOURS[neighbourIndex]!;
      const neighbour = (z + dz) * stride + x + dx;
      area[neighbour]! += area[index]! * weight / total;
    }
  }
  const wetness = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    if (sea[index]) { wetness[index] = 1; continue; }
    const x = index % stride, z = Math.floor(index / stride);
    const slope = getVertexSlope(grid, heights, x, z);
    const raw = DMath.log(1 + area[index]!) - DMath.log(.05 + slope);
    wetness[index] = clamp01((raw + 3) / 12);
  }
  boxBlurVertices(grid, wetness, { passes: 1, radius: 1 });
  return { area, filled, receiver, wetness };
};
