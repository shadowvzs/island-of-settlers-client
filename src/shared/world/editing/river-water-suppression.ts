import { computeDistanceField } from "../generation/distance-field";
import { createWetRock } from "../generation/river-wetness";
import type { Waterfall, WorldData } from "../world-data";

export interface RiverWaterSuppression { suppressedVertices?: number[] }
const riverSuppressionLimit = (vertices: number) => Math.min(vertices, 65536);

export const validRiverSuppression = (value: unknown, vertices: number): value is number[] | undefined =>
  value === undefined || (Array.isArray(value) && value.length <= riverSuppressionLimit(vertices) &&
    new Set(value).size === value.length && value.every(vertex =>
      Number.isSafeInteger(vertex) && vertex >= 0 && vertex < vertices));

export const validateRiverSuppressionBudget = (rivers: readonly RiverWaterSuppression[], vertices: number) => {
  if (rivers.some(river => !validRiverSuppression(river.suppressedVertices, vertices)) ||
    rivers.reduce((sum, river) => sum + (river.suppressedVertices?.length ?? 0), 0) > Math.min(vertices * 2, 131072))
    throw new Error("Water erasure exceeds the bounded saved river-mask budget. Erase a smaller area.");
};

/** Drain fresh water while retaining the carved bed and actual ocean depth. */
export const suppressRiverVertex = (world: WorldData, vertex: number) => {
  world.flow[vertex * 2] = world.flow[vertex * 2 + 1] = 0;
  world.waterSurface[vertex] = Math.max(world.seaLevel, world.heights[vertex]!);
  world.waterDepth[vertex] = Math.max(0, world.seaLevel - world.heights[vertex]!);
  if (world.lakeWater) world.lakeWater[vertex] = 0;
};

const vertexAt = (world: WorldData, x: number, z: number) =>
  Math.max(0, Math.min(world.cellsZ, Math.round(z))) * (world.cellsX + 1) +
  Math.max(0, Math.min(world.cellsX, Math.round(x)));

export const riverFallSuppressed = (world: WorldData, fall: Waterfall, mask: ReadonlySet<number>) =>
  mask.has(vertexAt(world, fall.x, fall.z)) || mask.has(vertexAt(world, fall.poolX, fall.poolZ));

/** Masks stay at map coordinates when endpoints move; only the current channel footprint is drained. */
export const applyRiverSuppression = (world: WorldData, river: RiverWaterSuppression,
  owned: ReadonlySet<number>) => {
  const mask = new Set(river.suppressedVertices ?? []);
  for (const vertex of mask) if (owned.has(vertex)) suppressRiverVertex(world, vertex);
  return mask;
};

/** Wet flowing beds exclude native dry-levee flow; the historical estuary mask is not persisted. */
export const refreshRiverWaterDerived = (world: WorldData) => {
  world.riverDistance.set(computeDistanceField(world, i => world.waterDepth[i]! > 0 &&
    !!(world.flow[i * 2] || world.flow[i * 2 + 1])));
  world.wetRock.set(createWetRock(world, world.heights, world.riverDistance, world.waterfalls));
};
