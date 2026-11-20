import { createThemeSampler } from "../../../shared/world/generation/theme-field";
import type { CellRegion } from "../../../shared/world/grid-geometry";
import { createCellRandom, deriveSeed } from "../../../shared/world/rng";
import type { WorldData } from "../../../shared/world/world-data";

/** Side of a wildlife region in world cells: 1,024 regions on a 1024² island, 4 on a 64² one. */
export const REGION_SIZE = 32;
/** Animals one island supports at most (owner D-S8, 2026-11-07). */
export const ISLAND_ANIMAL_CAP = 300;
/** Standing mature trees a region needs for its first animal. */
const MIN_TREES = 10;
/** One more animal per this many trees above the minimum (today's 10 -> 1 .. 100 -> 5 slope). */
const TREES_PER_ANIMAL = 22;
/** Animals one region supports at most, before the theme's wildlife factor. */
const REGION_CAP = 12;

/** Trees a map edit placed or brought back (`added`) and took away (`removed`). */
export interface TreeChanges {
  added: readonly number[];
  removed: readonly number[];
}

/** Animals a region of `trees` standing mature trees supports: 10 -> 1, +1 per 22, at most 12. */
export const getRegionCapacity = (trees: number) => {
  if (trees < MIN_TREES) return 0;
  return Math.min(REGION_CAP, 1 + Math.floor((trees - MIN_TREES) / TREES_PER_ANIMAL));
};

/**
 * Targets under the island cap: the capacities themselves while their sum fits, otherwise the
 * largest-remainder apportionment of `cap` (integer arithmetic). Equal remainders go by the
 * lower `ties` key (seeded per region, so a uniform forest is not filled from one map edge),
 * then the lower region index.
 */
export const apportionTargets = (
  capacities: Int32Array, cap: number, targets: Int32Array, ties?: ArrayLike<number>
) => {
  let sum = 0;
  for (let region = 0; region < capacities.length; region += 1) sum += capacities[region]!;
  if (sum <= cap) {
    targets.set(capacities);
    return;
  }
  let assigned = 0;
  const remainders = new Int32Array(capacities.length);
  for (let region = 0; region < capacities.length; region += 1) {
    const scaled = capacities[region]! * cap;
    targets[region] = Math.floor(scaled / sum);
    remainders[region] = scaled - targets[region]! * sum;
    assigned += targets[region]!;
  }
  const order = Array.from(remainders.keys())
    .filter((region) => remainders[region]! > 0)
    .sort((a, b) => remainders[b]! - remainders[a]! || (ties ? ties[a]! - ties[b]! : 0) || a - b);
  for (let index = 0; index < cap - assigned && index < order.length; index += 1) {
    const region = order[index]!;
    targets[region] = targets[region]! + 1;
  }
};

/**
 * The island's wildlife regions: a fixed 32 x 32 cell grid whose standing mature tree counters
 * move in O(1) per felled, grown, placed or removed tree, each region's capacity and its target
 * under the island cap. `onTargetChanged` hears every target change (the respawn ledger).
 */
