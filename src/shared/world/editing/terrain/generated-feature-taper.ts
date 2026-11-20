import type { WorldData } from "../../world-data";
import { cardinalNeighbours } from "./terrain-vertex-neighbours";

/** Largest height step a tapered join may keep (the join rule refuses steps above 0.7). */
const TAPER_STEP = 0.65;
/** How many vertex rings beyond the edited terrain the join may blend over. */
const TAPER_RINGS = 4;

const isInterior = (world: WorldData, vertex: number) => {
  const stride = world.cellsX + 1,
    x = vertex % stride,
    z = Math.floor(vertex / stride);
  return x > 0 && z > 0 && x < world.cellsX && z < world.cellsZ;
};

/** The step a kept join may have: the limit, or the step the ground already had there. */
const allowedStep = (world: WorldData, vertex: number, neighbour: number) =>
  Math.max(TAPER_STEP, Math.abs(world.heights[vertex]! - world.heights[neighbour]!));

const isNewSteepJoin = (
  world: WorldData,
  heights: Float32Array,
  vertex: number,
  neighbour: number
) =>
  Math.abs(heights[vertex]! - heights[neighbour]!) > allowedStep(world, vertex, neighbour) + 0.05;

/** Kept interior vertices within TAPER_RINGS of the edit, nearest first. */
const taperRing = (world: WorldData, edited: ReadonlySet<number>) => {
  const seen = new Set(edited),
    ring: number[] = [];
  let frontier = [...edited];
  for (let depth = 0; depth < TAPER_RINGS; depth++) {
    const next: number[] = [];
    for (const vertex of frontier)
      for (const neighbour of cardinalNeighbours(world, vertex)) {
        if (seen.has(neighbour) || !isInterior(world, neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    ring.push(...next);
    frontier = next;
  }
  return ring;
};

/** Moves a ring vertex the least amount that brings all its joins within their allowed steps. */
const relaxVertex = (world: WorldData, heights: Float32Array, vertex: number) => {
  let low = -Infinity,
    high = Infinity;
  for (const neighbour of cardinalNeighbours(world, vertex)) {
    const allowed = allowedStep(world, vertex, neighbour);
    low = Math.max(low, heights[neighbour]! - allowed);
    high = Math.min(high, heights[neighbour]! + allowed);
  }
  const target = low > high ? (low + high) / 2 : Math.min(high, Math.max(low, heights[vertex]!));
  if (Math.abs(target - heights[vertex]!) < 0.00001) return false;
  heights[vertex] = target;
  return true;
};

/**
 * A relief cut on a steep slope would leave a cliff where it lands: the kept ground around the
 * edited vertices relaxes towards it over a few rings, so every new join stays under the slope
 * limit (steps the ground already had are kept). Returns the tapered vertices; refuses when the
 * join cannot fit inside those rings.
 */
export const taperFeatureEdge = (
  world: WorldData,
  heights: Float32Array,
  edited: ReadonlySet<number>
) => {
  const ring = taperRing(world, edited);
  for (let pass = 0; pass < TAPER_RINGS * 4; pass++) {
    let moved = false;
    for (const vertex of ring) moved = relaxVertex(world, heights, vertex) || moved;
    if (!moved) break;
  }
  const tapered = ring.filter((vertex) => heights[vertex] !== world.heights[vertex]);
  const moved = new Set([...edited, ...tapered]);
  for (const vertex of moved)
    for (const neighbour of cardinalNeighbours(world, vertex))
      if (!moved.has(neighbour) && isNewSteepJoin(world, heights, vertex, neighbour))
        throw new Error(
          "The moved relief is too steep to blend into its destination within four tiles. Choose flatter ground or a lower contour."
        );
  return tapered;
};
