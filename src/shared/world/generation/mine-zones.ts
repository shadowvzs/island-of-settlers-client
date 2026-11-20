import { type GridSize } from "../grid-geometry";
import { MinHeap } from "../min-heap";
import { createRandom, deriveSeed, pickWeighted, type Random,shuffle } from "../rng";
import { createMountainField } from "../rock-cover";
import { type MineZone, NO_MINE_ZONE, ORE, type Ore } from "../world-data";
import { computeDistanceField } from "./distance-field";
import {
  blurVertices,
  createMineApron,
  createOpenGround,
  findCellPieces,
  type MineTerrain
} from "./mine-apron";
import { countDepositMines } from "./mine-sites";
import { createRoughGround, type RoughGround } from "./rough-ground";
import { scaleCount } from "./world-scale";

export type { MineTerrain } from "./mine-apron";

export interface MineLayers {
  /** Per vertex 0..1: mine gravel of the band touching the massif rock (splat only). */
  massifContact: Float32Array;
  /**
   * Per vertex 0..1: the mine land and the even band around the massifs the deposits grow in
   * (soft edge); kept clear of trees and counted as mountain by the tree line, so the visible
   * gravel narrows while the meadow at the mountain foot stays open.
   */
  massifFoot: Float32Array;
  /** Per vertex 0..1: share of mine ground (soft edge), drives the splat and clears vegetation. */
  mineGround: Float32Array;
  mineZone: Uint16Array;
  mineZones: MineZone[];
  oreAmount: Uint8Array;
}

/**
 * Ore deposits per 128 x 128 reference area: rare patches in the gravel (the rest is barren);
 * every map gets at least one per start ore where its gravel has room.
 */
const DEPOSITS_PER_REFERENCE = 2;
/**
 * Mine buildings a deposit holds (MINE_FOOTPRINT packing): it grows until it fits its random
 * target in this range; one cut off below the minimum by the gravel edge is dropped.
 */
const DEPOSIT_MINES = { max: 12, min: 3 } as const;
/** Growth limit (cells), and the size from which the mine count is checked. */
const DEPOSIT_CELLS = { check: 12, max: 170 } as const;
/** Spacing of deposit seeds (cells), and how deep inside the gravel a seed lies. */
const DEPOSIT_SPACING = 22;
/** Growth trials: deepest start land spots tried for the start deposit, and in all. */
const START_TRIALS = 12;
const MAX_TRIALS = 80;
const SEED_DEPTH = 2;
/** One deposit is guaranteed on the start's landmass within this reach. */
const START_REACH = 64;
/** Ore of the deposits nearest to the start, in order; further deposits draw from the weights. */
const START_ORES: readonly Ore[] = [ORE.coal, ORE.iron, ORE.granite, ORE.gold];
const ORE_WEIGHTS: Partial<Record<Ore, number>> = {
  [ORE.coal]: 3,
  [ORE.iron]: 3,
  [ORE.gold]: 1.5,
  [ORE.granite]: 2
};
/** Ore amount: richness x (edge .. core); the core lies this many cells inside the edge. */
const ORE_EDGE_SHARE = 0.45;
const ORE_CORE_DEPTH = 4;

/** Distance (cells) of every cell to the nearest unmarked cell: on the cell grid as vertices. */
const getCellDepth = (grid: GridSize, isOutside: (cell: number) => boolean) =>
  computeDistanceField({ cellsX: grid.cellsX - 1, cellsZ: grid.cellsZ - 1 }, isOutside);

const getCellDistance = (grid: GridSize, cell: number, point: { x: number; z: number }) =>
  Math.hypot((cell % grid.cellsX) + 0.5 - point.x, Math.floor(cell / grid.cellsX) + 0.5 - point.z);

/**
 * Cells on the start's landmass (vertex flood over land; river beds count as land, the sea
 * splits the archipelago islands), within the start reach.
 */
