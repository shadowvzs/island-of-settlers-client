import { displayFogAt } from "../../shared/world/fog-display";
import { createThemeSampler } from "../../shared/world/generation/theme-field";
import { type CellRegion,isRegionEmpty, sampleBilinear } from "../../shared/world/grid-geometry";
import { clamp } from "../../shared/world/noise";
import { FOG, MATERIAL, MATERIAL_COUNT, PROP, type WorldData } from "../../shared/world/world-data";
import { getTreeSpecies } from "../props/island-trees";
import type { BirdSpecies, HabitatPreference } from "./bird-species";

/** Cells per habitat block: coarse enough to build fast, fine enough for rivers and groves. */
export const HABITAT_BLOCK = 4;
/** Trees per block that count as dense forest. */
const DENSE_FOREST_TREES = 6;
/** Crown top above the foot per unit of placement scale (generous: crowns are wide and tall). */
const CANOPY_TOP = 3.3;
/** Big bushes per block that count as dense cover, their least scale and top per unit scale. */
const COVER_BUSH = { dense: 4, minScale: 0.95, top: 1.1 } as const;
const COVER_BUSHES = new Set<number>([PROP.bush, PROP.broadleafShrub, PROP.willowShrub]);
/** Cover share a perch needs, and how deep (world units) a bird sits inside it. */
const COVER_PERCH = { depth: 0.6, least: 0.45, lift: 0.3 } as const;

/** Coarse habitat channels per block (0..1), plus the canopy top and surface heights. */
export interface HabitatField {
  blocksX: number;
  blocksZ: number;
  /** Absolute height of the crown tops (the surface where there is no forest). */
  canopy: Float32Array;
  /** Bird cover (0..1): leafy crowns (no palms) and big bushes, where perched birds hide. */
  cover: Float32Array;
  /** Absolute height of the cover tops (the surface where there is none). */
  coverTop: Float32Array;
  forest: Float32Array;
  grass: Float32Array;
  /** 1 where the fog of war is lifted, scaled by the theme's wildlife factor (fewer in snow). */
  open: Float32Array;
  /** Exact ground or water surface height at a world point (landing on the grass, shadows). */
  surface: (x: number, z: number) => number;
  water: Float32Array;
}

const createChannels = (count: number) => ({
  canopy: new Float32Array(count),
  cover: new Float32Array(count),
  coverTop: new Float32Array(count),
  forest: new Float32Array(count),
  grass: new Float32Array(count),
  open: new Float32Array(count),
  water: new Float32Array(count)
});

/** Ground or water surface height of a vertex. */
const getSurface = (world: WorldData, vertex: number) =>
  world.heights[vertex]! + world.waterDepth[vertex]!;

const isRiver = (world: WorldData, vertex: number) =>
  world.flow[vertex * 2] !== 0 || world.flow[vertex * 2 + 1] !== 0;

/** Rivers and the near shore weigh most; open sea far from land is barely water habitat. */
const getWaterWeight = (world: WorldData, vertex: number) => {
  if (world.waterDepth[vertex]! < 0.05) return 0;
  if (isRiver(world, vertex)) return 1;
  return clamp(1 + world.coastDistance[vertex]! / 6, 0.15, 1);
};

const getGrassWeight = (world: WorldData, vertex: number) => {
  const offset = vertex * MATERIAL_COUNT;
  return (world.splat[offset + MATERIAL.grass]! + world.splat[offset + MATERIAL.lushGrass]!) / 255;
};

