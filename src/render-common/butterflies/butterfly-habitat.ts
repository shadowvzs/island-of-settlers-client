import { sampleBilinear } from "../../shared/world/grid-geometry";
import { clamp, smoothstep } from "../../shared/world/noise";
import { PROP, type WorldData } from "../../shared/world/world-data";
import { HABITAT_BLOCK, type HabitatField,sampleHabitat } from "../birds/bird-habitat";
import { getTreeSpecies } from "../props/island-trees";
import { createSnowMap, hasWinterAreas } from "../snow-map";
import type { ButterflyHabitatWeights, ButterflySpecies } from "./butterfly-species";

/** Flower props per habitat block that count as a full flower meadow. */
const FULL_FLOWER_BLOCK = 3;
/** Cells per obstacle block (each obstacle is listed in every block its circle touches). */
const OBSTACLE_BLOCK = 2;
/** Extra clearance (world units) butterflies keep from trunks, stones and shrubs. */
const CLEARANCE = 0.2;
/** Flower top above the prop foot per unit of scale (the clump's stalks, 0.17..0.27 tall). */
const FLOWER_TOP = 0.24;
/** Water deeper than this is no land to settle over. */
const LAND_DEPTH = 0.05;
const SHRUBS = new Set<number>([
  PROP.bush,
  PROP.berryBush,
  PROP.broadleafShrub,
  PROP.fieldShrub,
  PROP.riverShrub,
  PROP.willowShrub
]);

/** Prop indices listed per block (compressed rows: block b owns items[start[b] .. start[b+1]]). */
interface BlockIndex {
  items: Uint32Array;
  start: Uint32Array;
}

/** What butterflies need to know of the world: habitat, flowers to land on, things to avoid. */
export interface ButterflyField {
  flowerIndex: BlockIndex;
  /** Flower density per habitat block, 0..1. */
  flowers: Float32Array;
  habitat: HabitatField;
  obstacleBlocksX: number;
  obstacleBlocksZ: number;
  obstacleIndex: BlockIndex;
  /** Obstacle circles and tops (Infinity for trunks) per prop, 0 radius when none. */
  obstacleRadius: Float32Array;
  obstacleTop: Float32Array;
  /** Snow 0..1 at a spot (winter areas have no butterflies); null on islands without snow. */
  snowAt: ((x: number, z: number) => number) | null;
  world: WorldData;
}

/** The terms a spot is scored by (0..1 each), see readHabitatTerms. */
export interface HabitatTerms {
  edge: number;
  flowers: number;
  forest: number;
  land: boolean;
  meadow: number;
  open: number;
  water: number;
}

const createBlockIndex = (
  blockCount: number,
  forEachEntry: (add: (block: number, item: number) => void) => void
): BlockIndex => {
  const counts = new Uint32Array(blockCount + 1);
  forEachEntry((block) => (counts[block + 1]! += 1));
  for (let block = 0; block < blockCount; block += 1) counts[block + 1]! += counts[block]!;
  const items = new Uint32Array(counts[blockCount]!);
  const fill = counts.slice(0, blockCount);
  forEachEntry((block, item) => {
    items[fill[block]!] = item;
    fill[block]! += 1;
  });
  return { items, start: counts };
};

/** Obstacle circle and top of a prop (radius 0: butterflies ignore it). */
const getObstacleShape = (type: number, scale: number) => {
  if (getTreeSpecies(type) !== undefined) return { radius: 0.2 * scale, top: Infinity };
  if (type === PROP.largeRock) return { radius: 0.6 * scale, top: 0.85 * scale };
  if (type === PROP.smallRock) return { radius: 0.3 * scale, top: 0.35 * scale };
  if (SHRUBS.has(type)) return { radius: 0.45 * scale, top: 0.8 * scale };
  return { radius: 0, top: 0 };
};

const buildObstacles = (world: WorldData) => {
  const { props } = world;
  const radius = new Float32Array(props.count);
  const top = new Float32Array(props.count);
  for (let prop = 0; prop < props.count; prop += 1) {
    const shape = getObstacleShape(props.types[prop]!, props.scale[prop]!);
    radius[prop] = shape.radius;
    top[prop] = props.y[prop]! + shape.top;
  }
  const blocksX = Math.ceil(world.cellsX / OBSTACLE_BLOCK);
  const blocksZ = Math.ceil(world.cellsZ / OBSTACLE_BLOCK);
  const toBlock = (value: number, count: number) =>
    clamp(Math.floor(value / OBSTACLE_BLOCK), 0, count - 1);
  const addCircle = (add: (block: number, item: number) => void, prop: number) => {
    const reach = radius[prop]! + CLEARANCE;
    const x = props.x[prop]!;
    const z = props.z[prop]!;
    const lastX = toBlock(x + reach, blocksX);
    const lastZ = toBlock(z + reach, blocksZ);
    for (let blockZ = toBlock(z - reach, blocksZ); blockZ <= lastZ; blockZ += 1)
      for (let blockX = toBlock(x - reach, blocksX); blockX <= lastX; blockX += 1)
        add(blockZ * blocksX + blockX, prop);
  };
  const index = createBlockIndex(blocksX * blocksZ, (add) => {
    for (let prop = 0; prop < props.count; prop += 1) if (radius[prop]! > 0) addCircle(add, prop);
  });
  return { blocksX, blocksZ, index, radius, top };
};

