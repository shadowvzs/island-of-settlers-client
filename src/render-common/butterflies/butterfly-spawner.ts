import { randomInRange } from "../../shared/world/rng";
import { pickPointInView, type ViewRegion } from "../birds/bird-view";
import {
  findFlower,
  getSpeciesAffinity,
  readHabitatTerms,
  scoreButterflyZone
} from "./butterfly-habitat";
import {
  type ButterflyContext,
  isFlowerTaken,
  startFlying,
  startSitting} from "./butterfly-motion";
import {
  type ButterflyHistory,
  type ButterflyPool,
  findFreeButterfly,
  rememberButterfly} from "./butterfly-pool";
import { BUTTERFLY_SPECIES } from "./butterfly-species";

const SPAWN_TRIES = 8;
/** Spawn this share of the view away from its edges (they rise from the grass in view). */
const SPAWN_INSET = 0.12;
/** Some spawn sitting on a flower within this distance. */
const SIT_SPAWN_CHANCE = 0.4;
const SIT_SPAWN_RADIUS = 2;
const TAU = Math.PI * 2;

/** New butterflies in suitable spots of the view, by species habitat; some start on a flower. */
export const createButterflySpawner = (
  context: ButterflyContext,
  pool: ButterflyPool,
  history: ButterflyHistory,
  region: ViewRegion
) => {
  const { field, random } = context;
  const { habitat, world } = field;

  /** Species by how much each likes the spot (weighted pick). */
  const pickSpecies = (x: number, z: number) => {
    const spot = readHabitatTerms(field, x, z);
    let total = 0;
    for (const species of BUTTERFLY_SPECIES) total += getSpeciesAffinity(species.habitat, spot);
    let roll = random() * total;
    for (let index = 0; index < BUTTERFLY_SPECIES.length; index += 1) {
      roll -= getSpeciesAffinity(BUTTERFLY_SPECIES[index]!.habitat, spot);
      if (roll <= 0) return index;
    }
    return BUTTERFLY_SPECIES.length - 1;
  };

  /** Some start on a nearby free flower (they take off later), the rest in flight. */
  const settleOnFlower = (index: number) => {
    if (random() >= SIT_SPAWN_CHANCE) return;
    const flower = findFlower(field, pool.x[index]!, pool.z[index]!, SIT_SPAWN_RADIUS, -1);
    if (flower < 0 || isFlowerTaken(pool, flower)) return;
    pool.flower[index] = flower;
    pool.targetX[index] = world.props.x[flower]!;
    pool.targetZ[index] = world.props.z[flower]!;
    startSitting(pool, index, context);
    pool.sit[index] = 1;
    pool.flap[index] = 0;
  };

  const spawnAt = (index: number, x: number, z: number) => {
    const speciesId = pickSpecies(x, z);
    const species = BUTTERFLY_SPECIES[speciesId]!;
    pool.active[index] = 1;
    pool.leaving[index] = 0;
    pool.species[index] = speciesId;
    pool.x[index] = x;
    pool.z[index] = z;
    pool.homeX[index] = x;
    pool.homeZ[index] = z;
    pool.cruise[index] = randomInRange(random, species.cruise);
    pool.y[index] = habitat.surface(x, z) + pool.cruise[index]!;
    pool.heading[index] = random() * TAU;
    pool.speed[index] = species.speed * (0.85 + random() * 0.3);
    pool.seed[index] = random() * 10;
    pool.shade[index] = 0.9 + random() * 0.2;
    pool.phase[index] = random() * TAU;
    pool.flap[index] = 1;
    pool.sit[index] = 0;
    pool.appear[index] = 0;
    pool.outOfView[index] = 0;
    pool.glideTimer[index] = 0;
    pool.flower[index] = -1;
    startFlying(pool, index, random);
    settleOnFlower(index);
    rememberButterfly(pool, history, index);
  };

  /** A few random spots in view; a spot is taken with its zone score as the chance. */
  return () => {
    const index = findFreeButterfly(pool);
    if (index < 0) return;
    for (let attempt = 0; attempt < SPAWN_TRIES; attempt += 1) {
      const point = pickPointInView(region, random, SPAWN_INSET);
      const score = scoreButterflyZone(field, BUTTERFLY_SPECIES, point.x, point.z);
      if (score > 0.05 && random() < score) {
        spawnAt(index, point.x, point.z);
        return;
      }
    }
  };
};
