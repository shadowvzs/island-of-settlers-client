import { type CellRegion,expandRegion, isRegionEmpty } from "../../../shared/world/grid-geometry";
import { createMountainField, refreshMountainField } from "../../../shared/world/rock-cover";
import type { WorldData } from "../../../shared/world/world-data";
import { createClearFog, getIslandRocks } from "../../rocks/island-rock-instances";
import { getRenderedSkinWeight } from "../../rocks/rock-skin";
import { createWorldRockTerrain, type RockTerrain } from "../../rocks/rock-terrain";
import {
  ALL_SPECIES_MASK,
  type ColliderSet,
  createColliderSet,
  isCircleBlocked} from "../../wildlife/nav/nav-colliders";
import { createRockColliders } from "../../wildlife/nav/world-colliders";

/** Skin samples per cell: the skin mesh's own vertex grid (its weight changes within a cell). */
const COVER_RESOLUTION = 4;
/**
 * From this rendered weight the mountain skin stands above the ground (below it the fringe sinks
 * into the ground); a little under the seam, so a hoof never sinks into the skin.
 */
const SKIN_ABOVE_GROUND = 0.15;
/** Skin weights are kept as bytes; this one marks a sample not measured yet. */
const UNMEASURED = 255;
const WEIGHT_STEPS = 254;
/** A body's room around a placed rock's footprint (world units). */
const ROCK_ROOM = 0.25;

interface RockCoverState {
  columns: number;
  /** The rock terrain's mountain mass (refreshed in place after map edits). */
  mountain: Float32Array;
  /** The placed rocks' footprints (their collider circles). */
  rocks: ColliderSet;
  rows: number;
  /** Rendered skin weight per sample (0 .. WEIGHT_STEPS), UNMEASURED until first asked for. */
  skin: Uint8Array;
  terrain: RockTerrain;
}

/** The placed rocks (slabs, lips, rubble, outcrops, foot boulders) by their collider circles. */
const createRockFootprints = (world: WorldData, terrain: RockTerrain) =>
  createColliderSet(
    world.cellsX,
    world.cellsZ,
    getIslandRocks(world, terrain).flatMap(createRockColliders)
  );

const createRockCoverState = (world: WorldData): RockCoverState => {
  const mountain = createMountainField(world, world.heights);
  const terrain = createWorldRockTerrain(world, createClearFog(world), mountain);
  const columns = world.cellsX * COVER_RESOLUTION + 1;
  const rows = world.cellsZ * COVER_RESOLUTION + 1;
  return {
    columns,
    mountain,
    rocks: createRockFootprints(world, terrain),
    rows,
    skin: new Uint8Array(columns * rows).fill(UNMEASURED),
    terrain
  };
};

/** The rendered skin weight of a sample, measured once when first asked for. */
const readSkin = (cover: RockCoverState, column: number, row: number) => {
  const index = row * cover.columns + column;
  if (cover.skin[index] === UNMEASURED) {
    const x = column / COVER_RESOLUTION;
    const z = row / COVER_RESOLUTION;
    const { terrain } = cover;
    const weight = terrain.mountain(x, z) > 0 ? getRenderedSkinWeight(terrain, x, z) : 0;
    cover.skin[index] = Math.round(weight * WEIGHT_STEPS);
  }
  return cover.skin[index]! / WEIGHT_STEPS;
};

/** The skin weight between the four samples around a point. */
const sampleSkin = (cover: RockCoverState, x: number, z: number) => {
  const gridX = Math.min(cover.columns - 1.001, Math.max(0, x * COVER_RESOLUTION));
  const gridZ = Math.min(cover.rows - 1.001, Math.max(0, z * COVER_RESOLUTION));
  const column = Math.floor(gridX);
  const row = Math.floor(gridZ);
  const fx = gridX - column;
  const fz = gridZ - row;
  const top = readSkin(cover, column, row) * (1 - fx) + readSkin(cover, column + 1, row) * fx;
  const bottom =
    readSkin(cover, column, row + 1) * (1 - fx) + readSkin(cover, column + 1, row + 1) * fx;
  return top * (1 - fz) + bottom * fz;
};

/** Cells around an edit whose skin samples are measured again (the skin reads its slopes). */
const SKIN_REACH = 4;

/** Forgets the skin samples of the cells (measured again when next asked for). */
const forgetSkin = (cover: RockCoverState, world: WorldData, cells: CellRegion) => {
  const region = expandRegion(world, cells, SKIN_REACH);
  const lastRow = (region.maxZ + 1) * COVER_RESOLUTION;
  const lastColumn = (region.maxX + 1) * COVER_RESOLUTION;
  for (let row = region.minZ * COVER_RESOLUTION; row <= lastRow; row += 1) {
    const start = row * cover.columns;
    cover.skin.fill(UNMEASURED, start + region.minX * COVER_RESOLUTION, start + lastColumn + 1);
  }
};

/**
 * Whether rendered rock covers the ground at a point: the sculpted mountain skin standing above
 * the ground heights, or a placed rock's footprint. The renderer draws this rock data, so a
 * critter standing there would be inside the rock. Built on the first question;
 * the skin is then measured once per sample as it is asked for (most of the island never is).
 * `refresh` follows a map edit (after its rocks were placed): the mountain mass of the edited
 * cells is measured again, the rock footprints taken again, the skin samples around the cells
 * forgotten.
 */
export const createRockCover = (world: WorldData) => {
  let cover: RockCoverState | null = null;
  const isUnderRock = (x: number, z: number) => {
    cover ??= createRockCoverState(world);
    if (isCircleBlocked(cover.rocks, ALL_SPECIES_MASK, x, z, ROCK_ROOM)) return true;
    return sampleSkin(cover, x, z) >= SKIN_ABOVE_GROUND;
  };
  const refresh = (cells: CellRegion) => {
    if (!cover || isRegionEmpty(cells)) return;
    refreshMountainField(world, world.heights, cover.mountain, cells);
    cover.rocks = createRockFootprints(world, cover.terrain);
    forgetSkin(cover, world, cells);
  };
  return { isUnderRock, refresh };
};
