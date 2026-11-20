import { type CellRegion, EMPTY_REGION, expandRegion } from "../grid-geometry";
import type { WorldData } from "../world-data";
import { getVertexRangeCells } from "./brush";
import { refreshCoast } from "./terrain/terrain-apply";

/** Cubic ground sampling, normals and the water surface read two vertices beyond a change; one more for safety. */
const RIVER_REGION_HALO = 3;

/**
 * River distance past this no longer matters to any rule or look (clearances, still water, wet rock
 * reach a few cells): a new channel changes the uncapped field over the whole map.
 */
const RIVER_DISTANCE_REACH = 16;

/** Vertex layers (one value per vertex) a river edit or its derived refresh can change. */
const listRiverLayers = (world: WorldData) => [
  world.heights, world.waterSurface, world.waterDepth, world.wetRock, world.coastDistance, world.lakeWater
];

export interface RiverLayerCopy {
  flow: Float32Array;
  layers: (Float32Array | Uint8Array | undefined)[];
  riverDistance: Float32Array;
}

/** Copies the layers before a river edit commits (compared afterwards by `getRiverEditRegion`). */
export const captureRiverLayers = (world: WorldData): RiverLayerCopy => ({
  flow: world.flow.slice(),
  layers: listRiverLayers(world).map(layer => layer?.slice()),
  riverDistance: world.riverDistance.slice()
});

const isRiverDistanceChanged = (now: ArrayLike<number>, then: ArrayLike<number>, vertex: number) =>
  Math.min(now[vertex]!, RIVER_DISTANCE_REACH) !== Math.min(then[vertex]!, RIVER_DISTANCE_REACH);

type VertexLayer = ArrayLike<number> | undefined;

const isVertexChanged = (
  vertex: number, after: readonly VertexLayer[], before: readonly VertexLayer[],
  flow: [ArrayLike<number>, ArrayLike<number>]
) => {
  const [now, then] = flow;
  if (now[vertex * 2] !== then[vertex * 2] || now[vertex * 2 + 1] !== then[vertex * 2 + 1]) return true;
  for (let index = 0; index < after.length; index++)
    if ((after[index]?.[vertex] ?? 0) !== (before[index]?.[vertex] ?? 0)) return true;
  return false;
};

/**
 * Refreshes the coast distance, then returns the cells whose river layers changed (with a sampling
 * halo): the terrain refresh and the rebuild stay there instead of covering the whole map.
 */
export const getRiverEditRegion = (world: WorldData, before: RiverLayerCopy): CellRegion => {
  refreshCoast(world);
  const stride = world.cellsX + 1, after = listRiverLayers(world);
  const flows: [ArrayLike<number>, ArrayLike<number>] = [world.flow, before.flow];
  const range = { maxX: -1, maxZ: -1, minX: Infinity, minZ: Infinity };
  for (let vertex = 0; vertex < world.heights.length; vertex++) {
    if (!isVertexChanged(vertex, after, before.layers, flows) &&
      !isRiverDistanceChanged(world.riverDistance, before.riverDistance, vertex)) continue;
    const x = vertex % stride, z = Math.floor(vertex / stride);
    range.minX = Math.min(range.minX, x); range.maxX = Math.max(range.maxX, x);
    range.minZ = Math.min(range.minZ, z); range.maxZ = Math.max(range.maxZ, z);
  }
  if (range.maxX < 0) return EMPTY_REGION;
  return expandRegion(world, getVertexRangeCells(world, range), RIVER_REGION_HALO);
};