export const createWildlifeRegions = (
  world: WorldData,
  onTargetChanged: (region: number) => void,
  cap = ISLAND_ANIMAL_CAP
) => {
  const regionsX = Math.ceil(world.cellsX / REGION_SIZE);
  const regionsZ = Math.ceil(world.cellsZ / REGION_SIZE);
  const count = regionsX * regionsZ;
  const trees = new Int32Array(count);
  const capacity = new Int32Array(count);
  const target = new Int32Array(count);
  /** Animals (simulated, pending or dormant) whose home is this region. */
  const population = new Int32Array(count);
  const wildlife = new Float32Array(count);
  const centreX = (region: number) =>
    Math.min(world.cellsX - 0.5, ((region % regionsX) + 0.5) * REGION_SIZE);
  const centreZ = (region: number) =>
    Math.min(world.cellsZ - 0.5, (Math.floor(region / regionsX) + 0.5) * REGION_SIZE);
  const theme = createThemeSampler(world, world.themeWeights);
  for (let region = 0; region < count; region += 1) {
    wildlife[region] = theme.at(centreX(region), centreZ(region)).wildlife;
  }
  /** Seeded order of equal shares above the cap (derived from the world seed, never saved). */
  const ties = Float64Array.from({ length: count },
    (_, region) => createCellRandom(deriveSeed(world.seed, "wildlife-region-ties"), region)());
  /** One bit per prop id: whether the tree is counted (idempotent count / uncount). */
  let counted = new Uint8Array(world.props.x.length);
  let sumCapacity = 0;
  let apportioned = false;
  /** While set (bulk counting), capacities move but targets wait for `endBulk`. */
  let bulk = false;

  const regionOf = (x: number, z: number) => {
    const column = Math.min(regionsX - 1, Math.max(0, Math.floor(x / REGION_SIZE)));
    const row = Math.min(regionsZ - 1, Math.max(0, Math.floor(z / REGION_SIZE)));
    return row * regionsX + column;
  };

  const setTarget = (region: number, value: number) => {
    if (target[region] === value) return;
    target[region] = value;
    onTargetChanged(region);
  };

  /** Every target from the capacities (the apportionment above the cap). */
  const retargetAll = () => {
    const before = target.slice();
    apportionTargets(capacity, cap, target, ties);
    apportioned = sumCapacity > cap;
    for (let region = 0; region < count; region += 1) {
      if (target[region] !== before[region]) onTargetChanged(region);
    }
  };

  /** Targets after a capacity change: O(1) under the cap, a full apportionment above it. */
  const retarget = (changed: number) => {
    if (bulk) return;
    if (sumCapacity <= cap && !apportioned) {
      setTarget(changed, capacity[changed]!);
      return;
    }
    retargetAll();
  };

  const updateCapacity = (region: number) => {
    const next = Math.round(getRegionCapacity(trees[region]!) * wildlife[region]!);
    if (next === capacity[region]) return;
    sumCapacity += next - capacity[region]!;
    capacity[region] = next;
    retarget(region);
  };

  const ensureCounted = (id: number) => {
    if (id < counted.length) return;
    const grown = new Uint8Array(Math.max(id + 1, counted.length * 2));
    grown.set(counted);
    counted = grown;
  };

  const regionOfProp = (id: number) => regionOf(world.props.x[id]!, world.props.z[id]!);

  /** A standing mature tree joins its region; the region, or -1 when it was counted already. */
  const countTree = (id: number) => {
    ensureCounted(id);
    if (counted[id]) return -1;
    counted[id] = 1;
    const region = regionOfProp(id);
    trees[region] = trees[region]! + 1;
    updateCapacity(region);
    return region;
  };

  /** A tree left (felled, removed): its region, or -1 when it was not counted. */
  const uncountTree = (id: number) => {
    if (id >= counted.length || !counted[id]) return -1;
    counted[id] = 0;
    const region = regionOfProp(id);
    trees[region] = trees[region]! - 1;
    updateCapacity(region);
    return region;
  };

  const forEachRegionInBounds = (
    minX: number, minZ: number, maxX: number, maxZ: number, visit: (region: number) => void
  ) => {
    if (maxX < 0 || maxZ < 0 || minX >= world.cellsX || minZ >= world.cellsZ) return;
    const first = regionOf(Math.max(0, minX), Math.max(0, minZ));
    const last = regionOf(Math.min(world.cellsX - 1, maxX), Math.min(world.cellsZ - 1, maxZ));
    const firstColumn = first % regionsX;
    const lastColumn = last % regionsX;
    for (let row = Math.floor(first / regionsX); row <= Math.floor(last / regionsX); row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) visit(row * regionsX + column);
    }
  };

  return {
    /** Many trees change at once (first count, large edits): targets follow once at `endBulk`. */
    beginBulk: () => {
      bulk = true;
    },
    capacity,
    centreX,
    centreZ,
    count,
    countTree,
    endBulk: () => {
      bulk = false;
      retargetAll();
    },
    /** Regions a circle (world units) reaches. */
    forEachRegionInCircle: (x: number, z: number, radius: number, visit: (region: number) => void) =>
      forEachRegionInBounds(x - radius, z - radius, x + radius, z + radius, visit),
    /** Regions a cell region (inclusive bounds) touches. */
    forEachRegionInCells: (cells: CellRegion, visit: (region: number) => void) =>
      forEachRegionInBounds(cells.minX, cells.minZ, cells.maxX, cells.maxZ, visit),
    isCounted: (id: number) => id < counted.length && counted[id] === 1,
    population,
    regionOf,
    regionsX,
    regionsZ,
    sumCapacity: () => sumCapacity,
    target,
    trees,
    uncountTree,
    wildlife
  };
};

export type WildlifeRegions = ReturnType<typeof createWildlifeRegions>;
