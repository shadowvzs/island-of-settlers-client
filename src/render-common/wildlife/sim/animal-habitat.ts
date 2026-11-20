import {
  type CellRegion,
  expandRegion,
  forEachRegionCell,
  getCellCount,
  isRegionEmpty} from "../../../shared/world/grid-geometry";
import { smoothstep } from "../../../shared/world/noise";
import { MATERIAL, MATERIAL_COUNT, PROP, type WorldData } from "../../../shared/world/world-data";
import { getTreeSpecies } from "../../props/island-trees";
import type { NavWorld } from "../nav/nav-query";
import { NAV_RES } from "../nav/nav-terrain";
import { SPECIES, SPECIES_COUNT } from "../wildlife-species";

const SHRUBS = new Set<number>([
  PROP.bush,
  PROP.berryBush,
  PROP.fieldShrub,
  PROP.riverShrub,
  PROP.willowShrub,
  PROP.broadleafShrub
]);
const TREE_BLUR = 2;
/** Crowns over a cell: trees in the cell and its direct neighbours. */
const CANOPY_BLUR = 1;

/**
 * Under closed canopy an animal is hidden from the elevated camera: the habitat favours the
 * open sky at the forest edge and in clearings (the forest is still home and shelter).
 */
const getOpenSky = (canopy: number) => 1 - 0.75 * smoothstep(0.15, 0.55, canopy);
const SHRUB_BLUR = 1;

/** Per species habitat weight per world cell (0 unsuitable .. 1 best), built once. */
export interface HabitatField {
  cellsX: number;
  cellsZ: number;
  /** Highest raw weight per species of the first build (the weights are scaled by it). */
  peaks: number[];
  weights: Float32Array[];
}

const countPerCell = (world: WorldData, keep: (type: number) => boolean) => {
  const counts = new Float32Array(getCellCount(world));
  const { props } = world;
  for (let index = 0; index < props.count; index += 1) {
    if (!keep(props.types[index]!)) continue;
    const cell = Math.floor(props.z[index]!) * world.cellsX + Math.floor(props.x[index]!);
    counts[cell]! += 1;
  }
  return counts;
};

/** Mean over a (2 radius + 1) square window of a cell: density per cell. */
const blurCell = (
  values: Float32Array,
  cellsX: number,
  cellsZ: number,
  radius: number,
  cell: number
) => {
  const column = cell % cellsX;
  const row = Math.floor(cell / cellsX);
  let sum = 0;
  let count = 0;
  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = column + dx;
      const z = row + dz;
      if (x < 0 || z < 0 || x >= cellsX || z >= cellsZ) continue;
      sum += values[z * cellsX + x]!;
      count += 1;
    }
  }
  return sum / count;
};

/** Rises from `low` to 1 at `peak`, falls back to 0 at `high`. */
const bump = (value: number, low: number, peak: number, high: number) =>
  value < peak ? smoothstep(low, peak, value) : smoothstep(high, peak, value);

/**
 * Share of the cell's nav cells open for the species' standing room: forest cores too tight
 * for a body (elk between oaks with low limbs) score nothing, so it keeps to edges and clearings.
 */
const getWalkShare = (nav: NavWorld, species: number, column: number, row: number) => {
  const { open } = nav.species[species]!;
  const { width } = nav.terrain;
  let walkable = 0;
  for (let dz = 0; dz < NAV_RES; dz += 1) {
    for (let dx = 0; dx < NAV_RES; dx += 1) {
      walkable += open[(row * NAV_RES + dz) * width + column * NAV_RES + dx]!;
    }
  }
  return walkable / (NAV_RES * NAV_RES);
};

interface CellInputs {
  grass: number;
  shrubs: number;
  trees: number;
}

/**
 * Rabbits: meadow edges, grassland and bushes; deer: forest edges, clearings and sparse
 * woodland; elk: open grass to forest transitions, away from dense obstacle clusters.
 */
const SCORES: ((cell: CellInputs) => number)[] = [];
SCORES[SPECIES.rabbit] = ({ grass, shrubs, trees }) =>
  grass *
  (0.3 + bump(trees, 0.02, 0.18, 0.5) + Math.min(1, shrubs * 1.5)) *
  (1 - smoothstep(0.45, 0.7, trees));
