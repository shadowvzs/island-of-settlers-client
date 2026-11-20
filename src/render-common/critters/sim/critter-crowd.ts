import {
  addBody,
  type AddObstacle,
  applySeparation,
  BODY,
  type BodyKind,
  type CanMove,
  clearCrowd,
  computeSeparation,
  createCrowdSpace,
  type ObstacleSource
} from "../../crowd/crowd-space";
import { CRITTER_SPECIES } from "../critter-species";
import type { CritterContext } from "./critter-context";
import type { CritterPool } from "./critter-pool";
import { isRoamFree, ROAM_MODE } from "./critter-roam";

/** Room for the workers, animals and other moving obstacles of one step. */
const MAX_OBSTACLES = 512;

const getBodyKind = (mode: number): BodyKind => {
  if (mode === ROAM_MODE.rest) return BODY.obstacle;
  return mode === ROAM_MODE.walk || mode === ROAM_MODE.flee ? BODY.moving : BODY.idle;
};

/** Personal radius of a live ground critter (0: it does not collide, nor does a carcass). */
export const getCritterRadius = (pool: CritterPool, index: number) => {
  if (pool.active[index] === 0 || pool.hidden[index] === 1 || pool.lift[index]! > 0.05) return 0;
  if (pool.carcass[index] === 1) return 0;
  const species = CRITTER_SPECIES[pool.species[index]!]!;
  return species.bodyRadius * (pool.scale[index]! / species.size);
};

/**
 * Collision of the ground critters (fox, boars, wolves, bear ...) with each other and with the
 * moving obstacles around (workers, the food animals): walkers sidestep, standing ones drift
 * apart, lying ones hold their place; nobody is pushed into a trunk, rock or water.
 */
export const createCritterCrowd = (pool: CritterPool, context: CritterContext) => {
  const space = createCrowdSpace(pool.capacity + MAX_OBSTACLES);
  const critterBody = new Int32Array(pool.capacity).fill(-1);
  const bodyCritter = new Int32Array(space.capacity).fill(-1);
  let obstacles: ObstacleSource | null = null;
  const addObstacle: AddObstacle = (x, z, radius) => {
    const body = addBody(space, x, z, radius, BODY.obstacle);
    if (body >= 0) bodyCritter[body] = -1;
  };
  const canMove: CanMove = (_fromX, _fromZ, toX, toZ, body) => {
    const index = bodyCritter[body]!;
    return index >= 0 && isRoamFree(context, pool.species[index]!, toX, toZ);
  };

  const addCritter = (index: number, radius: number) => {
    const heading = pool.heading[index]!;
    const kind = getBodyKind(pool.mode[index]!);
    const { x, z } = pool;
    const dirX = Math.cos(heading);
    const dirZ = Math.sin(heading);
    const body = addBody(space, x[index]!, z[index]!, radius, kind, dirX, dirZ);
    critterBody[index] = body;
    if (body >= 0) bodyCritter[body] = index;
  };

  const fillSpace = () => {
    clearCrowd(space);
    critterBody.fill(-1);
    for (let index = 0; index < pool.capacity; index += 1) {
      const radius = getCritterRadius(pool, index);
      if (radius > 0) addCritter(index, radius);
    }
    obstacles?.(addObstacle);
  };

  /** One collision step after the critters moved. */
  const step = () => {
    fillSpace();
    if (space.count === 0) return;
    computeSeparation(space, context.step);
    applySeparation(space, canMove);
    for (let index = 0; index < pool.capacity; index += 1) {
      const body = critterBody[index]!;
      if (body < 0) continue;
      pool.x[index] = space.x[body]!;
      pool.z[index] = space.z[body]!;
    }
  };

  return {
    /** Workers and food animals (or other moving obstacles) the critters keep apart from. */
    setObstacles: (source: ObstacleSource | null) => {
      obstacles = source;
    },
    step
  };
};

/** The live ground critters as obstacles of others (animals, workers). */
export const createCritterObstacles =
  (pool: CritterPool): ObstacleSource =>
  (add) => {
    for (let index = 0; index < pool.capacity; index += 1) {
      const radius = getCritterRadius(pool, index);
      if (radius > 0) add(pool.x[index]!, pool.z[index]!, radius);
    }
  };
