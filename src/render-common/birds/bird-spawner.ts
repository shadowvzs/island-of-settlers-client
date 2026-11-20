import { pickWeighted, type Random } from "../../shared/world/rng";
import type { BirdBuildingAvoidance } from "./bird-building-avoidance";
import { type Flock,setFlockMode } from "./bird-flock";
import {
  getCoverPerchHeight,
  type HabitatField,
  sampleHabitat,
  scoreHabitat} from "./bird-habitat";
import { type BirdHistory, type BirdPool,rememberBird } from "./bird-pool";
import { BIRD_SPECIES, type BirdSpecies } from "./bird-species";
import { isInView, pickEdgeEntry, pickPointInView, type ViewRegion } from "./bird-view";

const TAU = Math.PI * 2;
const SPAWN_ATTEMPTS = 4;
const MIN_SPAWN_SCORE = 0.12;
/** Share of spawns that take off inside the view when a perch is there (else they fly in). */
const PERCH_SPAWN_SHARE = 0.6;
const EDGE_MARGIN = 2;

/** Where and how a new flock starts. */
export interface SpawnChoice {
  fromPerch: boolean;
  heading: number;
  species: number;
  x: number;
  y: number;
  z: number;
}

const speciesScores = new Float32Array(BIRD_SPECIES.length);

const pickSpecies = (field: HabitatField, x: number, z: number, random: Random) => {
  BIRD_SPECIES.forEach((species, index) => {
    speciesScores[index] = scoreHabitat(field, species.habitat, x, z);
  });
  const species = pickWeighted(speciesScores, random);
  return species >= 0 && speciesScores[species]! >= MIN_SPAWN_SCORE ? species : -1;
};

/**
 * A spawn by habitat: a spot in view picks a species by how much each likes it; birds take off
 * from cover there (a leafy crown or a big bush), or fly in over the nearest view edge.
 */
export const pickSpawn = (
  field: HabitatField,
  region: ViewRegion,
  random: Random,
  buildings?: BirdBuildingAvoidance
): SpawnChoice | null => {
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt += 1) {
    const point = pickPointInView(region, random, 0.12);
    const species = pickSpecies(field, point.x, point.z, random);
    if (species < 0) continue;
    const perch = getCoverPerchHeight(field, BIRD_SPECIES[species]!, point.x, point.z);
    if (
      perch !== null &&
      (!buildings ||
        buildings.clear(
          { x: point.x, y: perch, z: point.z },
          BIRD_SPECIES[species]!.size * 0.6 + 1.3
        )) &&
      random() < PERCH_SPAWN_SHARE
    )
      return {
        fromPerch: true,
        heading: random() * TAU,
        species,
        x: point.x,
        y: perch,
        z: point.z
      };
    const cruise = BIRD_SPECIES[species]!.altitude[1];
    const entry = pickEntryOutOfView(field, region, random, cruise);
    if (!entry) continue;
    if (buildings && !buildings.clear(entry, BIRD_SPECIES[species]!.size * 0.6)) continue;
    return { fromPerch: false, species, ...entry };
  }
  return null;
};

/** Steps (world units) an entry moves outwards until its bird is out of view at its height. */
const ENTRY_STEP = 1;
const ENTRY_STEPS = 24;
/** How far outside the view (world units) a flock starts, so its first frame is not on screen. */
const ENTRY_CLEARANCE = 1.5;

/**
 * Entry of a flock flying in: just outside a view edge AT ITS FLIGHT HEIGHT. Height lifts a bird
 * up the iso screen, so a point outside the bottom edge on the ground can still be in view in
 * the air (the bird popped in at full size): the point moves outwards until it is not; null when
 * it stays in view (high ground at the edge), so another entry is tried.
 */
export const pickEntryOutOfView = (
  field: HabitatField,
  region: ViewRegion,
  random: Random,
  cruise: number
) => {
  const entry = pickEdgeEntry(region, random, EDGE_MARGIN);
  const outX = -Math.cos(entry.heading) * ENTRY_STEP;
  const outZ = -Math.sin(entry.heading) * ENTRY_STEP;
  let { x, z } = entry;
  let y = sampleHabitat(field, field.canopy, x, z) + cruise;
  for (let step = 0; step < ENTRY_STEPS && isInView(region, x, y, z, ENTRY_CLEARANCE); step += 1) {
    x += outX;
    z += outZ;
    y = sampleHabitat(field, field.canopy, x, z) + cruise;
  }
  return isInView(region, x, y, z, ENTRY_CLEARANCE) ? null : { heading: entry.heading, x, y, z };
};

