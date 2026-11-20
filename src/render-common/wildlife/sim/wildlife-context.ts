import { deterministicPow,DMath } from "../../../shared/math/deterministic-math";
import type { AuditedRandom } from "../../../shared/settlement/simulation-random";
import type { Random } from "../../../shared/world/rng";
import type { WorldData } from "../../../shared/world/world-data";
import type { ViewRegion } from "../../birds/bird-view";
import { MAX_PATH_POINTS, type PathFinder } from "../nav/nav-path";
import { isSegmentWalkable, type NavWorld } from "../nav/nav-query";
import type { Range } from "../wildlife-species";
import type { HabitatField } from "./animal-habitat";
import type { AnimalMotionPool, AnimalPool } from "./animal-pool";

/** A* searches allowed per step (the rest wait a few steps). */
const PATH_BUDGET = 3;

/** Everything the simulation steps share (one per island). */
export interface WildlifeContext {
  field: HabitatField;
  finder: PathFinder;
  /** Another standing or lying body covers the animal's spot (collision; none without). */
  isCrowded?: (animal: number) => boolean;
  motion: AnimalMotionPool;
  nav: NavWorld;
  /** An animal broke into flight (cheap event hook: birds scatter, calls). */
  onFlee?: (animal: number) => void;
  /** A* searches still allowed in this step. */
  pathBudget: number;
  pool: AnimalPool;
  /** The simulation's stream (brain, spawner, placement): saved, hashed and audited. */
  random: AuditedRandom;
  region: ViewRegion;
  /** Whole steps since the island began (dormant routines and the respawn ledger count in it). */
  tick: number;
  time: number;
  /** Visual-only stream (head turns, ear flicks, animation phases): never touches gameplay. */
  visualRandom: Random;
  world: WorldData;
}

export const resetPathBudget = (context: WildlifeContext) => {
  context.pathBudget = PATH_BUDGET;
};

/** Duration drawn from a range, skewed towards the short end (many short, a few long). */
export const pickDuration = (range: Range, random: Random) =>
  range[0] + (range[1] - range[0]) * deterministicPow(random(), 1.6);

/** Normal distributed value (mean 0, deviation 1), Box-Muller. */
/** `value` eased towards `target` at `rate` per second (exponential approach, capped at the target). */
export const easeToward = (value: number, target: number, rate: number, dt: number) =>
  value + (target - value) * Math.min(1, rate * dt);

export const pickGaussian = (random: Random) =>
  Math.sqrt(-2 * DMath.log(1 - random() * 0.999)) * DMath.cos(Math.PI * 2 * random());

export const clearRoute = (pool: AnimalPool, animal: number) => {
  pool.pathCount[animal] = 0;
  pool.pathIndex[animal] = 0;
};

/**
 * Plans a route to (x, z): a straight walkable segment as one waypoint, else an A* path (when
 * the step's budget allows). False when there is no route (or no budget left).
 */
export const planRoute = (context: WildlifeContext, animal: number, x: number, z: number) => {
  const { nav, pool } = context;
  const species = pool.species[animal]!;
  const startX = pool.x[animal]!;
  const startZ = pool.z[animal]!;
  const offset = animal * MAX_PATH_POINTS * 2;
  pool.pathIndex[animal] = 0;
  pool.targetX[animal] = x;
  pool.targetZ[animal] = z;
  if (isSegmentWalkable(nav, species, startX, startZ, x, z)) {
    pool.path[offset] = x;
    pool.path[offset + 1] = z;
    pool.pathCount[animal] = 1;
    return true;
  }
  if (context.pathBudget <= 0) return false;
  context.pathBudget -= 1;
  pool.pathCount[animal] = context.finder.findPath(
    species,
    startX,
    startZ,
    x,
    z,
    pool.path,
    offset
  );
  return pool.pathCount[animal]! > 0;
};

export const getWaypointX = (pool: AnimalPool, animal: number) =>
  pool.path[(animal * MAX_PATH_POINTS + pool.pathIndex[animal]!) * 2]!;

export const getWaypointZ = (pool: AnimalPool, animal: number) =>
  pool.path[(animal * MAX_PATH_POINTS + pool.pathIndex[animal]!) * 2 + 1]!;

export const hasRoute = (pool: AnimalPool, animal: number) =>
  pool.pathIndex[animal]! < pool.pathCount[animal]!;
