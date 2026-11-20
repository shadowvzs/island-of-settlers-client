import { createRandom, deriveSeed } from "../../../shared/world/rng";
import type { WorldData } from "../../../shared/world/world-data";
import { createRabbitAppearance } from "../model/rabbit-coat";
import { ANIMAL_STATE, type AnimalState, getSpecies, SPECIES } from "../wildlife-species";
import { pickSpawnAge, setAnimalAge } from "./animal-age";
import { initVisualMotion } from "./animal-animation";
import { setState } from "./animal-brain";
import { createPersonality } from "./animal-personality";
import { REACTION } from "./animal-pool";
import { pickDuration, type WildlifeContext } from "./wildlife-context";

const START_STATES: AnimalState[] = [ANIMAL_STATE.graze, ANIMAL_STATE.idle, ANIMAL_STATE.look];
/** Share of adult deer that keep faint dapples (coat variety). */
const DAPPLED_SHARE = 0.3;
/** Herd leaders are mostly mothers (cows, does); some groups follow a male. */
const LEADER_MALE_SHARE = 0.2;

/** Home: the centre the animal roams around and how far. */
export interface AnimalHome {
  centreX: number;
  centreZ: number;
  range: number;
}

/**
 * Who is born: age (0 .. 1), sex (0 female, 1 male) and the island's birth number of this
 * individual, which with its slot seeds everything individual (coat, body, personality).
 */
export interface AnimalBirth {
  age: number;
  birth: number;
  /** 0 meadow .. 1 deep forest around the birth place (rabbit coat bias). */
  forest: number;
  sex: number;
}

/** Steps of the saved forest bias (one byte): births use the same rounded value. */
export const FOREST_STEPS = 255;

/** The identity streams of an individual: one per kind, from the island seed, slot and birth. */
const identitySeed = (world: WorldData, kind: string, slot: number, birth: number) =>
  deriveSeed(world.seed, `${kind}-${slot}-${birth}`);

/** One identity stream of an individual (herd choice, routines...): never the audited stream. */
export const createIdentityRandom = (world: WorldData, kind: string, slot: number, birth: number) =>
  createRandom(identitySeed(world, kind, slot, birth));

/** Age and sex of a new animal from its identity stream (the audited stream is not touched). */
export const createBirth = (
  world: WorldData,
  slot: number,
  birth: number,
  traits: { forest: number; leader: boolean; respawn: boolean }
): AnimalBirth => {
  const random = createIdentityRandom(world, "birth", slot, birth);
  const age = pickSpawnAge(random, traits.leader, traits.respawn);
  const sex = random() < (traits.leader ? LEADER_MALE_SHARE : 0.5) ? 1 : 0;
  const forest = Math.round(Math.min(1, Math.max(0, traits.forest)) * FOREST_STEPS) / FOREST_STEPS;
  return { age, birth, forest, sex };
};

/** Coat, body type and ears of a rabbit from its appearance seed. */
const applyRabbitAppearance = (context: WildlifeContext, animal: number, seed: number, forest: number) => {
  const { motion, pool } = context;
  const look = createRabbitAppearance(seed, forest);
  pool.coat.set([look.archetype, look.patchPattern, look.patchSeed, look.earDarkness], animal * 4);
  pool.form[animal] = look.bodyType;
  motion.earLeftBase[animal] = look.earLeft;
  motion.earRightBase[animal] = look.earRight;
};

/** Personality factors from the behaviour seed. */
const applyPersonality = (context: WildlifeContext, animal: number, seed: number) => {
  const { pool } = context;
  const personality = createPersonality(seed);
  pool.speedFactor[animal] = personality.speed;
  pool.shyness[animal] = personality.alertness / personality.boldness;
  pool.wanderScale[animal] = personality.wanderRadius;
  pool.restBias[animal] = personality.restFrequency;
  pool.idleBias[animal] = personality.idleDuration;
};

/**
 * Everything the identity seeds decide (species, sex, size, shade, tone, dapples, personality,
 * rabbit coat and ears): the same on every host, at birth and whenever a dormant animal wakes.
 */
export const applyIdentity = (context: WildlifeContext, animal: number, species: number, birth: AnimalBirth) => {
  const { motion, pool, world } = context;
  const profile = getSpecies(species);
  const body = createRandom(identitySeed(world, "body", animal, birth.birth));
  pool.species[animal] = species;
  pool.sex[animal] = birth.sex;
  pool.size[animal] = 1 + (body() * 2 - 1) * profile.sizeJitter;
  pool.shade[animal] = 0.88 + body() * 0.24;
  pool.tone[animal] = body() * 2 - 1;
  pool.dappled[animal] = body() < DAPPLED_SHARE ? 1 : 0;
  applyPersonality(context, animal, identitySeed(world, "mind", animal, birth.birth));
  pool.form[animal] = 0;
  motion.earLeftBase[animal] = 0;
  motion.earRightBase[animal] = 0;
  if (species === SPECIES.rabbit) {
    applyRabbitAppearance(context, animal, identitySeed(world, "look", animal, birth.birth), birth.forest);
  }
};

/**
 * Brings an animal to life in its slot at its current (x, z): identity, home, herd leader, a calm
 * start state at a random point of its duration (a herd never moves in lockstep). The start
 * heading, timers and state come from the identity's own stream, never the audited one.
 */
export const initAnimal = (
  context: WildlifeContext,
  animal: number,
  species: number,
  leader: number,
  home: AnimalHome,
  birth: AnimalBirth
) => {
  const { motion, pool, world } = context;
  const profile = getSpecies(species);
  const start = createRandom(identitySeed(world, "start", animal, birth.birth));
  pool.active[animal] = 1;
  applyIdentity(context, animal, species, birth);
  pool.group[animal] = leader;
  pool.heading[animal] = start() * Math.PI * 2;
  pool.desiredHeading[animal] = pool.heading[animal]!;
  pool.homeX[animal] = home.centreX;
  pool.homeZ[animal] = home.centreZ;
  pool.homeRange[animal] = home.range;
  pool.speed[animal] = 0;
  pool.health[animal] = 1;
  pool.huntState[animal] = 0;
  pool.alertLevel[animal] = 0;
  pool.threatAge[animal] = 99;
  pool.reaction[animal] = REACTION.none;
  pool.blocked[animal] = 0;
  pool.appear[animal] = 0;
  pool.pending[animal] = 0;
  pool.departing[animal] = 0;
  pool.arrivalTime[animal] = 0;
  pool.aiTimer[animal] = start() * 0.3;
  pool.lastThreatTime[animal] = -1;
  setAnimalAge(pool, animal, birth.age);
  initVisualMotion(context, animal);
  motion.rest[animal] = 0;
  const state = START_STATES[Math.floor(start() * START_STATES.length)]!;
  const range = state === ANIMAL_STATE.graze ? profile.durations.graze : profile.durations.idle;
  setState(context, animal, state, pickDuration(range, start));
  pool.stateTime[animal] = start() * pool.stateLength[animal]!;
};