/** A rectangle of habitat blocks (inclusive). */
export interface BlockRange {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

const isBlockInRange = (range: BlockRange, blockX: number, blockZ: number) =>
  blockX >= range.minX && blockX <= range.maxX && blockZ >= range.minZ && blockZ <= range.maxZ;

/** Calls `visit` for every block of the range. */
export const forEachBlock = (
  field: Pick<HabitatField, "blocksX" | "blocksZ">,
  range: BlockRange,
  visit: (block: number, blockX: number, blockZ: number) => void
) => {
  for (let blockZ = range.minZ; blockZ <= range.maxZ; blockZ += 1) {
    for (let blockX = range.minX; blockX <= range.maxX; blockX += 1) {
      visit(blockZ * field.blocksX + blockX, blockX, blockZ);
    }
  }
};

/** Last vertex (or cell, `last`) of a block span: the last block also takes the far edge. */
const getSpanEnd = (maxBlock: number, blocks: number, last: number) =>
  maxBlock === blocks - 1 ? last : Math.min(last, (maxBlock + 1) * HABITAT_BLOCK - 1);

/** Calls `visit` for every vertex of the range's blocks (the last blocks take the far edge). */
export const forEachBlockVertex = (
  world: WorldData,
  field: Pick<HabitatField, "blocksX" | "blocksZ">,
  range: BlockRange,
  visit: (vertex: number, block: number) => void
) => {
  const stride = world.cellsX + 1;
  const lastZ = getSpanEnd(range.maxZ, field.blocksZ, world.cellsZ);
  const lastX = getSpanEnd(range.maxX, field.blocksX, world.cellsX);
  for (let vertexZ = range.minZ * HABITAT_BLOCK; vertexZ <= lastZ; vertexZ += 1) {
    const blockRow = Math.min(field.blocksZ - 1, Math.floor(vertexZ / HABITAT_BLOCK));
    for (let vertexX = range.minX * HABITAT_BLOCK; vertexX <= lastX; vertexX += 1) {
      const blockX = Math.min(field.blocksX - 1, Math.floor(vertexX / HABITAT_BLOCK));
      visit(vertexZ * stride + vertexX, blockRow * field.blocksX + blockX);
    }
  }
};

/** Averages the vertex channels (water, grass, surface) of the range's blocks. */
const addVertexChannels = (world: WorldData, field: HabitatField, range: BlockRange) => {
  const counts = new Float32Array(field.blocksX * field.blocksZ);
  forEachBlock(field, range, (block) => {
    field.water[block] = 0;
    field.grass[block] = 0;
    field.canopy[block] = 0;
  });
  forEachBlockVertex(world, field, range, (vertex, block) => {
    field.water[block]! += getWaterWeight(world, vertex);
    field.grass[block]! += getGrassWeight(world, vertex);
    field.canopy[block]! += getSurface(world, vertex);
    counts[block]! += 1;
  });
  forEachBlock(field, range, (block) => {
    const count = Math.max(1, counts[block]!);
    field.water[block]! /= count;
    field.grass[block]! /= count;
    field.canopy[block]! /= count;
  });
};

const addFogChannel = (world: WorldData, field: HabitatField, range: BlockRange) => {
  forEachBlock(field, range, (block) => (field.open[block] = 0));
  const lastZ = getSpanEnd(range.maxZ, field.blocksZ, world.cellsZ - 1);
  const lastX = getSpanEnd(range.maxX, field.blocksX, world.cellsX - 1);
  for (let cellZ = range.minZ * HABITAT_BLOCK; cellZ <= lastZ; cellZ += 1) {
    for (let cellX = range.minX * HABITAT_BLOCK; cellX <= lastX; cellX += 1) {
      if (displayFogAt(world, cellZ * world.cellsX + cellX) !== FOG.visible) continue;
      const block =
        Math.floor(cellZ / HABITAT_BLOCK) * field.blocksX + Math.floor(cellX / HABITAT_BLOCK);
      field.open[block]! += 1 / (HABITAT_BLOCK * HABITAT_BLOCK);
    }
  }
};

/** The local theme thins the birds (winter: fewer). */
const applyWildlifeFactor = (world: WorldData, field: HabitatField, range: BlockRange) => {
  const theme = createThemeSampler(world, world.themeWeights);
  forEachBlock(field, range, (block, blockX, blockZ) => {
    const centre = { x: (blockX + 0.5) * HABITAT_BLOCK, z: (blockZ + 0.5) * HABITAT_BLOCK };
    field.open[block]! *= theme.at(centre.x, centre.z).wildlife;
  });
};

/** Block of a prop, or -1 outside the range. */
const getPropBlock = (world: WorldData, field: HabitatField, range: BlockRange, index: number) => {
  const blockX = Math.min(field.blocksX - 1, Math.floor(world.props.x[index]! / HABITAT_BLOCK));
  const blockZ = Math.min(field.blocksZ - 1, Math.floor(world.props.z[index]! / HABITAT_BLOCK));
  return isBlockInRange(range, blockX, blockZ) ? blockZ * field.blocksX + blockX : -1;
};

/** Cover share and top of a prop: leafy trees and big bushes hide birds, palms do not. */
const getCover = (world: WorldData, index: number) => {
  const { props } = world;
  const type = props.types[index]!;
  const scale = props.scale[index]!;
  if (type === PROP.palmTree) return null;
  if (getTreeSpecies(type) !== undefined) {
    return { share: 1 / DENSE_FOREST_TREES, top: props.y[index]! + CANOPY_TOP * scale };
  }
  if (!COVER_BUSHES.has(type) || scale < COVER_BUSH.minScale) return null;
  return { share: 1 / COVER_BUSH.dense, top: props.y[index]! + COVER_BUSH.top * scale };
};

/** Leafy crowns and big bushes fill the cover channel (perches birds take off from). */
const addCover = (world: WorldData, field: HabitatField, range: BlockRange) => {
  forEachBlock(field, range, (block) => {
    field.cover[block] = 0;
    field.coverTop[block] = field.canopy[block]!;
  });
  for (let index = 0; index < world.props.count; index += 1) {
    const cover = getCover(world, index);
    if (!cover) continue;
    const block = getPropBlock(world, field, range, index);
    if (block < 0) continue;
    field.cover[block] = Math.min(1, field.cover[block]! + cover.share);
    field.coverTop[block] = Math.max(field.coverTop[block]!, cover.top);
  }
};

/** Trees raise the forest density and lift the canopy surface to their crown tops (unspread). */
const addTrees = (world: WorldData, field: HabitatField, range: BlockRange) => {
  const { props } = world;
  const tops = new Float32Array(field.forest.length);
  forEachBlock(field, range, (block) => (field.forest[block] = 0));
  for (let index = 0; index < props.count; index += 1) {
    if (getTreeSpecies(props.types[index]!) === undefined) continue;
    const block = getPropBlock(world, field, range, index);
    if (block < 0) continue;
    field.forest[block]! += 1 / DENSE_FOREST_TREES;
    tops[block] = Math.max(tops[block]!, props.y[index]! + CANOPY_TOP * props.scale[index]!);
  }
  forEachBlock(field, range, (block) => {
    const forest = Math.min(1, field.forest[block]!);
    field.forest[block] = forest;
    if (forest > 0) field.canopy[block] = Math.max(field.canopy[block]!, tops[block]!);
  });
};

/**
 * Each block of the range takes the highest canopy of its neighbours in `source` (the unspread
 * canopy): the bilinear sample never dips below a crown at a forest edge, so birds pass over
 * trees instead of through them.
 */
const spreadCanopy = (field: HabitatField, source: Float32Array, range: BlockRange) => {
  forEachBlock(field, range, (block, blockX, blockZ) => {
    let highest = -Infinity;
    for (let dz = -1; dz <= 1; dz += 1) {
      const z = Math.min(field.blocksZ - 1, Math.max(0, blockZ + dz));
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = Math.min(field.blocksX - 1, Math.max(0, blockX + dx));
        highest = Math.max(highest, source[z * field.blocksX + x]!);
      }
    }
    field.canopy[block] = highest;
  });
};

