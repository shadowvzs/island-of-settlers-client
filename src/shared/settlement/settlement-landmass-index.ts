import { BLOCKING, type WorldData } from "../world/world-data";

/** Dry terrain components; roads, buildings and cliffs never split or join them. */
export interface LandmassIndex {
  /** -1 on water, otherwise the component number. */
  labels: Int32Array;
  count: number;
  revision: number;
}

interface CachedLandmassIndex {
  index: LandmassIndex;
  revision: number;
}

const caches = new WeakMap<WorldData, CachedLandmassIndex>();
const NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

const buildLandmassIndex = (world: WorldData, revision: number): LandmassIndex => {
  const cells = world.cellsX * world.cellsZ;
  const labels = new Int32Array(cells).fill(-1);
  const queue = new Int32Array(cells);
  let count = 0;
  for (let start = 0; start < cells; start++) {
    if (labels[start] !== -1 || world.blocking[start] === BLOCKING.water) continue;
    let head = 0, tail = 0;
    labels[start] = count;
    queue[tail++] = start;
    while (head < tail) {
      const cell = queue[head++]!, x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
      for (const [dx, dz] of NEIGHBOURS) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ) continue;
        const next = nz * world.cellsX + nx;
        if (labels[next] !== -1 || world.blocking[next] === BLOCKING.water) continue;
        labels[next] = count;
        queue[tail++] = next;
      }
    }
    count++;
  }
  return { count, labels, revision };
};

/** Terrain component labels, rebuilt only when the terrain revision changes. */
export const landmassIndex = (world: WorldData) => {
  const revision = world.terrainRevision ?? 0;
  const cached = caches.get(world);
  if (cached?.revision === revision) return cached.index;
  const index = buildLandmassIndex(world, revision);
  caches.set(world, { index, revision });
  return index;
};

export const landmassCount = (world: WorldData) => landmassIndex(world).count;

export const landmassAt = (world: WorldData, point: { x: number; z: number }) => {
  if (point.x < 0 || point.z < 0 || point.x >= world.cellsX || point.z >= world.cellsZ) return -1;
  return landmassIndex(world).labels[Math.floor(point.z) * world.cellsX + Math.floor(point.x)] ?? -1;
};
