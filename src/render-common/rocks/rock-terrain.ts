import { sampleBilinear, sampleSmooth } from "../../shared/world/grid-geometry";
import { createMountainField } from "../../shared/world/rock-cover";
import { BLOCKING, BUILD, type Waterfall, type WorldData } from "../../shared/world/world-data";
import { normalize, type Vec3 } from "../props/mesh-builder";

/**
 * What rock placement needs to know about the ground. The island and the lab-cliff test terrain provide
 * one, so the same generator sculpts cliffs on either.
 */
export interface RockTerrain {
  cellsX: number;
  cellsZ: number;
  /** 0 dry .. 1 wet (moss on shelves and in crevices). */
  moisture: (x: number, z: number) => number;
  /** Surface height (the rendered, smoothed surface). */
  height: (x: number, z: number) => number;
  /**
   * 0..1 how mountainous the place is (mountain rock archetype, rock tint, skin coverage). Taken
   * from the mountain mass around the point, so a face keeps it down to its foot.
   */
  mountain: (x: number, z: number) => number;
  /** Distance (cells) to the nearest river bed: no stones in channels and plunge pools. */
  river?: (x: number, z: number) => number;
  /** 0 dry .. 1 wet rock (spray around falls, splash in gorges): darker, glossier, mossy. */
  wetness?: (x: number, z: number) => number;
  /** Waterfalls (stones keep out of their plunge pools). */
  waterfalls?: Waterfall[];
  /** Whether the spot is building land (house plots, settlement clearings): no boulders. */
  isBlockedCliff?: (x: number, z: number) => boolean;
  isBuildLand?: (x: number, z: number) => boolean;
  /** Fog of war visibility 0..1. */
  visibility: (x: number, z: number) => number;
  /** Only place rocks here (map editor rebuilds of an edited area); everywhere when unset. */
  area?: (x: number, z: number) => boolean;
}

/** The point lies in the terrain's placement area (always without an area). */
export const isInRockArea = (terrain: RockTerrain, x: number, z: number) =>
  terrain.area?.(x, z) ?? true;

const STEP = 0.25;

/** Wet rock 0..1 at a point (0 where the terrain has no water data, like the lab-cliff test terrain). */
export const getWetness = (terrain: RockTerrain, x: number, z: number) =>
  terrain.wetness?.(x, z) ?? 0;

/** Stones keep this far (cells) from a river bed. */
const RIVER_CLEARANCE = 1;

/**
 * Whether a stone of `radius` at (x, z) would stand in water: inside a river channel or a
 * plunge pool (the world's river contract; terrains without water data never are).
 */
export const isInWater = (terrain: RockTerrain, x: number, z: number, radius = 0) => {
  if ((terrain.river?.(x, z) ?? Infinity) < RIVER_CLEARANCE + radius * 0.5) return true;
  return (terrain.waterfalls ?? []).some(
    (fall) => Math.hypot(x - fall.poolX, z - fall.poolZ) < fall.poolRadius + radius * 0.5
  );
};

/** Gradient of the surface by central differences (rise per cell along x and z). */
export const getGradient = (terrain: RockTerrain, x: number, z: number): [number, number] => [
  (terrain.height(x + STEP, z) - terrain.height(x - STEP, z)) / (STEP * 2),
  (terrain.height(x, z + STEP) - terrain.height(x, z - STEP)) / (STEP * 2)
];

export const getSurfaceNormal = (terrain: RockTerrain, x: number, z: number): Vec3 => {
  const [gx, gz] = getGradient(terrain, x, z);
  return normalize([-gx, 1, -gz]);
};

/**
 * The island as rock terrain; mountain from the mountain mass (built here unless given: a kept
 * field the caller refreshes after map edits), fog from the vertex fog.
 */
export const createWorldRockTerrain = (
  world: WorldData,
  vertexFog: Float32Array,
  mountain = createMountainField(world, world.heights)
): RockTerrain => {
  return {
    cellsX: world.cellsX,
    cellsZ: world.cellsZ,
    height: (x, z) => sampleSmooth(world, world.heights, x, z),
    moisture: (x, z) => sampleBilinear(world, world.moisture, x, z) / 255,
    mountain: (x, z) => sampleBilinear(world, mountain, x, z),
    river: (x, z) => sampleBilinear(world, world.riverDistance, x, z),
    visibility: (x, z) => sampleBilinear(world, vertexFog, x, z),
    isBuildLand: (x, z) => {
      const build = world.buildClass[Math.floor(z) * world.cellsX + Math.floor(x)] ?? BUILD.none;
      return build >= BUILD.small && build <= BUILD.large;
    },
    isBlockedCliff: (x, z) => world.blocking[Math.floor(z) * world.cellsX + Math.floor(x)] === BLOCKING.cliff,
    waterfalls: world.waterfalls,
    wetness: (x, z) => sampleBilinear(world, world.wetRock, x, z) / 255
  };
};