/** Every channel of the range's blocks from the world (the canopy left unspread). */
const fillBlocks = (world: WorldData, field: HabitatField, range: BlockRange) => {
  addVertexChannels(world, field, range);
  addFogChannel(world, field, range);
  applyWildlifeFactor(world, field, range);
  addCover(world, field, range);
  addTrees(world, field, range);
};

export const getAllBlocks = (field: Pick<HabitatField, "blocksX" | "blocksZ">): BlockRange => ({
  maxX: field.blocksX - 1,
  maxZ: field.blocksZ - 1,
  minX: 0,
  minZ: 0
});

/** The blocks of a cell region grown by `margin` blocks (clamped to the field). */
export const getRegionBlocks = (
  field: Pick<HabitatField, "blocksX" | "blocksZ">,
  region: CellRegion,
  margin: number
): BlockRange => ({
  maxX: Math.min(field.blocksX - 1, Math.floor(region.maxX / HABITAT_BLOCK) + margin),
  maxZ: Math.min(field.blocksZ - 1, Math.floor(region.maxZ / HABITAT_BLOCK) + margin),
  minX: Math.max(0, Math.floor(region.minX / HABITAT_BLOCK) - margin),
  minZ: Math.max(0, Math.floor(region.minZ / HABITAT_BLOCK) - margin)
});

