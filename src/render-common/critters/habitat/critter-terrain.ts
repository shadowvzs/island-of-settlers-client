import { displayFogVisibilityAt } from "../../../shared/world/fog-display";
import { createThemeSampler } from "../../../shared/world/generation/theme-field";
import {
  type CellRegion,
  getVertexSlope,
  isRegionEmpty,
  sampleBilinear,
  sampleSmooth} from "../../../shared/world/grid-geometry";
import { createStillWater, refreshStillWater } from "../../../shared/world/still-water";
import { MATERIAL, MATERIAL_COUNT, type WorldData } from "../../../shared/world/world-data";
import {
  type BlockRange,
  createHabitatField,
  forEachBlock,
  forEachBlockVertex,
  getAllBlocks,
  getRegionBlocks,
  HABITAT_BLOCK,
  type HabitatField,
  refreshHabitatField,
  sampleHabitat} from "../../birds/bird-habitat";
import { ISO_PITCH } from "../../iso-projection";
import { createRockCover } from "./critter-rock-cover";
import { createClimbableTrees } from "./critter-trees";

/**
 * What the decorative critters read of the island (built once per world): water depth and
 * stillness, the ground and water surfaces, ground materials, the theme's winter and the fog of
 * war. Samplers allocate nothing (the simulation calls them every step).
 */
export interface CritterTerrain {
  /** Water depth at a point (0 on land). */
  depth: (x: number, z: number) => number;
  /** 1 visible, 0.5 explored (dimmed), 0 hidden by the fog of war. */
  fog: (x: number, z: number) => number;
  /** Tree density 0 (open) .. 1 (dense forest), from the birds' habitat blocks. */
  forest: (x: number, z: number) => number;
  /**
   * Not seen from the iso camera: a crown or higher ground stands between the point and the
   * camera, or rendered rock covers the point itself (`underRock`).
   */
  hidden: (x: number, z: number) => boolean;
  /** Ground height (the smooth surface the renderers draw). */
  ground: (x: number, z: number) => number;
  /**
   * Map editor: the fields of the edited cells are measured again (still water, rock nearby,
   * crowns, rock cover; the own habitat field), after the edit's rocks were placed.
   */
  refresh: (cells: CellRegion) => void;
  /** Mountain rock or gravel within about 8 cells (0 none .. 1 on the mountain). */
  rocky: (x: number, z: number) => number;
  /** Ground slope (rise per run) at the vertex nearest a point. */
  slope: (x: number, z: number) => number;
  /** Rock, scree and mine gravel share 0..1 at the vertex nearest a point. */
  stony: (x: number, z: number) => number;
  /** Sand share 0..1 of the ground (beaches). */
  sand: (x: number, z: number) => number;
  /** Stillness 0..1 of calm fresh water (slow rivers, settled pools; 0 on the sea). */
  still: Float32Array;
  stillness: (x: number, z: number) => number;
  /** Winter 0..1 of the local theme (snowy islands). */
  winter: (x: number, z: number) => number;
  /**
   * Rendered rock covers the ground here (the mountain skin above the ground heights, a placed
   * rock's footprint): nothing stands there.
   */
  underRock: (x: number, z: number) => boolean;
  /** Water surface height (sea or river level; the ground on land). */
  water: (x: number, z: number) => number;
  world: WorldData;
}

/** Habitat blocks a block's rock reaches (mountain rock or gravel within about 8 cells). */
const ROCK_REACH = 2;

/** Rock (and half the gravel) per habitat block, and its spread to the blocks within reach. */
interface RockField {
  spread: Float32Array;
  sums: Float32Array;
}

/** The rock sums of the range's blocks from their vertices. */
const sumRock = (
  world: WorldData,
  habitat: HabitatField,
  sums: Float32Array,
  range: BlockRange
) => {
  forEachBlock(habitat, range, (block) => (sums[block] = 0));
  forEachBlockVertex(world, habitat, range, (vertex, block) => {
    const rock = getMaterialShare(world, vertex, MATERIAL.rock);
    const gravel = getMaterialShare(world, vertex, MATERIAL.gravel);
    sums[block]! += (rock + gravel * 0.5) / HABITAT_BLOCK ** 2;
  });
};

/** Each block of the range takes the highest rock sum within reach. */
const spreadRock = (habitat: HabitatField, field: RockField, range: BlockRange) => {
  forEachBlock(habitat, range, (block, blockX, blockZ) => {
    let highest = 0;
    for (let dz = -ROCK_REACH; dz <= ROCK_REACH; dz += 1) {
      const z = Math.min(habitat.blocksZ - 1, Math.max(0, blockZ + dz));
      for (let dx = -ROCK_REACH; dx <= ROCK_REACH; dx += 1) {
        const x = Math.min(habitat.blocksX - 1, Math.max(0, blockX + dx));
        highest = Math.max(highest, field.sums[z * habitat.blocksX + x]!);
      }
    }
    field.spread[block] = Math.min(1, highest);
  });
};

