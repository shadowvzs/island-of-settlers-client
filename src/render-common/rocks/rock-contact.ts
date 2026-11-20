import { type GridSize,sampleBilinear } from "../../shared/world/grid-geometry";
import {
  type BufferSoil,
  GREEN_GROUNDS,
  shiftGreenToBuffer} from "../../shared/world/ground-buffer";
import { createFbm, smoothstep } from "../../shared/world/noise";
import { deriveSeed } from "../../shared/world/rng";
import { MATERIAL, MATERIAL_COUNT, type WorldData } from "../../shared/world/world-data";
import { createClearFog, getIslandRocks } from "./island-rock-instances";
import type { RockInstance } from "./rock-instances";
import { getRenderedSkinWeight } from "./rock-skin";
import { createWorldRockTerrain, isInRockArea, type RockTerrain } from "./rock-terrain";

/** Contact samples per cell (the render mesh vertex spacing). */
const CONTACT_RESOLUTION = 2;
/** Width (cells) of the contact band (pebble core, soil rim), jittered by noise between these. */
const BAND_WIDTH: [number, number] = [0.8, 1.4];
/** Smallest footprint radius (cells): small rubble still reaches the half cell contact samples. */
const MIN_FOOTPRINT = 0.6;
/** Rockness above which a sample counts as inside the rock (its band is spread by neighbours). */
const INSIDE_ROCK = 0.95;
/** Contact ranges of the band's pebble core and of its soil rim (the ground chain). */
const GRAVEL_CONTACT: [number, number] = [0.55, 0.85];
const SOIL_CONTACT: [number, number] = [0.02, 0.22];
/** Mine gravel share of a vertex over which the band is mine gravel itself (mountain apron). */
const MINE_BAND: [number, number] = [0.2, 0.45];

/**
 * Where rock meets the ground, renderer independent: rockness (rock ground, mountain skin, rock
 * footprints) and a pebble band around it (1 at the rock's edge, 0 outside the band).
 */
export interface RockContact {
  contact: (x: number, z: number) => number;
  mountain: (x: number, z: number) => number;
  rockness: (x: number, z: number) => number;
}

const getRockGround = (world: WorldData) =>
  Float32Array.from(
    { length: world.splat.length / MATERIAL_COUNT },
    (_, vertex) => world.splat[vertex * MATERIAL_COUNT + MATERIAL.rock]! / 255
  );

/** Rock ground and the visible mountain skin per contact sample. */
const markRockSurfaces = (world: WorldData, terrain: RockTerrain, grid: GridSize) => {
  const rockGround = getRockGround(world);
  const rockness = new Float32Array((grid.cellsX + 1) * (grid.cellsZ + 1));
  rockness.forEach((_, index) => {
    const x = (index % (grid.cellsX + 1)) / CONTACT_RESOLUTION;
    const z = Math.floor(index / (grid.cellsX + 1)) / CONTACT_RESOLUTION;
    if (!isInRockArea(terrain, x, z)) return;
    const ground = smoothstep(0.35, 0.7, sampleBilinear(world, rockGround, x, z));
    const hasSkin = terrain.mountain(x, z) > 0;
    const skin = hasSkin ? smoothstep(0.2, 0.45, getRenderedSkinWeight(terrain, x, z)) : 0;
    rockness[index] = Math.max(ground, skin);
  });
  return rockness;
};

/** Rock footprints (slabs, lips, rubble standing on the ground) into the rockness. */
const markRockFootprints = (grid: GridSize, rockness: Float32Array, rocks: RockInstance[]) => {
  for (const { axes, centre } of rocks) {
    const extent = Math.max(Math.hypot(axes[0][0], axes[0][2]), Math.hypot(axes[2][0], axes[2][2]));
    const radius = Math.max(MIN_FOOTPRINT, 0.42 * extent);
    const reach = Math.ceil(radius * CONTACT_RESOLUTION);
    const column = Math.round(centre[0] * CONTACT_RESOLUTION);
    const row = Math.round(centre[2] * CONTACT_RESOLUTION);
    for (let z = Math.max(0, row - reach); z <= Math.min(grid.cellsZ, row + reach); z += 1) {
      for (
        let x = Math.max(0, column - reach);
        x <= Math.min(grid.cellsX, column + reach);
        x += 1
      ) {
        const distance = Math.hypot(
          x / CONTACT_RESOLUTION - centre[0],
          z / CONTACT_RESOLUTION - centre[2]
        );
        const index = z * (grid.cellsX + 1) + x;
        rockness[index] = Math.max(rockness[index]!, smoothstep(radius, radius * 0.6, distance));
      }
    }
  }
};

const isInsideRock = (grid: GridSize, rockness: Float32Array, x: number, z: number) => {
  const stride = grid.cellsX + 1;
  const at = (dx: number, dz: number) =>
    rockness[
      Math.min(grid.cellsZ, Math.max(0, z + dz)) * stride +
        Math.min(grid.cellsX, Math.max(0, x + dx))
    ]!;
  return [at(1, 0), at(-1, 0), at(0, 1), at(0, -1)].every((value) => value >= INSIDE_ROCK);
};