/** Builds the bird habitat of a world once (a few milliseconds; scales with the island size). */
export const createHabitatField = (world: WorldData): HabitatField => {
  const blocksX = Math.ceil(world.cellsX / HABITAT_BLOCK);
  const blocksZ = Math.ceil(world.cellsZ / HABITAT_BLOCK);
  const field = {
    blocksX,
    blocksZ,
    ...createChannels(blocksX * blocksZ),
    surface: (x: number, z: number) =>
      sampleBilinear(world, world.heights, x, z) + sampleBilinear(world, world.waterDepth, x, z)
  };
  const all = getAllBlocks(field);
  fillBlocks(world, field, all);
  spreadCanopy(field, field.canopy.slice(), all);
  return field;
};

/**
 * Map editor: the blocks of the edited cells are measured again (ground, water, trees, cover),
 * exactly as a full build measures them; the spread canopy follows one block around them.
 */
export const refreshHabitatField = (world: WorldData, field: HabitatField, cells: CellRegion) => {
  if (isRegionEmpty(cells)) return;
  const spread = getRegionBlocks(field, cells, 1);
  const filled = getRegionBlocks(field, cells, 2);
  const spreadBefore = field.canopy.slice();
  fillBlocks(world, field, filled);
  spreadCanopy(field, field.canopy.slice(), spread);
  forEachBlock(field, filled, (block, blockX, blockZ) => {
    if (!isBlockInRange(spread, blockX, blockZ)) field.canopy[block] = spreadBefore[block]!;
  });
};

/** Bilinear sample of a habitat channel at world coordinates (block centres hold the values). */
export const sampleHabitat = (field: HabitatField, channel: Float32Array, x: number, z: number) => {
  const bx = clamp(x / HABITAT_BLOCK - 0.5, 0, field.blocksX - 1.001);
  const bz = clamp(z / HABITAT_BLOCK - 0.5, 0, field.blocksZ - 1.001);
  const x0 = Math.floor(bx);
  const z0 = Math.floor(bz);
  const fx = bx - x0;
  const fz = bz - z0;
  const row = z0 * field.blocksX + x0;
  const top = channel[row]! * (1 - fx) + channel[row + 1]! * fx;
  const bottom = channel[row + field.blocksX]! * (1 - fx) + channel[row + field.blocksX + 1]! * fx;
  return top * (1 - fz) + bottom * fz;
};

/** How much a species likes a spot (0 never .. about 1), hidden fog counts as nothing. */
export const scoreHabitat = (
  field: HabitatField,
  preference: HabitatPreference,
  x: number,
  z: number
) => {
  const insideX = x > 0 && x < field.blocksX * HABITAT_BLOCK;
  const insideZ = z > 0 && z < field.blocksZ * HABITAT_BLOCK;
  if (!insideX || !insideZ) return 0;
  const forest = sampleHabitat(field, field.forest, x, z);
  const grass = sampleHabitat(field, field.grass, x, z) * (1 - forest);
  const water = sampleHabitat(field, field.water, x, z);
  const open = sampleHabitat(field, field.open, x, z);
  const score = forest * preference.forest + grass * preference.grass + water * preference.water;
  return Math.min(1, score) * open;
};

/**
 * Perch height inside cover (a leafy crown or a big bush, never a palm), or null without cover:
 * the only perches a flock may take off from unseen (no birds rising from bare ground).
 */
export const getCoverPerchHeight = (
  field: HabitatField,
  species: BirdSpecies,
  x: number,
  z: number
) => {
  if (species.perches === "none") return null;
  if (sampleHabitat(field, field.cover, x, z) <= COVER_PERCH.least) return null;
  const top = sampleHabitat(field, field.coverTop, x, z);
  return Math.max(field.surface(x, z) + COVER_PERCH.lift, top - COVER_PERCH.depth);
};

/** Perch height a flock lands on: in cover, or on open grass (it is seen landing there). */
export const getPerchHeight = (field: HabitatField, species: BirdSpecies, x: number, z: number) => {
  if (species.perches === "none") return null;
  if (species.perches !== "ground") {
    const cover = getCoverPerchHeight(field, species, x, z);
    if (cover !== null) return cover;
  }
  if (species.perches === "canopy") return null;
  const forest = sampleHabitat(field, field.forest, x, z);
  const grass = sampleHabitat(field, field.grass, x, z);
  const water = sampleHabitat(field, field.water, x, z);
  const open = grass > 0.45 && water < 0.1 && forest < 0.2;
  return open ? field.surface(x, z) + 0.05 : null;
};
