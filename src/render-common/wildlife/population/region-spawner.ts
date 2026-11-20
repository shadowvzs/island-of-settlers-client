import { DMath } from "../../../shared/math/deterministic-math";
import { smoothstep } from "../../../shared/world/noise";
import { createRandom, deriveSeed, pickWeighted, type Random } from "../../../shared/world/rng";
import type { WorldData } from "../../../shared/world/world-data";
import { getRegionArea, isStandFree, type NavWorld } from "../nav/nav-query";
import { type HabitatField, sampleHabitat } from "../sim/animal-habitat";
import type { AnimalPool } from "../sim/animal-pool";
import { getSpecies, SPECIES, SPECIES_COUNT } from "../wildlife-species";
import { REGION_SIZE, type WildlifeRegions } from "./wildlife-regions";

const HABITAT_SAMPLES = 8;
const PLACE_TRIES = 24;
/** Baseline weight so an unlikely species still appears now and then (as the forests had). */
const BASE_WEIGHT = 0.02;
/** Chance that a newborn joins the newest herd of its species with room instead of leading. */
const JOIN_HERD_SHARE = 0.7;

/** Scratch placement (no allocation). */
export const placement = { x: 0, z: 0 };

/** Where and how a region animal may be placed. */
export interface RegionPlacementQuery {
  /** Keep generated animals clear of explicitly authored home bodies. */
  canPlace: (x: number, z: number) => boolean;
  field: HabitatField;
  nav: NavWorld;
  /** Leader position when a herd mate joins it (else null). */
  near: { x: number; z: number } | null;
  random: Random;
  world: WorldData;
}

/** Slots and identity the herd search reads. */
export interface HerdIdentity {
  birth: Int32Array;
  dormant: Uint8Array;
  homeRegion: Int32Array;
}

const regionOriginX = (regions: WildlifeRegions, region: number) =>
  (region % regions.regionsX) * REGION_SIZE;
const regionOriginZ = (regions: WildlifeRegions, region: number) =>
  Math.floor(region / regions.regionsX) * REGION_SIZE;

/**
 * Habitat part of a region's species mix from seeded samples: rabbits the meadow edges, deer
 * edges and clearings, elk open grass (a pure function of the habitat field; cached by callers).
 */
export const sampleRegionHabitat = (
  world: WorldData,
  regions: WildlifeRegions,
  field: HabitatField,
  region: number
) => {
  const weights = new Float32Array(SPECIES_COUNT).fill(BASE_WEIGHT);
  const random = createRandom(deriveSeed(world.seed, `region-habitat:${region}`));
  const originX = regionOriginX(regions, region);
  const originZ = regionOriginZ(regions, region);
  for (let sample = 0; sample < HABITAT_SAMPLES; sample += 1) {
    const x = originX + random() * REGION_SIZE;
    const z = originZ + random() * REGION_SIZE;
    for (let species = 0; species < SPECIES_COUNT; species += 1) {
      weights[species]! += sampleHabitat(field, species, x, z) / HABITAT_SAMPLES;
    }
  }
  return weights;
};

/** Scratch species weights (no allocation per pick). */
const speciesWeights = new Float32Array(SPECIES_COUNT);

/**
 * Species of a new region animal: the region's habitat mix, elk only in large forests (weighted
 * by the region's standing trees), drawn from `random`.
 */
export const pickRegionSpecies = (habitat: Float32Array, trees: number, random: Random) => {
  speciesWeights.set(habitat);
  speciesWeights[SPECIES.elk]! *= smoothstep(15, 60, trees);
  return Math.max(0, pickWeighted(speciesWeights, random));
};

/** Candidate spot: near the leader when one lives, else anywhere in the region. */
const pickCandidate = (regions: WildlifeRegions, region: number, query: RegionPlacementQuery) => {
  const { random } = query;
  if (query.near) {
    const angle = random() * Math.PI * 2;
    const distance = 0.8 + random() * 1.6;
    placement.x = query.near.x + DMath.cos(angle) * distance;
    placement.z = query.near.z + DMath.sin(angle) * distance;
    return;
  }
  placement.x = regionOriginX(regions, region) + random() * REGION_SIZE;
  placement.z = regionOriginZ(regions, region) + random() * REGION_SIZE;
};

/**
 * A valid spot for a region animal inside its region (its home: activity there wakes it), free nav
 * ground in a large enough connected area, clear of authored bodies, preferring good habitat; the
 * camera never matters. False when no try worked.
 */
export const findRegionSpot = (
  regions: WildlifeRegions,
  region: number,
  species: number,
  query: RegionPlacementQuery
) => {
  const { nav } = query;
  let bestScore = -1;
  let bestX = 0;
  let bestZ = 0;
  const minArea = getSpecies(species).minRegionArea;
  for (let attempt = 0; attempt < PLACE_TRIES; attempt += 1) {
    pickCandidate(regions, region, query);
    const { x, z } = placement;
    if (regions.regionOf(x, z) !== region || !query.canPlace(x, z)) continue;
    if (!isStandFree(nav, species, x, z) || getRegionArea(nav, species, x, z) < minArea) continue;
    const score = sampleHabitat(query.field, species, x, z) + query.random() * 0.3;
    if (score <= bestScore) continue;
    bestScore = score;
    bestX = x;
    bestZ = z;
  }
  placement.x = bestX;
  placement.z = bestZ;
  return bestScore >= 0;
};

/**
 * Herd leader for a newborn of `species` in `region`: the most recently born living leader of
 * that species in the region whose herd still has room (joined with JOIN_HERD_SHARE, seeded by
 * the newborn's identity), else -1 (it leads itself).
 */
export const findHerdLeader = (
  pool: AnimalPool,
  identity: HerdIdentity,
  region: number,
  species: number,
  slots: number,
  joinRoll: number
) => {
  if (joinRoll >= JOIN_HERD_SHARE) return -1;
  const [, largest] = getSpecies(species).group;
  const herdSize = new Int32Array(slots);
  for (let slot = 0; slot < slots; slot += 1) {
    const living = pool.active[slot] === 1 || identity.dormant[slot] === 1;
    if (!living || identity.homeRegion[slot] !== region) continue;
    const leader = pool.group[slot]!;
    herdSize[leader] = herdSize[leader]! + 1;
  }
  let best = -1;
  for (let slot = 0; slot < slots; slot += 1) {
    const living = pool.active[slot] === 1 || identity.dormant[slot] === 1;
    if (!living || identity.homeRegion[slot] !== region || pool.species[slot] !== species) continue;
    if (pool.group[slot] !== slot || herdSize[slot]! >= largest) continue;
    if (best < 0 || identity.birth[slot]! > identity.birth[best]!) best = slot;
  }
  return best;
};
