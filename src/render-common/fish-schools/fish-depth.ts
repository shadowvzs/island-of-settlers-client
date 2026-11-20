import type { Random } from "../../shared/world/rng";
import type { FishPool } from "./fish-school-pool";
import { FISH_SPECIES } from "./fish-species";
import type { FishWater } from "./fish-water";

/**
 * How deep the fish swim, as a share of the water column (0 the surface .. 1 the seabed): the
 * school's slow drift up and down over tens of seconds (two incommensurate sines, phase per home:
 * deterministic), each fish's own layer within the school, and now and then a short dart up or
 * down. The result is always clamped clear of the surface and the local seabed.
 */
const DRIFT_MIDDLE = 0.45;
const DRIFT_REACH = 0.3;
const DRIFT_PERIODS: readonly [number, number] = [41, 23];
/** Each fish's own layer: an offset within +-LAYER_REACH of the school's share. */
export const LAYER_REACH = 0.12;
const DART_SECONDS = 1.6;
const DART_REACH = 0.22;
const DART_INTERVAL: readonly [number, number] = [6, 22];
const SHARE_LIMITS: readonly [number, number] = [0.06, 0.94];
/** Fish keep this far below the surface and above the bed (world units). */
const SURFACE_CLEARANCE = 0.12;
const BED_CLEARANCE = 0.06;
const TWO_PI = Math.PI * 2;
/** Body and fin reach above and below the spine (world units), with room for the larger iso draw. */
const FISH_EXTENTS = FISH_SPECIES.map((species) => species.length * Math.max(...species.body) * 1.6);

/** A home's drift phase (radians) from its position: the same for every visit. */
export const getDriftPhase = (x: number, z: number) => {
  const hash = Math.sin(x * 12.9898 + z * 78.233) * 43_758.545;
  return (hash - Math.floor(hash)) * TWO_PI;
};

/** The school's depth share at `time` (seconds). */
export const getSchoolDepthShare = (phase: number, time: number) =>
  DRIFT_MIDDLE + DRIFT_REACH * (0.62 * Math.sin((time / DRIFT_PERIODS[0]) * TWO_PI + phase)
    + 0.38 * Math.sin((time / DRIFT_PERIODS[1]) * TWO_PI + phase * 1.7));

/** A fish's first dart comes after a random share of the interval. */
export const resetDart = (fish: FishPool, index: number, random: Random) => {
  fish.dartAge[index] = -1;
  fish.dartClock[index] = DART_INTERVAL[0] + random() * (DART_INTERVAL[1] - DART_INTERVAL[0]);
};

/** Counts down to the next dart, runs a dart (a smooth up or down and back) and schedules the next. */
export const updateDart = (fish: FishPool, index: number, random: Random, dt: number) => {
  if (fish.dartAge[index]! >= 0) {
    fish.dartAge[index] = fish.dartAge[index]! + dt;
    if (fish.dartAge[index]! >= DART_SECONDS) resetDart(fish, index, random);
    return;
  }
  fish.dartClock[index] = fish.dartClock[index]! - dt;
  if (fish.dartClock[index]! > 0) return;
  fish.dartAge[index] = 0;
  fish.dartAmount[index] = (random() < 0.5 ? -1 : 1) * DART_REACH * (0.6 + random() * 0.4);
};

const getDartShare = (fish: FishPool, index: number) => {
  const age = fish.dartAge[index]!;
  return age < 0 ? 0 : fish.dartAmount[index]! * Math.sin((Math.PI * age) / DART_SECONDS);
};

/**
 * A spine height clamped so the body (its extent above and below the spine) stays clear of the
 * surface and the bed; the middle of the column where the water is too shallow for that.
 */
export const clampSwimHeight = (y: number, surface: number, ground: number, extent: number) => {
  const top = surface - SURFACE_CLEARANCE - extent;
  const bottom = ground + BED_CLEARANCE + extent;
  if (bottom > top) return (surface + ground) / 2;
  return Math.min(top, Math.max(bottom, y));
};

export const getFishExtent = (fish: FishPool, index: number) => FISH_EXTENTS[fish.species[index]!]!;

/** The height a fish aims for: school drift, its own layer and its dart, within the column. */
export const getSwimHeight = (water: FishWater, fish: FishPool, index: number, schoolShare: number) => {
  const x = fish.x[index]!, z = fish.z[index]!;
  const surface = water.surface(x, z);
  const ground = water.ground(x, z);
  const share = Math.min(SHARE_LIMITS[1], Math.max(SHARE_LIMITS[0],
    schoolShare + fish.depthShare[index]! + getDartShare(fish, index)));
  return clampSwimHeight(surface - (surface - ground) * share, surface, ground, getFishExtent(fish, index));
};