const getHabitatBlock = (habitat: HabitatField, x: number, z: number) => {
  const blockX = clamp(Math.floor(x / HABITAT_BLOCK), 0, habitat.blocksX - 1);
  const blockZ = clamp(Math.floor(z / HABITAT_BLOCK), 0, habitat.blocksZ - 1);
  return blockZ * habitat.blocksX + blockX;
};

const buildFlowers = (world: WorldData, habitat: HabitatField) => {
  const { props } = world;
  const blockCount = habitat.blocksX * habitat.blocksZ;
  const density = new Float32Array(blockCount);
  const index = createBlockIndex(blockCount, (add) => {
    for (let prop = 0; prop < props.count; prop += 1) {
      if (props.types[prop] !== PROP.flowers) continue;
      add(getHabitatBlock(habitat, props.x[prop]!, props.z[prop]!), prop);
    }
  });
  for (let block = 0; block < blockCount; block += 1) {
    const count = index.start[block + 1]! - index.start[block]!;
    density[block] = Math.min(1, count / FULL_FLOWER_BLOCK);
  }
  return { density, index };
};

/** Builds the butterfly field once per world on top of the birds' habitat blocks. */
export const createButterflyField = (world: WorldData, habitat: HabitatField): ButterflyField => {
  const flowers = buildFlowers(world, habitat);
  const obstacles = buildObstacles(world);
  return {
    flowerIndex: flowers.index,
    flowers: flowers.density,
    habitat,
    obstacleBlocksX: obstacles.blocksX,
    obstacleBlocksZ: obstacles.blocksZ,
    obstacleIndex: obstacles.index,
    obstacleRadius: obstacles.radius,
    obstacleTop: obstacles.top,
    snowAt: hasWinterAreas(world) ? createSnowMap(world).sample : null,
    world
  };
};

/**
 * Map editor: the flowers and obstacles are listed again after props were placed or removed
 * (a pass over the props; the habitat blocks are refreshed by the birds).
 */
export const refreshButterflyProps = (field: ButterflyField) => {
  const flowers = buildFlowers(field.world, field.habitat);
  const obstacles = buildObstacles(field.world);
  field.flowerIndex = flowers.index;
  field.flowers = flowers.density;
  field.obstacleIndex = obstacles.index;
  field.obstacleRadius = obstacles.radius;
  field.obstacleTop = obstacles.top;
};

/** Scratch terms (hot path: no allocation). */
const terms: HabitatTerms = {
  edge: 0,
  flowers: 0,
  forest: 0,
  land: false,
  meadow: 0,
  open: 0,
  water: 0
};

/**
 * Habitat terms at a spot: meadow (grass out of the woods), flowers, river / lake edge (water
 * nearby, grass on the bank), forest edge or clearing; plus land and lifted fog.
 */
export const readHabitatTerms = (field: ButterflyField, x: number, z: number) => {
  const { habitat, world } = field;
  const forest = sampleHabitat(habitat, habitat.forest, x, z);
  const grass = sampleHabitat(habitat, habitat.grass, x, z);
  terms.forest = forest;
  terms.meadow = grass * (1 - forest);
  terms.flowers = sampleHabitat(habitat, field.flowers, x, z);
  terms.water = sampleHabitat(habitat, habitat.water, x, z) * Math.min(1, grass * 2);
  terms.edge = smoothstep(0.05, 0.25, forest) * (1 - smoothstep(0.45, 0.7, forest));
  terms.edge *= Math.min(1, grass * 2 + 0.3);
  terms.open = sampleHabitat(habitat, habitat.open, x, z) * (1 - (field.snowAt?.(x, z) ?? 0));
  terms.land = sampleBilinear(world, world.waterDepth, x, z) < LAND_DEPTH;
  return terms;
};

/** How much a species likes these terms (about 0..1). */
export const getSpeciesAffinity = (weights: ButterflyHabitatWeights, spot: HabitatTerms) =>
  Math.min(
    1,
    spot.meadow * weights.meadow * 0.7 +
      spot.flowers * weights.flowers +
      spot.water * weights.water * 0.7 +
      spot.edge * weights.edge * 0.6
  );

/** Water, dense forest and hidden fog hold no butterflies (0); open land 1. */
const getZoneFactor = (spot: HabitatTerms) =>
  spot.land ? (1 - smoothstep(0.55, 0.85, spot.forest)) * spot.open : 0;