SCORES[SPECIES.deer] = ({ grass, trees }) =>
  (0.25 * grass + 1.2 * bump(trees, 0.06, 0.28, 0.6)) * (1 - smoothstep(0.55, 0.8, trees));
SCORES[SPECIES.elk] = ({ grass, shrubs, trees }) =>
  grass *
  (0.35 + bump(trees, 0.02, 0.15, 0.35)) *
  (1 - smoothstep(0.3, 0.55, trees)) *
  (1 - Math.min(1, shrubs * 1.2));

/** Tree, crown and shrub counts per cell (the blurred inputs of every cell's score). */
const countInputs = (world: WorldData) => ({
  shrubs: countPerCell(world, (type) => SHRUBS.has(type)),
  trees: countPerCell(world, (type) => getTreeSpecies(type) !== undefined)
});

type InputCounts = ReturnType<typeof countInputs>;

/** Raw (unnormalised) weights of every species in the region's cells. */
const scoreRegion = (
  world: WorldData,
  nav: NavWorld,
  weights: Float32Array[],
  region: CellRegion
) => {
  const { cellsX, cellsZ } = world;
  const counts: InputCounts = countInputs(world);
  forEachRegionCell(world, region, (cell, column, row) => {
    const vertex = (row * (cellsX + 1) + column) * MATERIAL_COUNT;
    const grass =
      (world.splat[vertex + MATERIAL.grass]! + world.splat[vertex + MATERIAL.lushGrass]!) / 255;
    const inputs = {
      grass: Math.min(1, grass),
      shrubs: blurCell(counts.shrubs, cellsX, cellsZ, SHRUB_BLUR, cell),
      trees: blurCell(counts.trees, cellsX, cellsZ, TREE_BLUR, cell)
    };
    const openSky = getOpenSky(blurCell(counts.trees, cellsX, cellsZ, CANOPY_BLUR, cell));
    for (let species = 0; species < SPECIES_COUNT; species += 1) {
      const walk = getWalkShare(nav, species, column, row);
      weights[species]![cell] = walk * SCORES[species]!(inputs) * openSky;
    }
  });
};

const getPeak = (values: Float32Array) =>
  values.reduce((best, value) => Math.max(best, value), 0.0001);

export const createHabitatField = (world: WorldData, nav: NavWorld): HabitatField => {
  const { cellsX, cellsZ } = world;
  const weights = Array.from({ length: SPECIES_COUNT }, () => new Float32Array(cellsX * cellsZ));
  scoreRegion(world, nav, weights, { maxX: cellsX - 1, maxZ: cellsZ - 1, minX: 0, minZ: 0 });
  const peaks = weights.map(getPeak);
  weights.forEach((values, species) => {
    for (let cell = 0; cell < values.length; cell += 1) values[cell]! /= peaks[species]!;
  });
  return { cellsX, cellsZ, peaks, weights };
};

/** Cells around an edit whose habitat can change (tree blur, nav colliders of the rock chunks). */
export const REFRESH_REACH = TREE_BLUR + 2;

/**
 * Map editor: the edited cells' habitat with the new navigation (call after `setNav`), scaled by
 * the island's peaks of the first build (the rest of the island keeps its weights).
 */
export const refreshHabitatField = (
  world: WorldData,
  nav: NavWorld,
  field: HabitatField,
  cells: CellRegion
) => {
  if (isRegionEmpty(cells)) return;
  const region = expandRegion(world, cells, REFRESH_REACH);
  scoreRegion(world, nav, field.weights, region);
  field.weights.forEach((values, species) => {
    forEachRegionCell(world, region, (cell) => {
      values[cell] = Math.min(1, values[cell]! / field.peaks[species]!);
    });
  });
};

export const sampleHabitat = (field: HabitatField, species: number, x: number, z: number) => {
  const column = Math.floor(x);
  const row = Math.floor(z);
  if (column < 0 || row < 0 || column >= field.cellsX || row >= field.cellsZ) return 0;
  return field.weights[species]![row * field.cellsX + column]!;
};
