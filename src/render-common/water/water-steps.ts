import { sampleBilinear } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import type { VertexAttributes } from "../chunk-sampling";

/**
 * Steps of the water level (waterfalls, cascade ledges, terrace ends, plunge pool rims). The
 * world stores one water level per vertex, so a plain bilinear water mesh ramps from the upper
 * to the lower level across the step: a slanted glass slab down the fall. Instead the step is
 * split at the fall line: the upper pool ends flat at its level, the lower pool starts flat at
 * its own, and the fall sheet (or the wet rock) fills the gap between them.
 */

/** Water corners whose levels differ more than this (world units) across a quad form a step. */
export const WATER_STEP_RISE = 0.15;
const TIE = 1e-6;

type AttributeKey = keyof VertexAttributes;
const ATTRIBUTE_KEYS: AttributeKey[] = ["normals", "positions", "shading", "splatA", "splatB", "splatC", "water"];

/**
 * Dry land carries the sea level as its water surface (water.ts): a filler, not a pool. Rivers,
 * lakes, levees and banks carry their own level.
 */
const isFiller = (world: WorldData, index: number) =>
  world.waterSurface[index]! <= world.seaLevel + TIE && world.heights[index]! > world.seaLevel;

interface SteppedLevel {
  /** The snapped level, null where no step crosses the vertex's cell (plain bilinear level). */
  level: number | null;
  /** Whether every world vertex the render vertex mixes carries a pool level (no filler). */
  pool: boolean;
}

/**
 * Water level of a render vertex inside a step: the level of its nearest world vertex (ties: the
 * lower level, so the step sits on the upper pool's last vertex).
 */
const getSteppedLevel = (world: WorldData, x: number, z: number): SteppedLevel => {
  const stride = world.cellsX + 1;
  const x0 = Math.min(world.cellsX - 1, Math.floor(x));
  const z0 = Math.min(world.cellsZ - 1, Math.floor(z));
  const fx = x - x0;
  const fz = z - z0;
  let low = Infinity;
  let high = -Infinity;
  let best = Infinity;
  let bestWeight = 0;
  for (const [dx, dz, weight] of [[0, 0, (1 - fx) * (1 - fz)], [1, 0, fx * (1 - fz)], [0, 1, (1 - fx) * fz],
    [1, 1, fx * fz]] as const) {
    if (weight <= TIE) continue;
    const index = (z0 + dz) * stride + x0 + dx;
    if (isFiller(world, index)) return { level: null, pool: false };
    const level = world.waterSurface[index]!;
    low = Math.min(low, level);
    high = Math.max(high, level);
    const isCloser = weight > bestWeight + TIE;
    const isLowerTie = Math.abs(weight - bestWeight) <= TIE && level < best;
    if (!isCloser && !isLowerTie) continue;
    best = level;
    bestWeight = weight;
  }
  return { level: high - low > WATER_STEP_RISE ? best : null, pool: true };
};

/**
 * Snaps the water mesh vertices inside a step to one level each (and their signed depth with
 * them); returns which vertices carry a pool level (the others ramp to the dry land's filler).
 */
export const snapWaterSteps = (world: WorldData, attributes: VertexAttributes, vertexCount: number) => {
  const { positions, water } = attributes;
  const pools = new Uint8Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const { level, pool } = getSteppedLevel(world, positions[vertex * 3]!, positions[vertex * 3 + 2]!);
    pools[vertex] = pool ? 1 : 0;
    if (level === null) continue;
    water[vertex * 4] = water[vertex * 4]! + level - positions[vertex * 3 + 1]!;
    positions[vertex * 3 + 1] = level;
  }
  return pools;
};

/**
 * The ground's signed water depth with the same snapped levels: the rock face of a step lies above
 * the lower pool, so it gets no underwater shading (caustics, tint) from a level ramped across it.
 */
export const snapGroundWaterDepths = (world: WorldData, attributes: VertexAttributes, vertexCount: number) => {
  const { positions, water } = attributes;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const x = positions[vertex * 3]!;
    const z = positions[vertex * 3 + 2]!;
    const { level } = getSteppedLevel(world, x, z);
    if (level === null) continue;
    water[vertex * 4] = water[vertex * 4]! + level - sampleBilinear(world, world.waterSurface, x, z);
  }
};

/** The pools of a step quad: each pool's level and the cut levels between them (lowest first). */
interface StepPools {
  cuts: number[];
  levels: number[];
}

/**
 * Groups a quad's water level corners into pools whose levels lie more than WATER_STEP_RISE
 * apart (stacked falls: more than two); null when the quad holds a single pool.
 */
const getStepPools = (
  attributes: VertexAttributes,
  isPool: Uint8Array,
  corners: readonly number[]
): StepPools | null => {
  const heights = corners
    .filter((corner) => isPool[corner] === 1)
    .map((corner) => attributes.positions[corner * 3 + 1]!)
    .sort((a, b) => a - b);
  const pools: number[][] = [];
  for (const height of heights) {
    const pool = pools.at(-1);
    if (pool && height - pool.at(-1)! <= WATER_STEP_RISE) pool.push(height);
    else pools.push([height]);
  }
  if (pools.length < 2) return null;
  return {
    cuts: pools.slice(1).map((pool, index) => (pools[index]!.at(-1)! + pool[0]!) / 2),
    levels: pools.map((pool) => pool.reduce((sum, height) => sum + height, 0) / pool.length)
  };
};

interface PoolEdge {
  corner: number;
  y: number;
}

/**
 * Splits the step quads of one water chunk into flat pools. New vertices on the fall lines (one
 * copy per pool) are appended after the grid vertices.
 */
