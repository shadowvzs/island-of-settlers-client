import { sampleBilinear } from "../../shared/world/grid-geometry";
import type { Random } from "../../shared/world/rng";
import { BUILD, type WorldData } from "../../shared/world/world-data";
import type { Vec3 } from "../props/mesh-builder";
import type { RockContact } from "./rock-contact";
import {
  createUprightFrame,
  ROCK_ROLE,
  type RockInstance,
  scaleFrame,
  tiltFrame} from "./rock-instances";
import { ROCK_FAMILY, ROCK_VARIANTS } from "./rock-shapes";
import { isInWater, type RockTerrain } from "./rock-terrain";
import { claimForTile, createTileRandom, listRockTiles, type RockTile } from "./rock-tiles";

/** Pebble candidates per cell edge (one per contact sample). */
const STEPS_PER_CELL = 2;
/** Expected pebbles per candidate at full contact (fewer further out: contact squared). */
const DENSITY = 1.5;
/** Smallest contact that gets pebbles, and rockness above which the spot is rock already. */
const MIN_CONTACT = 0.2;
const MAX_ROCKNESS = 0.5;
/** Pebble size (world units): many small ones, few stones; bigger right at the rock. */
const SIZE: [number, number] = [0.07, 0.3];
const TRUNK_CLEARANCE = 0.55;
const FAMILIES = [ROCK_FAMILY.broken, ROCK_FAMILY.blocky, ROCK_FAMILY.weathered];

export interface PebbleOptions {
  seed: number;
  terrain: RockTerrain;
  tint: (x: number, z: number) => number;
  /** Tree trunks (x, y, z): pebbles keep clear of them. */
  trunks: Vec3[];
}

/** Trunks hashed by cell, so the clearance test only looks at the 3 x 3 cells around a spot. */
const createTrunkTest = (world: WorldData, trunks: Vec3[]) => {
  const cells = new Map<number, Vec3[]>();
  const key = (x: number, z: number) => Math.floor(z) * (world.cellsX + 2) + Math.floor(x);
  for (const trunk of trunks) {
    const list = cells.get(key(trunk[0], trunk[2])) ?? [];
    list.push(trunk);
    cells.set(key(trunk[0], trunk[2]), list);
  }
  return (x: number, z: number) => {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const near = cells.get(key(x + dx, z + dz)) ?? [];
        if (near.some(([tx, , tz]) => Math.hypot(tx - x, tz - z) < TRUNK_CLEARANCE)) return true;
      }
    }
    return false;
  };
};

/** Buildable land (house plots, settlement clearings) and water stay free of pebbles. */
const isKeptFree = (world: WorldData, x: number, z: number) => {
  if (sampleBilinear(world, world.waterDepth, x, z) > 0) return true;
  const cell = Math.floor(z) * world.cellsX + Math.floor(x);
  const build = world.buildClass[cell] ?? BUILD.none;
  return build >= BUILD.small && build <= BUILD.large;
};

/** A small stone lying in the soil: random yaw and tilt, flattened, partly sunk. */
export const createPebble = (
  position: [number, number],
  contact: number,
  random: Random,
  { terrain, tint }: PebbleOptions
): RockInstance => {
  const [x, z] = position;
  const yaw = random() * Math.PI * 2;
  const upright = createUprightFrame([Math.cos(yaw), 0, Math.sin(yaw)]);
  const frame = tiltFrame(upright, (random() - 0.5) * 0.5, (random() - 0.5) * 0.5);
  const size = (SIZE[0] + (SIZE[1] - SIZE[0]) * random() ** 2) * (0.6 + contact * 0.6);
  const dims: Vec3 = [
    size * (1 + random() * 0.5),
    size * (0.5 + random() * 0.3),
    size * (0.8 + random() * 0.4)
  ];
  const y = terrain.height(x, z) - dims[1] * (0.2 + random() * 0.25);
  return {
    axes: scaleFrame(frame, dims),
    centre: [x, y, z],
    exposure: 0,
    family: FAMILIES[Math.floor(random() * FAMILIES.length)]!,
    high: false,
    moss: 0.4 * terrain.moisture(x, z),
    role: ROCK_ROLE.pebble,
    slab: -1,
    tint: tint(x, z) + (random() - 0.5) * 0.6,
    variant: Math.floor(random() * ROCK_VARIANTS)
  };
};

/** Where pebbles may lie: in the contact band, not inside rock, clear of trunks and water. */
type PebbleSpotTest = (x: number, z: number) => boolean;

/** The pebbles of one tile's contact samples (its own random stream). */
const placeTilePebbles = (
  contact: RockContact,
  options: PebbleOptions,
  isFree: PebbleSpotTest,
  tile: RockTile
) => {
  const random = createTileRandom(options.seed, "contact-pebbles", tile);
  const pebbles: RockInstance[] = [];
  const step = 1 / STEPS_PER_CELL;
  for (let row = tile.minZ * STEPS_PER_CELL; row < tile.maxZ * STEPS_PER_CELL; row += 1) {
    for (
      let column = tile.minX * STEPS_PER_CELL;
      column < tile.maxX * STEPS_PER_CELL;
      column += 1
    ) {
      const strength = contact.contact((column + 0.5) * step, (row + 0.5) * step);
      if (strength < MIN_CONTACT) continue;
      const count = Math.floor(strength * strength * DENSITY + random());
      for (let index = 0; index < count; index += 1) {
        const x = (column + random()) * step;
        const z = (row + random()) * step;
        if (!isFree(x, z)) continue;
        pebbles.push(createPebble([x, z], contact.contact(x, z), random, options));
      }
    }
  }
  return claimForTile(pebbles, tile);
};

/**
 * Pebbles and small stones in the band where rock meets the ground: dense right at the rock,
 * thinning outward, clear of trunks, water and building land. Render only (no colliders).
 * Placed per tile of the terrain's area (see rock-tiles.ts).
 */
export const placeContactPebbles = (
  world: WorldData,
  contact: RockContact,
  options: PebbleOptions
): RockInstance[] => {
  const isNearTrunk = createTrunkTest(world, options.trunks);
  const isFree: PebbleSpotTest = (x, z) =>
    contact.rockness(x, z) <= MAX_ROCKNESS &&
    !isKeptFree(world, x, z) &&
    !isNearTrunk(x, z) &&
    !isInWater(options.terrain, x, z);
  return listRockTiles(options.terrain).flatMap((tile) =>
    placeTilePebbles(contact, options, isFree, tile)
  );
};