/** Flock size of a species: solo birds and loose groups. */
export const pickFlockSize = (species: BirdSpecies, random: Random) =>
  species.flockMin + Math.floor(random() * (species.flockMax - species.flockMin + 1));

/** A fresh flight: cruise height, flight duration, wander seed and split timing. */
export const startFlight = (flock: Flock, species: BirdSpecies, random: Random) => {
  const [low, high] = species.altitude;
  flock.course = flock.heading;
  flock.courseTimer = 4 + random() * 8;
  flock.cruise = low + random() * (high - low);
  flock.flightLeft = 14 + random() * 28;
  flock.leaving = false;
  flock.noiseSeed = random() * 1000;
  flock.outOfView = 0;
  flock.splitTimer = 6 + random() * 12;
  flock.turn = 0;
};

export const initFlock = (flock: Flock, choice: SpawnChoice, size: number, random: Random) => {
  const species = BIRD_SPECIES[choice.species]!;
  flock.active = true;
  flock.roof = null;
  flock.age = 0;
  flock.heading = choice.heading;
  flock.size = size;
  flock.species = choice.species;
  flock.speed = species.speed * (choice.fromPerch ? 0.35 : 1);
  flock.x = choice.x;
  flock.y = choice.y;
  flock.z = choice.z;
  startFlight(flock, species, random);
  setFlockMode(flock, choice.fromPerch ? "takeoff" : "wander", Infinity);
};

/** Loose, irregular slot of a member: no formation, wider for bigger flocks and birds. */
const assignOffsets = (pool: BirdPool, bird: number, flock: Flock, random: Random) => {
  const { size } = flock;
  const spacing = Math.max(1, BIRD_SPECIES[flock.species]!.size / 0.6);
  const spread = size > 1 ? (0.5 + size * 0.22) * spacing : 0;
  pool.offsetSide[bird] = (random() * 2 - 1) * spread;
  const forward = -random() * size * 0.35 + (random() - 0.5) * 0.5;
  pool.offsetForward[bird] = size > 1 ? forward * spacing : 0;
  pool.offsetHeight[bird] = size > 1 ? (random() - 0.5) * 0.6 : 0;
};

const assignTraits = (pool: BirdPool, bird: number, species: number, random: Random) => {
  pool.species[bird] = species;
  pool.seed[bird] = random();
  pool.rateFactor[bird] = 0.85 + random() * 0.3;
  pool.speedFactor[bird] = 0.93 + random() * 0.14;
  pool.shade[bird] = 0.86 + random() * 0.28;
  pool.phase[bird] = random() * TAU;
  pool.glideTimer[bird] = random() * 1.5;
  pool.gliding[bird] = 0;
  pool.flapBoost[bird] = 1;
  pool.detach[bird] = 0;
  pool.bank[bird] = 0;
  pool.pitch[bird] = 0;
  pool.verticalSpeed[bird] = 0;
};

/**
 * Puts the members of a flock in place: from a perch they wait hidden at the spot and emerge one
 * after another; flying in they start at their slots, already cruising.
 */
export const placeMembers = (
  pool: BirdPool,
  history: BirdHistory,
  flock: Flock,
  fromPerch: boolean,
  random: Random
) => {
  let delay = 0;
  for (let member = 0; member < flock.size; member += 1) {
    const bird = flock.members[member]!;
    assignTraits(pool, bird, flock.species, random);
    assignOffsets(pool, bird, flock, random);
    const jitter = fromPerch ? 0.5 : 0;
    const side = fromPerch ? 0 : pool.offsetSide[bird]!;
    pool.x[bird] = flock.x - Math.sin(flock.heading) * side + (random() - 0.5) * jitter;
    pool.z[bird] = flock.z + Math.cos(flock.heading) * side + (random() - 0.5) * jitter;
    pool.y[bird] = flock.y + (fromPerch ? 0 : pool.offsetHeight[bird]!);
    pool.heading[bird] = flock.heading + (fromPerch ? (random() - 0.5) * 1.2 : 0);
    pool.speed[bird] = flock.speed * (fromPerch ? 0.5 : 1);
    pool.flap[bird] = fromPerch ? 1 : 0.8;
    pool.delay[bird] = fromPerch ? delay : 0;
    pool.appear[bird] = fromPerch ? 0 : 1;
    pool.settle[bird] = -1;
    delay += 0.1 + random() * 0.3;
    rememberBird(pool, history, bird);
  }
};
