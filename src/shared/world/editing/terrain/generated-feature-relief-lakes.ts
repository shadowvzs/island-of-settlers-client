import { sampleBilinear } from "../../grid-geometry";
import { MATERIAL_COUNT, type WorldData } from "../../world-data";
import { cardinalNeighbours } from "./terrain-vertex-neighbours";

/** A still lake standing on a moved relief: its wet vertices and its water level. */
export interface ReliefLake {
  surface: number;
  vertices: Set<number>;
}

interface LakeDraft {
  heights: Float32Array;
  lakeWater: Uint8Array;
  waterSurface: Float32Array;
}

const WET = 0.01;
const LAKE_BUDGET = 32768;
/** A carried lake must stay this far above the sea, otherwise it would merge with it. */
const SEA_CLEARANCE = 0.1;

const isFlowing = (world: WorldData, vertex: number) =>
  Math.hypot(world.flow[vertex * 2]!, world.flow[vertex * 2 + 1]!) > WET;

/** Bilinear sample of sparse vertex values (zero beyond them), so an irregular outline survives. */
export const sampleVertexValues = (
  world: WorldData,
  values: ReadonlyMap<number, number>,
  x: number,
  z: number
) => {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = x - ix,
    fz = z - iz,
    stride = world.cellsX + 1;
  const at = (dx: number, dz: number) =>
    ix + dx < 0 || iz + dz < 0 || ix + dx > world.cellsX || iz + dz > world.cellsZ
      ? 0
      : (values.get((iz + dz) * stride + ix + dx) ?? 0);
  return (
    at(0, 0) * (1 - fx) * (1 - fz) +
    at(1, 0) * fx * (1 - fz) +
    at(0, 1) * (1 - fx) * fz +
    at(1, 1) * fx * fz
  );
};

/** The complete still lake around a wet seed vertex; its dry rim must stay above the contour. */
const floodLake = (world: WorldData, seed: number, plane: number) => {
  const vertices = new Set([seed]),
    queue = [seed],
    surface = world.waterSurface[seed]!;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const vertex = queue[cursor]!;
    if (isFlowing(world, vertex))
      throw new Error(
        "A lake on this relief drains into a river. Include the river course or edit it first."
      );
    if (world.waterSurface[vertex]! <= world.seaLevel + WET)
      throw new Error("This relief contour touches the sea. Select a higher contour to move it.");
    if (Math.abs(world.waterSurface[vertex]! - surface) > 0.1)
      throw new Error(
        "A lake on this relief has several water levels. Edit the lake separately first."
      );
    for (const neighbour of cardinalNeighbours(world, vertex)) {
      if (vertices.has(neighbour)) continue;
      if (world.waterDepth[neighbour]! > WET) {
        if (vertices.size >= LAKE_BUDGET)
          throw new Error("A lake on this relief exceeds the editing budget.");
        vertices.add(neighbour);
        queue.push(neighbour);
        continue;
      }
      if (world.heights[neighbour]! <= plane)
        throw new Error(
          "A lake on this relief spills below the selected contour. Select a lower contour to carry it."
        );
    }
  }
  return { surface, vertices };
};

/** Every still lake wet-connected to the relief support; each must stay enclosed above the contour. */
export const collectReliefLakes = (
  world: WorldData,
  wetSupport: Iterable<number>,
  plane: number
) => {
  const lakes: ReliefLake[] = [],
    claimed = new Set<number>();
  for (const seed of wetSupport) {
    if (claimed.has(seed)) continue;
    const lake = floodLake(world, seed, plane);
    for (const vertex of lake.vertices) claimed.add(vertex);
    lakes.push(lake);
  }
  return lakes;
};

/** Source amplitude of each lake vertex and its dry rim (the bed may lie below the contour plane). */
export const addLakeProfile = (
  world: WorldData,
  lakes: readonly ReliefLake[],
  source: Map<number, number>,
  plane: number
) => {
  for (const { vertices } of lakes)
    for (const vertex of vertices) {
      source.set(vertex, world.heights[vertex]! - plane);
      for (const neighbour of cardinalNeighbours(world, vertex))
        if (!source.has(neighbour) && !vertices.has(neighbour))
          source.set(neighbour, world.heights[neighbour]! - plane);
    }
};

/**
 * Refills each carried lake at its destination with its outline. The level follows the lowest
 * ground shift under the lake and its shore, so the measured depths survive on level ground, the
 * water never rises over a shore that sank less, and a lake that would drain or reach the sea is refused.
 */
