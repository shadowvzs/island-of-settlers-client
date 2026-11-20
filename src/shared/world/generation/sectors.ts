import { getCellCount, type GridSize } from "../grid-geometry";
import { createRandom, deriveSeed } from "../rng";
import { BLOCKING, FOG, NO_SECTOR } from "../world-data";
import { computeDistanceField } from "./distance-field";
import { samplePoissonDisc } from "./poisson-disc";

const SECTOR_SPACING = 26;

/** Sector seeds: Poisson spread land cells, the start always seeds sector 0. */
const pickSectorSeeds = (
  grid: GridSize,
  seed: number,
  blocking: Uint8Array,
  start: { x: number; z: number }
) => {
  const random = createRandom(deriveSeed(seed, "sectors"));
  const seeds = [start.x, start.z];
  const points = samplePoissonDisc(grid.cellsX, grid.cellsZ, SECTOR_SPACING, random);
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index]!;
    const z = points[index + 1]!;
    const cell = Math.floor(z) * grid.cellsX + Math.floor(x);
    if (blocking[cell] === BLOCKING.water) continue;
    if (Math.hypot(x - start.x, z - start.z) < SECTOR_SPACING * 0.8) continue;
    seeds.push(x, z);
  }
  return seeds;
};

const findNearestSeed = (seeds: number[], x: number, z: number) => {
  let nearest = 0;
  let best = Infinity;
  for (let index = 0; index < seeds.length; index += 2) {
    const distance = (seeds[index]! - x) ** 2 + (seeds[index + 1]! - z) ** 2;
    if (distance < best) {
      best = distance;
      nearest = index / 2;
    }
  }
  return nearest;
};

/** Voronoi sectors over land cells; water cells get NO_SECTOR. */
export const createSectors = (
  grid: GridSize,
  seed: number,
  blocking: Uint8Array,
  start: { x: number; z: number }
) => {
  const seeds = pickSectorSeeds(grid, seed, blocking, start);
  const sector = new Uint16Array(getCellCount(grid)).fill(NO_SECTOR);
  for (let cellZ = 0; cellZ < grid.cellsZ; cellZ += 1) {
    for (let cellX = 0; cellX < grid.cellsX; cellX += 1) {
      const index = cellZ * grid.cellsX + cellX;
      if (blocking[index] === BLOCKING.water) continue;
      sector[index] = findNearestSeed(seeds, cellX + 0.5, cellZ + 0.5);
    }
  }
  return sector;
};

const collectNeighbourSectors = (grid: GridSize, sector: Uint16Array, visibleSector: number) => {
  const neighbours = new Set<number>();
  for (let cellZ = 0; cellZ < grid.cellsZ; cellZ += 1) {
    for (let cellX = 1; cellX < grid.cellsX; cellX += 1) {
      const index = cellZ * grid.cellsX + cellX;
      const pairs = [
        [sector[index]!, sector[index - 1]!],
        [sector[index]!, cellZ > 0 ? sector[index - grid.cellsX]! : NO_SECTOR]
      ];
      for (const [a, b] of pairs) {
        if (a === visibleSector && b !== NO_SECTOR && b !== visibleSector) neighbours.add(b!);
        if (b === visibleSector && a !== NO_SECTOR && a !== visibleSector) neighbours.add(a!);
      }
    }
  }
  return neighbours;
};

const SEA_VISIBLE_RANGE = 8;

/**
 * Start sector visible, its neighbours discovered, other land hidden. The sea is discovered,
 * and visible close to visible land. The cell grid is passed as a vertex grid one smaller, so the
 * vertex based distance field runs per cell.
 */
export const createFog = (grid: GridSize, sector: Uint16Array, startSector: number) => {
  const discovered = collectNeighbourSectors(grid, sector, startSector);
  const cellGrid = { cellsX: grid.cellsX - 1, cellsZ: grid.cellsZ - 1 };
  const toVisibleLand = computeDistanceField(cellGrid, (index) => sector[index] === startSector);
  return Uint8Array.from(sector, (value, index) => {
    if (value === startSector) return FOG.visible;
    if (value === NO_SECTOR) {
      return toVisibleLand[index]! <= SEA_VISIBLE_RANGE ? FOG.visible : FOG.discovered;
    }
    return discovered.has(value) ? FOG.discovered : FOG.hidden;
  });
};