/** The band: every rock sample spreads a linear falloff over its noise-jittered band width. */
const spreadContact = (grid: GridSize, rockness: Float32Array, seed: number) => {
  const widthNoise = createFbm(deriveSeed(seed, "rock-contact"), { octaves: 2 });
  const contact = Float32Array.from(rockness);
  const stride = grid.cellsX + 1;
  rockness.forEach((value, index) => {
    const column = index % stride;
    const row = Math.floor(index / stride);
    if (value < 0.05 || isInsideRock(grid, rockness, column, row)) return;
    const jitter = smoothstep(-0.5, 0.5, widthNoise(column * 0.15, row * 0.15));
    const width = BAND_WIDTH[0] + (BAND_WIDTH[1] - BAND_WIDTH[0]) * jitter;
    const reach = Math.ceil(width * CONTACT_RESOLUTION);
    for (let z = Math.max(0, row - reach); z <= Math.min(grid.cellsZ, row + reach); z += 1) {
      for (
        let x = Math.max(0, column - reach);
        x <= Math.min(grid.cellsX, column + reach);
        x += 1
      ) {
        const distance = Math.hypot(x - column, z - row) / CONTACT_RESOLUTION;
        const strength = value * (1 - distance / width);
        if (strength > contact[z * stride + x]!) contact[z * stride + x] = strength;
      }
    }
  });
  return contact;
};

const createRockContact = (
  world: WorldData,
  area?: (x: number, z: number) => boolean
): RockContact => {
  const terrain = { ...createWorldRockTerrain(world, createClearFog(world)), area };
  const grid: GridSize = {
    cellsX: world.cellsX * CONTACT_RESOLUTION,
    cellsZ: world.cellsZ * CONTACT_RESOLUTION
  };
  const rockness = markRockSurfaces(world, terrain, grid);
  markRockFootprints(grid, rockness, getIslandRocks(world, terrain));
  const contact = spreadContact(grid, rockness, world.seed);
  const sample = (values: Float32Array) => (x: number, z: number) =>
    sampleBilinear(grid, values, x * CONTACT_RESOLUTION, z * CONTACT_RESOLUTION);
  return {
    contact: sample(contact),
    mountain: (x, z) => terrain.height(x, z) < 6.8 && sampleBilinear(world, world.waterDepth, x, z) <= 0
      ? smoothstep(0.02, 0.15, terrain.mountain(x, z)) : 0,
    rockness: sample(rockness)
  };
};

const contacts = new WeakMap<WorldData, RockContact>();

/** The rocks or heights changed (map editor terrain edits): the contact is built again. */
export const forgetRockContact = (world: WorldData) => {
  contacts.delete(world);
};

/**
 * The rock contact of an area only (map editor rebuilds of an edited area, the area includes a
 * margin for the band): the rest of the island has none, so it is not measured.
 */
export const useAreaRockContact = (world: WorldData, area: (x: number, z: number) => boolean) => {
  contacts.set(world, createRockContact(world, area));
};

/** The island's rock contact (built once per world, shared by ground, cover and pebbles). */
export const getRockContact = (world: WorldData) => {
  const known = contacts.get(world);
  if (known) return known;
  const contact = createRockContact(world);
  contacts.set(world, contact);
  return contact;
};

/** Share of the weights that is mine gravel. */
const getMineShare = (weights: Float32Array) => {
  let total = 0;
  for (const weight of weights) total += weight;
  return total > 0 ? weights[MATERIAL.mine]! / total : 0;
};

/**
 * Feathers the ground chain onto render splat weights (one value per material) around rock the
 * generation splat does not know (mountain skin, rock slabs): green ground turns into pebbles in
 * the band's core and into the theme's soil at its rim, so pebbles never touch grass. On a
 * mountain's apron the band is the mine gravel itself (rock -> mine gravel, no soil between).
 */
const MINE_BUFFER_GROUNDS = [...GREEN_GROUNDS, MATERIAL.dirt, MATERIAL.sand, MATERIAL.gravel];

export const shiftToRockBuffer = (
  weights: Float32Array,
  contact: number,
  soil: BufferSoil,
  mountain = 0
) => {
  const band = smoothstep(...SOIL_CONTACT, contact);
  const mine = Math.max(mountain, smoothstep(...MINE_BAND, getMineShare(weights)));
  const share = mine * smoothstep(0.12, 0.55, contact);
  // The old green-only shift left pre-existing brown dirt untouched at actual rock feet.
  // Shift every dry soil here; snow and rock keep their original shares.
  let moved = 0;
  for (const material of MINE_BUFFER_GROUNDS) {
    moved += weights[material]! * share;
    weights[material] = weights[material]! * (1 - share);
  }
  weights[MATERIAL.mine] = weights[MATERIAL.mine]! + moved;
  shiftGreenToBuffer(weights, smoothstep(...GRAVEL_CONTACT, contact), band, soil);
};