const createStartLand = (grid: GridSize, terrain: MineTerrain) => {
  const stride = grid.cellsX + 1;
  const isLand = (vertex: number) =>
    terrain.waterDepth[vertex] === 0 || terrain.riverDistance[vertex]! < 0.5;
  const reached = new Uint8Array(terrain.heights.length);
  const first = Math.floor(terrain.start.z) * stride + Math.floor(terrain.start.x);
  const queue = [first];
  reached[first] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    const vertex = queue[head]!;
    const x = vertex % stride;
    const next = [x > 0 ? vertex - 1 : -1, x < grid.cellsX ? vertex + 1 : -1, vertex - stride];
    for (const neighbour of [...next, vertex + stride]) {
      if (neighbour < 0 || neighbour >= reached.length || reached[neighbour] === 1) continue;
      if (!isLand(neighbour)) continue;
      reached[neighbour] = 1;
      queue.push(neighbour);
    }
  }
  return (cell: number) => {
    const vertex = Math.floor(cell / grid.cellsX) * stride + (cell % grid.cellsX);
    return reached[vertex] === 1 && getCellDistance(grid, cell, terrain.start) <= START_REACH;
  };
};

/**
 * Seed candidates deep enough in the gravel, in trial order: the start land's deepest first (one
 * of them becomes the guaranteed deposit near the start), then the rest at random.
 */
const listSeedCandidates = (
  depth: Float32Array,
  isStartLand: (cell: number) => boolean,
  random: Random
) => {
  const deep = [...depth.keys()].filter((cell) => depth[cell]! >= SEED_DEPTH);
  // Narrow gravel everywhere (small maps): any gravel cell may seed (the deposit spreads out).
  const candidates = deep.length > 0 ? deep : [...depth.keys()].filter((cell) => depth[cell]! >= 1);
  const nearStart = candidates.filter(isStartLand).sort((a, b) => depth[b]! - depth[a]! || a - b);
  const others = shuffle(
    candidates.filter((cell) => !isStartLand(cell)),
    random
  );
  return { nearStart: nearStart.slice(0, START_TRIALS), others };
};

/** Neighbour cells (4-neighbourhood) inside the grid. */
const forEachNeighbour = (grid: GridSize, cell: number, visit: (neighbour: number) => void) => {
  const x = cell % grid.cellsX;
  const z = Math.floor(cell / grid.cellsX);
  if (x > 0) visit(cell - 1);
  if (x < grid.cellsX - 1) visit(cell + 1);
  if (z > 0) visit(cell - grid.cellsX);
  if (z < grid.cellsZ - 1) visit(cell + grid.cellsX);
};

/** What a growing deposit reads: the gravel, its depth, the heights and the claimed cells. */
interface DepositGround {
  apron: Uint8Array;
  depth: Float32Array;
  /** Open ground next to the gravel a deposit may spread over (it turns to gravel). */
  open: Uint8Array;
  heights: Float32Array;
  rough: RoughGround;
  taken: Uint16Array;
  waterDepth: Float32Array;
}

/** Mine buildings of the deposit: at least (gravel access only) and at most (any dry land). */
const countMineRange = (
  grid: GridSize,
  ground: DepositGround,
  deposit: Uint8Array,
  cells: number[]
) => {
  const { apron, rough, waterDepth } = ground;
  const land = { apron, deposit, loose: false, rough, waterDepth };
  return {
    least: countDepositMines(grid, ground.heights, land, cells),
    most: countDepositMines(grid, ground.heights, { ...land, loose: true }, cells)
  };
};

/**
 * Best-first growth from the seed over free gravel cells, deeper ones first (a little jitter
 * keeps the outline grown, not round; with `spread`, open ground beside too narrow gravel last,
 * it turns to gravel), until it surely holds its target number of mine
 * buildings; a cell that would let it hold more than the maximum is given back. Returns no
 * cells when the gravel around the seed cannot surely hold the minimum.
 */
const growDeposit = (
  grid: GridSize,
  ground: DepositGround,
  seed: number,
  random: Random,
  spread: boolean
) => {
  const range = DEPOSIT_MINES.max - DEPOSIT_MINES.min + 1;
  const target = DEPOSIT_MINES.min + Math.floor(random() * range);
  const deposit = new Uint8Array(ground.depth.length);
  const queued = new Uint8Array(ground.depth.length);
  const heap = new MinHeap(64);
  const cells: number[] = [];
  let least = 0;
  heap.push(seed, 0);
  queued[seed] = 1;
  while (heap.size > 0 && cells.length < DEPOSIT_CELLS.max && least < target) {
    const cell = heap.pop();
    cells.push(cell);
    deposit[cell] = 1;
    if (cells.length >= DEPOSIT_CELLS.check) {
      const mines = countMineRange(grid, ground, deposit, cells);
      if (mines.most > DEPOSIT_MINES.max) {
        cells.pop();
        deposit[cell] = 0;
        continue;
      }
      least = mines.least;
    }
    forEachNeighbour(grid, cell, (next) => {
      if (queued[next] === 1 || ground.taken[next] !== 0) return;
      const isGravel = ground.depth[next]! >= 1;
      if (!isGravel && (!spread || ground.open[next] !== 1)) return;
      queued[next] = 1;
      heap.push(next, -(Math.min(ground.depth[next]!, 4) + random() * 2));
    });
  }
  return least >= DEPOSIT_MINES.min ? cells : [];
};

