import { DMath } from "../../../shared/math/deterministic-math";
import {
  addBody,
  applySeparation,
  BODY,
  type BodyKind,
  type CanMove,
  clearCrowd,
  computeSeparation,
  createCrowdSpace,
  isSpotTaken
} from "../../crowd/crowd-space";
import { isSegmentWalkable, type NavWorld } from "../nav/nav-query";
import { ANIMAL_STATE, getSpecies } from "../wildlife-species";
import { isRisen } from "./animal-animation";
import type { AnimalMotionPool, AnimalPool } from "./animal-pool";

/** Share of the body half length added to the capsule radius: the animal's personal radius. */
const BODY_SHARE = 0.3;

/**
 * Walking and fleeing animals sidestep; lying ones (bedded, or still rising) are rocks the
 * others go round, so nothing slides a folded body over the ground.
 */
const getBodyKind = (state: number, risen: boolean): BodyKind => {
  if (state === ANIMAL_STATE.rest || !risen) return BODY.obstacle;
  const moving =
    state === ANIMAL_STATE.walk || state === ANIMAL_STATE.trot || state === ANIMAL_STATE.flee;
  return moving ? BODY.moving : BODY.idle;
};

/** Personal radius of an animal (cells): its capsule plus part of its length, by its size. */
export const getAnimalRadius = (pool: AnimalPool, animal: number) => {
  const profile = getSpecies(pool.species[animal]!);
  const length = (profile.body.front + profile.body.back) * 0.5;
  return (profile.clearance + length * BODY_SHARE) * pool.bodyScale[animal]!;
};

/**
 * Collision of the living animals with each other, one fixed step at a time: walkers sidestep,
 * standing ones drift apart, lying ones hold their place, and nobody is pushed off walkable ground
 * or into a trunk or rock (the nav). Workers' render frames and decorative critters are no
 * obstacles: only simulation state may move an animal (determinism).
 */
export const createAnimalCrowd = (
  pool: AnimalPool,
  motion: AnimalMotionPool,
  getNav: () => NavWorld
) => {
  const capacity = pool.active.length;
  const space = createCrowdSpace(capacity);
  /** Body index of an animal in the current step (-1 none) and the animal of a body. */
  const animalBody = new Int32Array(capacity).fill(-1);
  const bodyAnimal = new Int32Array(space.capacity).fill(-1);
  const canMove: CanMove = (fromX, fromZ, toX, toZ, body) => {
    const animal = bodyAnimal[body]!;
    if (animal < 0) return false;
    const species = pool.species[animal]!;
    const scale = pool.bodyScale[animal]!;
    return isSegmentWalkable(getNav(), species, fromX, fromZ, toX, toZ, scale);
  };

  const addAnimal = (animal: number) => {
    const heading = pool.heading[animal]!;
    const kind = getBodyKind(pool.state[animal]!, isRisen(motion, animal));
    const radius = getAnimalRadius(pool, animal);
    const { x, z } = pool;
    const body = addBody(
      space,
      x[animal]!,
      z[animal]!,
      radius,
      kind,
      DMath.cos(heading),
      DMath.sin(heading)
    );
    animalBody[animal] = body;
    if (body >= 0) bodyAnimal[body] = animal;
  };

  const fillSpace = () => {
    clearCrowd(space);
    animalBody.fill(-1);
    for (let animal = 0; animal < capacity; animal += 1) {
      if (pool.active[animal] === 1 && pool.pending[animal] === 0) addAnimal(animal);
    }
  };

  /** One collision step after the animals moved `seconds`. */
  const step = (seconds: number) => {
    fillSpace();
    computeSeparation(space, seconds);
    applySeparation(space, canMove);
    for (let animal = 0; animal < capacity; animal += 1) {
      const body = animalBody[animal]!;
      if (body < 0) continue;
      pool.x[animal] = space.x[body]!;
      pool.z[animal] = space.z[body]!;
    }
  };

  /** Another standing or lying body covers the animal's spot (no lying down on top). */
  const isCrowded = (animal: number) =>
    isSpotTaken(
      space,
      pool.x[animal]!,
      pool.z[animal]!,
      getAnimalRadius(pool, animal),
      animalBody[animal]!
    );

  return {
    isCrowded,
    step
  };
};
