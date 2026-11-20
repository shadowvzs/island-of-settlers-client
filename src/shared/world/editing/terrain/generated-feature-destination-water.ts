import type { WorldData } from "../../world-data";

const WET = 0.01;
/** Sea reachable this far beyond the edited vertices counts as the open sea. */
const OPEN_SEA_MARGIN = 6;

interface Box {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

type WaterLayers = Pick<WorldData, "flow" | "heights" | "lakeWater" | "waterSurface">;

const isFlowing = (layers: WaterLayers, vertex: number) =>
  Math.hypot(layers.flow[vertex * 2]!, layers.flow[vertex * 2 + 1]!) > WET;

const isSeaWater = (world: WorldData, layers: WaterLayers, vertex: number) =>
  layers.waterSurface[vertex]! <= world.seaLevel + WET &&
  !layers.lakeWater?.[vertex] &&
  !isFlowing(layers, vertex);

const isWetSea = (world: WorldData, layers: WaterLayers, vertex: number) =>
  isSeaWater(world, layers, vertex) && layers.waterSurface[vertex]! - layers.heights[vertex]! > WET;

/**
 * A relief may rise out of (or sink partly into) the sea; rivers and inland lakes at the destination
 * are refused with their own reason. A moved lake never lands on other water.
 */
export const assertDestinationWater = (
  world: WorldData,
  destinations: readonly number[],
  source: ReadonlyMap<number, number>,
  lake: boolean
) => {
  for (const vertex of destinations) {
    if (world.waterDepth[vertex]! <= WET || source.has(vertex)) continue;
    if (lake) throw new Error("A moved lake must not land on the sea, a river or another lake.");
    if (isFlowing(world, vertex))
      throw new Error(
        "The destination crosses a river. Move the relief clear of it or include the connected river course."
      );
    if (!isSeaWater(world, world, vertex))
      throw new Error(
        "The destination overlaps an inland lake. Choose dry ground or move the lake first."
      );
  }
};

const boxOf = (world: WorldData, vertices: readonly number[]): Box => {
  const stride = world.cellsX + 1;
  const box = { maxX: -Infinity, maxZ: -Infinity, minX: Infinity, minZ: Infinity };
  for (const vertex of vertices) {
    const x = vertex % stride,
      z = Math.floor(vertex / stride);
    box.minX = Math.min(box.minX, x - OPEN_SEA_MARGIN);
    box.maxX = Math.max(box.maxX, x + OPEN_SEA_MARGIN);
    box.minZ = Math.min(box.minZ, z - OPEN_SEA_MARGIN);
    box.maxZ = Math.max(box.maxZ, z + OPEN_SEA_MARGIN);
  }
  return box;
};

/** Whether sea water at the seed reaches the box edge (the open sea) through wet sea vertices. */
const reachesOpenSea = (
  world: WorldData,
  layers: WaterLayers,
  seed: number,
  box: Box,
  seen: Set<number>
) => {
  const stride = world.cellsX + 1,
    queue = [seed];
  let open = false;
  seen.add(seed);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const vertex = queue[cursor]!,
      x = vertex % stride,
      z = Math.floor(vertex / stride);
    if (x <= box.minX || z <= box.minZ || x >= box.maxX || z >= box.maxZ) open = true;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ] as const) {
      const nx = x + dx,
        nz = z + dz,
        next = nz * stride + nx;
      if (nx < 0 || nz < 0 || nx > world.cellsX || nz > world.cellsZ || seen.has(next)) continue;
      if (!isWetSea(world, layers, next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return open;
};

const closedSeaSeeds = (
  world: WorldData,
  layers: WaterLayers,
  vertices: readonly number[],
  box: Box
) => {
  const seen = new Set<number>(),
    closed: number[] = [];
  for (const vertex of vertices) {
    if (seen.has(vertex) || !isWetSea(world, layers, vertex)) continue;
    if (!reachesOpenSea(world, layers, vertex, box, seen)) closed.push(vertex);
  }
  return closed;
};

/**
 * The coast stays valid when no sea water around the edit is cut off from the open sea: a relief
 * may extend a shore, but must not enclose a land-locked pool at sea level.
 */
export const assertSeaStaysOpen = (
  world: WorldData,
  draft: WaterLayers,
  changed: readonly number[]
) => {
  const stride = world.cellsX + 1,
    box = boxOf(world, changed);
  const nearby: number[] = [];
  for (const vertex of changed) {
    const x = vertex % stride,
      z = Math.floor(vertex / stride);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        if (x + dx >= 0 && z + dz >= 0 && x + dx <= world.cellsX && z + dz <= world.cellsZ)
          nearby.push((z + dz) * stride + x + dx);
  }
  const closed = closedSeaSeeds(world, draft, nearby, box);
  // A pool that was already land-locked before the edit is not this transform's doing.
  const cutOff = closed.some(
    (vertex) =>
      isWetSea(world, world, vertex) && reachesOpenSea(world, world, vertex, box, new Set())
  );
  if (!cutOff) return;
  throw new Error(
    "The moved relief would cut a pool off from the open sea. Move it fully ashore or further out to sea."
  );
};