/** Ore per deposit by start distance: coal, iron, granite, gold first, then by weight. */
const chooseOre = (order: number, random: Random): Ore => {
  const startOre = START_ORES[order];
  if (startOre !== undefined) return startOre;
  const ores = Object.keys(ORE_WEIGHTS).map(Number) as Ore[];
  const weights = ores.map((ore) => ORE_WEIGHTS[ore] ?? 0);
  return ores[pickWeighted(weights, random)] ?? ORE.coal;
};

/** A zone record over its cells: count and mean position, no ore yet. */
export const createZoneRecord = (grid: GridSize, cells: number[], id: number): MineZone => {
  let sumX = 0;
  let sumZ = 0;
  for (const cell of cells) {
    sumX += (cell % grid.cellsX) + 0.5;
    sumZ += Math.floor(cell / grid.cellsX) + 0.5;
  }
  const count = cells.length;
  return {
    cellCount: count,
    centreX: sumX / count,
    centreZ: sumZ / count,
    id,
    ore: ORE.none,
    richness: 0,
    surveyed: false
  };
};

/** Grows the deposits (ids 1..) into the gravel, up to the count; returns their records. */
const placeDeposits = (
  grid: GridSize,
  land: { apron: Uint8Array; mineZone: Uint16Array; terrain: MineTerrain },
  isStartLand: (cell: number) => boolean,
  random: Random
) => {
  const { apron, mineZone, terrain } = land;
  const depth = getCellDepth(grid, (cell) => apron[cell] !== 1);
  const { heights, riverDistance, waterDepth } = terrain;
  const rough = createRoughGround(grid, { heights, riverDistance });
  const open = createOpenGround(grid, terrain);
  const ground = { apron, depth, heights, open, rough, taken: mineZone, waterDepth };
  const limit = Math.max(scaleCount(grid, DEPOSITS_PER_REFERENCE), START_ORES.length);
  const deposits: MineZone[] = [];
  const seeds: number[] = [];
  const isSpaced = (cell: number) =>
    seeds.every((other) => {
      const point = { x: (other % grid.cellsX) + 0.5, z: Math.floor(other / grid.cellsX) + 0.5 };
      return getCellDistance(grid, cell, point) >= DEPOSIT_SPACING;
    });
  const tryDeposit = (seedCell: number) => {
    if (mineZone[seedCell] !== NO_MINE_ZONE || !isSpaced(seedCell)) return false;
    const onGravel = growDeposit(grid, ground, seedCell, random, false);
    const cells =
      onGravel.length > 0 ? onGravel : growDeposit(grid, ground, seedCell, random, true);
    if (cells.length === 0) return false;
    const zone = createZoneRecord(grid, cells, deposits.length + 1);
    deposits.push(zone);
    seeds.push(seedCell);
    for (const cell of cells) mineZone[cell] = zone.id;
    return true;
  };
  const { nearStart, others } = listSeedCandidates(depth, isStartLand, random);
  nearStart.some(tryDeposit);
  let trials = 0;
  for (const cell of others) {
    if (deposits.length >= limit || trials >= MAX_TRIALS) break;
    if (!isSpaced(cell) || mineZone[cell] !== NO_MINE_ZONE) continue;
    trials += 1;
    tryDeposit(cell);
  }
  return deposits;
};

/** Ores and richness: by distance to the start (the nearest four get the start ores). */
const assignOres = (deposits: MineZone[], start: { x: number; z: number }, seed: number) => {
  const random = createRandom(deriveSeed(seed, "ore"));
  const distance = (zone: MineZone) => Math.hypot(zone.centreX - start.x, zone.centreZ - start.z);
  [...deposits]
    .sort((a, b) => distance(a) - distance(b))
    .forEach((zone, order) => {
      zone.ore = chooseOre(order, random);
      zone.richness = 0.6 + random() * 0.4;
    });
};