export const placeReliefLakes = (
  world: WorldData,
  draft: LakeDraft,
  lakes: readonly ReliefLake[],
  destinations: readonly number[],
  sourcePoint: (vertex: number) => { x: number; z: number }
) => {
  const shift = (vertex: number) => {
    const point = sourcePoint(vertex);
    return draft.heights[vertex]! - sampleBilinear(world, world.heights, point.x, point.z);
  };
  for (const lake of lakes) {
    const mask = new Map([...lake.vertices].map((vertex) => [vertex, 1]));
    const wet = destinations.filter((vertex) => {
      const point = sourcePoint(vertex);
      return sampleVertexValues(world, mask, point.x, point.z) >= 0.5;
    });
    let lowestShift = Infinity;
    for (const vertex of wet)
      for (const shore of [vertex, ...cardinalNeighbours(world, vertex)])
        lowestShift = Math.min(lowestShift, shift(shore));
    const surface = lake.surface + lowestShift;
    if (!Number.isFinite(surface) || surface <= world.seaLevel + SEA_CLEARANCE)
      throw new Error(
        "The relief's lake would reach the sea at this destination. Keep its rim on dry ground above the sea."
      );
    let filled = 0;
    for (const vertex of wet) {
      if (draft.heights[vertex]! >= surface - WET) continue;
      draft.waterSurface[vertex] = surface;
      draft.lakeWater[vertex] = 1;
      filled++;
    }
    if (!filled)
      throw new Error(
        "The relief's lake would drain at this size. Choose a larger size or flatter ground."
      );
  }
};

/** The lake bed and its shore: wet vertices plus SHORE_RINGS cardinal rings of bank. */
const SHORE_RINGS = 2;
/** How far (vertices) a vacated shore looks for the surrounding ground paint. */
const PAINT_SEARCH = 6;

/** Adds the next ring around the frontier to the band; returns that ring. */
const growBand = (world: WorldData, band: Set<number>, frontier: readonly number[]) => {
  const next: number[] = [];
  for (const vertex of frontier)
    for (const neighbour of cardinalNeighbours(world, vertex)) {
      if (band.has(neighbour)) continue;
      band.add(neighbour);
      next.push(neighbour);
    }
  return next;
};

const shoreBand = (world: WorldData, lakes: readonly ReliefLake[]) => {
  const band = new Set<number>();
  for (const { vertices } of lakes) {
    let frontier = [...vertices];
    for (const vertex of frontier) band.add(vertex);
    for (let ring = 0; ring < SHORE_RINGS; ring++) frontier = growBand(world, band, frontier);
  }
  return band;
};

/** Nearest vertex outside the shore band (its paint fills the vacated shore), if any. */
const nearestOutside = (world: WorldData, band: ReadonlySet<number>, vertex: number) => {
  const stride = world.cellsX + 1,
    x = vertex % stride,
    z = Math.floor(vertex / stride);
  for (let radius = 1; radius <= PAINT_SEARCH; radius++)
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const nx = x + dx,
          nz = z + dz;
        if (nx < 0 || nz < 0 || nx > world.cellsX || nz > world.cellsZ) continue;
        if (!band.has(nz * stride + nx)) return nz * stride + nx;
      }
  return null;
};

const copyPaint = (from: Uint8Array, source: number, to: Uint8Array, target: number) =>
  to.set(
    from.subarray(source * MATERIAL_COUNT, (source + 1) * MATERIAL_COUNT),
    target * MATERIAL_COUNT
  );

/**
 * The lake's shore paint (sand bank) moves with it: the vacated shore takes the surrounding
 * ground's paint, the destination shore the carried one. Returns the repainted vertices.
 */
export const carryLakeShorePaint = (
  world: WorldData,
  splat: Uint8Array,
  lakes: readonly ReliefLake[],
  destinations: readonly number[],
  sourcePoint: (vertex: number) => { x: number; z: number }
) => {
  if (!lakes.length) return [];
  const band = shoreBand(world, lakes),
    stride = world.cellsX + 1,
    painted: number[] = [];
  for (const vertex of band) {
    const outside = nearestOutside(world, band, vertex);
    if (outside === null) continue;
    copyPaint(world.splat, outside, splat, vertex);
    painted.push(vertex);
  }
  for (const vertex of destinations) {
    const point = sourcePoint(vertex);
    const x = Math.round(point.x),
      z = Math.round(point.z);
    if (x < 0 || z < 0 || x > world.cellsX || z > world.cellsZ) continue;
    if (!band.has(z * stride + x)) continue;
    copyPaint(world.splat, z * stride + x, splat, vertex);
    painted.push(vertex);
  }
  return painted;
};