const isInsideWorld = (world: WorldData, x: number, z: number) =>
  x > 0 && z > 0 && x < world.cellsX && z < world.cellsZ;

/**
 * Zone score of a world point: 0 (water, dense forest, rock, sand, hidden fog, off the map) ..
 * 1 (a flowery meadow), for the best of the given species.
 */
export const scoreButterflyZone = (
  field: ButterflyField,
  species: readonly ButterflySpecies[],
  x: number,
  z: number
) => {
  if (!isInsideWorld(field.world, x, z)) return 0;
  const spot = readHabitatTerms(field, x, z);
  const factor = getZoneFactor(spot);
  if (factor === 0) return 0;
  let best = 0;
  for (const kind of species) best = Math.max(best, getSpeciesAffinity(kind.habitat, spot));
  return best * factor;
};

/** Zone score of a world point for one species (its flight keeps to it). */
export const scoreSpeciesZone = (
  field: ButterflyField,
  species: ButterflySpecies,
  x: number,
  z: number
) => {
  if (!isInsideWorld(field.world, x, z)) return 0;
  const spot = readHabitatTerms(field, x, z);
  return getSpeciesAffinity(species.habitat, spot) * getZoneFactor(spot);
};

/** Where a butterfly sits on a flower prop: the top of its stalks. */
export const getFlowerTop = (world: WorldData, prop: number) =>
  world.props.y[prop]! + FLOWER_TOP * world.props.scale[prop]!;

/** Nearest flower prop within `radius` of (x, z), skipping `exclude`; -1 when there is none. */
export const findFlower = (
  field: ButterflyField,
  x: number,
  z: number,
  radius: number,
  exclude: number
) => {
  const { habitat, world } = field;
  const { props } = world;
  const centerX = Math.floor(x / HABITAT_BLOCK);
  const centerZ = Math.floor(z / HABITAT_BLOCK);
  let best = -1;
  let bestDistance = radius * radius;
  for (let blockZ = centerZ - 1; blockZ <= centerZ + 1; blockZ += 1) {
    if (blockZ < 0 || blockZ >= habitat.blocksZ) continue;
    for (let blockX = centerX - 1; blockX <= centerX + 1; blockX += 1) {
      if (blockX < 0 || blockX >= habitat.blocksX) continue;
      const block = blockZ * habitat.blocksX + blockX;
      const { items, start } = field.flowerIndex;
      for (let item = start[block]!; item < start[block + 1]!; item += 1) {
        const prop = items[item]!;
        const distance = (props.x[prop]! - x) ** 2 + (props.z[prop]! - z) ** 2;
        if (prop === exclude || distance >= bestDistance) continue;
        best = prop;
        bestDistance = distance;
      }
    }
  }
  return best;
};

/** Result of avoidObstacles (scratch, no allocation). */
interface Avoidance {
  /** Lowest height to fly at here (above stones and shrubs). */
  floor: number;
  /** Whether the point was pushed out of a trunk / stone / shrub circle. */
  pushed: boolean;
  x: number;
  z: number;
}

const avoidance: Avoidance = { floor: -Infinity, pushed: false, x: 0, z: 0 };

const getObstacleBlock = (field: ButterflyField, x: number, z: number) => {
  const blockX = clamp(Math.floor(x / OBSTACLE_BLOCK), 0, field.obstacleBlocksX - 1);
  const blockZ = clamp(Math.floor(z / OBSTACLE_BLOCK), 0, field.obstacleBlocksZ - 1);
  return blockZ * field.obstacleBlocksX + blockX;
};

/**
 * Cheap clearance from the props in this block: below a stone's or shrub's top the point is
 * pushed out of its circle (or flies over it when close to the top); trunks always push.
 */
export const avoidObstacles = (field: ButterflyField, x: number, y: number, z: number) => {
  const { props } = field.world;
  const { items, start } = field.obstacleIndex;
  const block = getObstacleBlock(field, x, z);
  avoidance.floor = -Infinity;
  avoidance.pushed = false;
  avoidance.x = x;
  avoidance.z = z;
  for (let item = start[block]!; item < start[block + 1]!; item += 1) {
    const prop = items[item]!;
    const reach = field.obstacleRadius[prop]! + CLEARANCE;
    const dx = avoidance.x - props.x[prop]!;
    const dz = avoidance.z - props.z[prop]!;
    const distance = Math.hypot(dx, dz);
    if (distance >= reach) continue;
    const top = field.obstacleTop[prop]!;
    if (y > top - 0.25) {
      avoidance.floor = Math.max(avoidance.floor, top + CLEARANCE);
      continue;
    }
    const scale = reach / Math.max(distance, 0.001);
    avoidance.x = props.x[prop]! + dx * scale;
    avoidance.z = props.z[prop]! + dz * scale;
    avoidance.pushed = true;
  }
  return avoidance;
};