/** Every gravel piece left between the deposits becomes a barren zone (no ore, no glints). */
const addBarrenZones = (
  grid: GridSize,
  apron: Uint8Array,
  mineZone: Uint16Array,
  zones: MineZone[]
) => {
  const free = Uint8Array.from(apron, (value, cell) =>
    value === 1 && mineZone[cell] === NO_MINE_ZONE ? 1 : 0
  );
  for (const piece of findCellPieces(grid, free)) {
    const zone = createZoneRecord(grid, piece, zones.length + 1);
    zones.push(zone);
    for (const cell of piece) mineZone[cell] = zone.id;
  }
};

/** Ore of a deposit cell (1..255): the richness, from the edge share (core 0) to full (core 1). */
export const getOreAmount = (richness: number, core: number) => {
  const share = ORE_EDGE_SHARE + (1 - ORE_EDGE_SHARE) * Math.max(0, Math.min(1, core));
  return Math.max(1, Math.round(255 * richness * share));
};

/** Ore left per cell: the deposit richness, rising from its edge to its core. */
const createOreAmount = (grid: GridSize, mineZone: Uint16Array, zones: MineZone[]) => {
  const depth = getCellDepth(grid, (cell) => mineZone[cell] === NO_MINE_ZONE);
  return Uint8Array.from(mineZone, (zoneId, cell) => {
    const zone = zones[zoneId - 1];
    if (!zone || zone.ore === ORE.none) return 0;
    return getOreAmount(zone.richness, (depth[cell]! - 1) / ORE_CORE_DEPTH);
  });
};

/**
 * Vertex share of the marked cells around it, softened twice (3 x 3), so the ground edge
 * feathers over a few vertices instead of jumping (the splat is blurred before the mine ground
 * lands).
 */
const createCellShare = (grid: GridSize, isMarked: (cell: number) => boolean) => {
  const stride = grid.cellsX + 1;
  const rows = grid.cellsZ + 1;
  const isMarkedCell = (cellX: number, cellZ: number) =>
    cellX >= 0 &&
    cellZ >= 0 &&
    cellX < grid.cellsX &&
    cellZ < grid.cellsZ &&
    isMarked(cellZ * grid.cellsX + cellX);
  const share = new Float32Array(stride * rows);
  for (let z = 0; z < rows; z += 1) {
    for (let x = 0; x < stride; x += 1) {
      const count =
        Number(isMarkedCell(x - 1, z - 1)) +
        Number(isMarkedCell(x, z - 1)) +
        Number(isMarkedCell(x - 1, z)) +
        Number(isMarkedCell(x, z));
      share[z * stride + x] = count / 4;
    }
  }
  return blurVertices(grid, blurVertices(grid, share));
};

/**
 * Mine land: a few rare ore deposits grown in the gravel band around every massif (ids first,
 * one ore each, ore amount per cell), and the visible broken gravel band at the massif feet
 * (mine-apron.ts): every gravel piece of it outside the deposits is a barren zone. Deterministic
 * per seed.
 */
export const placeMineZones = (grid: GridSize, seed: number, terrain: MineTerrain): MineLayers => {
  const mountain = createMountainField(grid, terrain.heights);
  const { apron, contact, deposit } = createMineApron(grid, seed, terrain, mountain);
  const mineZone = new Uint16Array(apron.length);
  const random = createRandom(deriveSeed(seed, "mine-zones"));
  const land = { apron: deposit, mineZone, terrain };
  const zones = placeDeposits(grid, land, createStartLand(grid, terrain), random);
  assignOres(zones, terrain.start, seed);
  addBarrenZones(grid, apron, mineZone, zones);
  const isMine = (cell: number) => mineZone[cell] !== NO_MINE_ZONE;
  return {
    massifContact: contact,
    massifFoot: createCellShare(grid, (cell) => isMine(cell) || deposit[cell] === 1),
    mineGround: createCellShare(grid, isMine),
    mineZone,
    mineZones: zones,
    oreAmount: createOreAmount(grid, mineZone, zones)
  };
};