const createRockField = (world: WorldData, habitat: HabitatField): RockField => {
  const count = habitat.blocksX * habitat.blocksZ;
  const field = { spread: new Float32Array(count), sums: new Float32Array(count) };
  const all = getAllBlocks(habitat);
  sumRock(world, habitat, field.sums, all);
  spreadRock(habitat, field, all);
  return field;
};

/** Map editor: the rock of the edited cells' blocks, spread again around them. */
const refreshRockField = (
  world: WorldData,
  habitat: HabitatField,
  field: RockField,
  cells: CellRegion
) => {
  sumRock(world, habitat, field.sums, getRegionBlocks(habitat, cells, 0));
  spreadRock(habitat, field, getRegionBlocks(habitat, cells, ROCK_REACH));
};

/** The iso view ray rises this much per unit towards the camera (tan 30 degrees). */
const VIEW_RISE = Math.tan(ISO_PITCH);
const VIEW_SAMPLES = 8;

/** Mountain rock is drawn as masses this much above the ground heights (world units). */
const ROCK_MASS = 3;

/**
 * Higher ground or a mountain's rock masses (drawn well above the ground on rock ground) rise
 * above the view ray in front of the point.
 */
const isBehindHigherGround = (world: WorldData, x: number, z: number) => {
  const base = sampleSmooth(world, world.heights, x, z);
  for (let distance = 1; distance <= VIEW_SAMPLES; distance += 1) {
    const frontX = x + distance * Math.SQRT1_2;
    const frontZ = z + distance * Math.SQRT1_2;
    const rock = sampleMaterial(world, MATERIAL.rock, frontX, frontZ);
    const top = sampleSmooth(world, world.heights, frontX, frontZ) + rock * ROCK_MASS;
    if (top > base + distance * VIEW_RISE + 0.3) return true;
  }
  return false;
};

/**
 * The critters' view of the island (see CritterTerrain). Without a shared habitat field it builds
 * its own (and refreshes it after map edits; a shared one is refreshed by its owner first).
 */
export const createCritterTerrain = (world: WorldData, shared?: HabitatField): CritterTerrain => {
  const habitat = shared ?? createHabitatField(world);
  const still = createStillWater(world, world);
  const rocks = createRockField(world, habitat);
  const theme = createThemeSampler(world, world.themeWeights);
  const trees = createClimbableTrees(world);
  const rockCover = createRockCover(world);
  const ground = (x: number, z: number) => sampleSmooth(world, world.heights, x, z);
  const depth = (x: number, z: number) =>
    Math.max(0, sampleBilinear(world, world.waterDepth, x, z));
  const refresh = (cells: CellRegion) => {
    if (isRegionEmpty(cells)) return;
    if (!shared) refreshHabitatField(world, habitat, cells);
    refreshStillWater(still, world, world, cells);
    refreshRockField(world, habitat, rocks, cells);
    trees.refresh();
    rockCover.refresh(cells);
  };
  return {
    depth,
    forest: (x, z) => sampleHabitat(habitat, habitat.forest, x, z),
    fog: (x, z) => displayFogVisibilityAt(world, x, z),
    ground,
    hidden: (x, z) =>
      trees.hidesFromView(x, z) || isBehindHigherGround(world, x, z) || rockCover.isUnderRock(x, z),
    refresh,
    rocky: (x, z) => sampleHabitat(habitat, rocks.spread, x, z),
    sand: (x, z) => sampleMaterial(world, MATERIAL.sand, x, z),
    slope: (x, z) => {
      const vertex = getNearestVertex(world, x, z);
      return getVertexSlope(
        world,
        world.heights,
        vertex % (world.cellsX + 1),
        Math.floor(vertex / (world.cellsX + 1))
      );
    },
    stony: (x, z) =>
      sampleMaterial(world, MATERIAL.rock, x, z) +
      sampleMaterial(world, MATERIAL.gravel, x, z) +
      sampleMaterial(world, MATERIAL.mine, x, z),
    still,
    stillness: (x, z) => sampleBilinear(world, still, x, z),
    underRock: rockCover.isUnderRock,
    winter: (x, z) => theme.at(x, z).snow,
    water: (x, z) => {
      const surface = sampleBilinear(world, world.waterSurface, x, z);
      return depth(x, z) > 0.02 ? surface : ground(x, z);
    },
    world
  };
};

/** The vertex nearest a point (clamped to the map). */
const getNearestVertex = (world: WorldData, x: number, z: number) => {
  const vertexX = Math.min(world.cellsX, Math.max(0, Math.round(x)));
  const vertexZ = Math.min(world.cellsZ, Math.max(0, Math.round(z)));
  return vertexZ * (world.cellsX + 1) + vertexX;
};

/** Share 0..1 of a ground material at the vertex nearest a point. */
const sampleMaterial = (world: WorldData, material: number, x: number, z: number) =>
  getMaterialShare(world, getNearestVertex(world, x, z), material);

/** Share 0..1 of a ground material at a vertex. */
export const getMaterialShare = (world: WorldData, vertex: number, material: number) =>
  world.splat[vertex * MATERIAL_COUNT + material]! / 255;

export const getSandShare = (world: WorldData, vertex: number) =>
  getMaterialShare(world, vertex, MATERIAL.sand);