export const createWaterStepSplitter = (attributes: VertexAttributes, isPool: Uint8Array) => {
  const vertexCount = isPool.length;
  /** `pool`: the edge corner of the vertex's own pool (-1: none, a pool between both corners). */
  const extra: { from: number; pool: number; share: number; to: number; y: number }[] = [];
  const known = new Map<string, number>();
  const heightOf = (vertex: number) => attributes.positions[vertex * 3 + 1]!;
  /** Pool of a vertex: the cuts below it (dry land's sea level filler: the lowest pool). */
  const poolOf = (vertex: number, pools: StepPools) => {
    if (isPool[vertex] !== 1) return 0;
    return pools.cuts.filter((cut) => heightOf(vertex) >= cut).length;
  };
  /** The point where edge from - to crosses `cut`, as a vertex of `pool` (flat at its level). */
  const cutVertex = (from: number, to: number, cut: number, { corner, y }: PoolEdge) => {
    const key = `${Math.min(from, to)}:${Math.max(from, to)}:${cut}:${y}`;
    const vertex = known.get(key);
    if (vertex !== undefined) return vertex;
    const rise = heightOf(to) - heightOf(from);
    const share = Math.abs(rise) > TIE ? Math.min(1, Math.max(0, (cut - heightOf(from)) / rise)) : 0.5;
    extra.push({ from, pool: corner, share, to, y });
    known.set(key, vertexCount + extra.length - 1);
    return vertexCount + extra.length - 1;
  };
  /** The cut between `pool` and its neighbour towards `other` (cuts[k] parts pools k and k + 1). */
  const cutTowards = (pools: StepPools, pool: number, other: number) =>
    pools.cuts[other > pool ? pool : pool - 1]!;
  /** One pool's part of a triangle: its corners plus the edge crossings of its cuts, fanned. */
  const pushPool = (indices: number[], triangle: readonly number[], pools: StepPools, pool: number) => {
    const polygon: number[] = [];
    triangle.forEach((vertex, corner) => {
      const next = triangle[(corner + 1) % 3]!;
      const fromPool = poolOf(vertex, pools);
      const toPool = poolOf(next, pools);
      if (fromPool === pool) polygon.push(vertex);
      if (Math.min(fromPool, toPool) > pool || Math.max(fromPool, toPool) < pool) return;
      if (fromPool === pool && toPool === pool) return;
      const edge = getPoolEdge(pools, pool, [vertex, fromPool], [next, toPool]);
      if (fromPool !== pool) polygon.push(cutVertex(vertex, next, cutTowards(pools, pool, fromPool), edge));
      if (toPool !== pool) polygon.push(cutVertex(vertex, next, cutTowards(pools, pool, toPool), edge));
    });
    for (let corner = 2; corner < polygon.length; corner += 1) {
      indices.push(polygon[0]!, polygon[corner - 1]!, polygon[corner]!);
    }
  };
  /** A pool's fall line vertex on an edge: flat at its corner on that edge, else at the pool level. */
  const getPoolEdge = (pools: StepPools, pool: number, ...ends: [number, number][]): PoolEdge => {
    const end = ends.find(([, endPool]) => endPool === pool);
    return end ? { corner: end[0], y: heightOf(end[0]) } : { corner: -1, y: pools.levels[pool]! };
  };
  /** Pushes a quad's triangles split into flat pools when the quad is a step; false: not a step. */
  const pushStepQuad = (indices: number[], corners: readonly number[], triangles: readonly number[]) => {
    const pools = getStepPools(attributes, isPool, corners);
    if (!pools) return false;
    for (let offset = 0; offset < triangles.length; offset += 3) {
      const triangle = triangles.slice(offset, offset + 3);
      pools.levels.forEach((_, pool) => pushPool(indices, triangle, pools, pool));
    }
    return true;
  };
  return { extra, pushStepQuad };
};

type ExtraVertex = ReturnType<typeof createWaterStepSplitter>["extra"][number];

const mixInto = (target: Float32Array | Uint8Array, source: Float32Array | Uint8Array, size: number,
  vertex: number, { from, share, to }: ExtraVertex) => {
  const isBytes = target instanceof Uint8Array;
  for (let item = 0; item < size; item += 1) {
    const value = source[from * size + item]! * (1 - share) + source[to * size + item]! * share;
    target[vertex * size + item] = isBytes ? Math.round(value) : value;
  }
};

/** The chunk's attributes with the fall line vertices appended (each flat at its pool's level). */
export const appendStepVertices = (
  attributes: VertexAttributes,
  vertexCount: number,
  extra: readonly ExtraVertex[]
): VertexAttributes => {
  if (extra.length === 0) return attributes;
  const total = vertexCount + extra.length;
  const result = { ...attributes };
  for (const key of ATTRIBUTE_KEYS) {
    const source = attributes[key];
    const size = source.length / vertexCount;
    const target = new (source.constructor as Float32ArrayConstructor | Uint8ArrayConstructor)(total * size);
    target.set(source);
    extra.forEach((point, index) => mixInto(target, source, size, vertexCount + index, point));
    result[key] = target as never;
  }
  extra.forEach((point, index) => {
    const vertex = vertexCount + index;
    const mixedY = result.positions[vertex * 3 + 1]!;
    // A pool keeps its corner's depth up to the fall line: beside the notch, where the corner is dry
    // bank, its edge stays dry instead of a flat shelf over the falling ground.
    result.water[vertex * 4] = point.pool >= 0
      ? attributes.water[point.pool * 4]!
      : result.water[vertex * 4]! + point.y - mixedY;
    result.positions[vertex * 3 + 1] = point.y;
  });
  return result;
};
