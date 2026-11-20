import {
  addBody,
  type AddObstacle,
  applySeparation,
  BODY,
  clearCrowd,
  computeSeparation,
  createCrowdSpace,
  findFreeSpot,
  isSpotTaken,
  type ObstacleSource
} from "../crowd/crowd-space";
import { isSegmentWalkable, isStandFree, type NavWorld } from "../wildlife/nav/nav-query";
import { WORKER_COLLISION_RADIUS } from "./worker-dimensions";
import { WORKER_NAV_SPECIES,type WorkerFrame } from "./worker-unit";

/** Room for moving obstacles (big animals) in the collision space. */
const MAX_OBSTACLES = 1024;
/** Closer than this to its target (cells), a walker checks whether the spot is taken. */
const ARRIVAL_CHECK = 0.9;
/** A walker that moves less than this in STUCK_PERIOD seconds twice in a row gives up. */
const STUCK_DISTANCE = 0.12;
const STUCK_PERIOD = 1;
const STUCK_STRIKES = 2;

/** What the crowd needs of a worker unit. */
export interface CrowdUnit {
  frame: WorkerFrame;
  redirect: (x: number, z: number) => boolean;
  stop: () => void;
}

/**
 * Collision of the workers, one fixed step at a time: walkers sidestep and slide around each
 * other and around big animals, idle workers drift apart, nobody is pushed onto blocked ground;
 * a walker whose spot is taken stops at the nearest free spot, a stuck walker gives up.
 */
export const createWorkerCrowd = (nav: NavWorld, units: readonly CrowdUnit[]) => {
  const space = createCrowdSpace(units.length + MAX_OBSTACLES);
  const stuckX = new Float32Array(units.length);
  const stuckZ = new Float32Array(units.length);
  const stuckTime = new Float32Array(units.length);
  const stuckStrikes = new Uint8Array(units.length);
  let obstacles: ObstacleSource | null = null;
  const addObstacle: AddObstacle = (x, z, radius) => {
    addBody(space, x, z, radius, BODY.obstacle);
  };
  const canMove = (fromX: number, fromZ: number, toX: number, toZ: number) =>
    isSegmentWalkable(nav, WORKER_NAV_SPECIES, fromX, fromZ, toX, toZ);
  const isFree = (x: number, z: number) => isStandFree(nav, WORKER_NAV_SPECIES, x, z);

  const fillSpace = () => {
    clearCrowd(space);
    for (const { frame } of units) {
      const kind = frame.target ? BODY.moving : BODY.idle;
      addBody(
        space,
        frame.x,
        frame.z,
        WORKER_COLLISION_RADIUS,
        kind,
        Math.sin(frame.heading),
        Math.cos(frame.heading)
      );
    }
    obstacles?.(addObstacle);
  };

  /** The target is covered by a standing body: the nearest free spot instead, else stop. */
  const avoidTakenTarget = (unit: CrowdUnit, index: number) => {
    const target = unit.frame.target;
    if (!target) return;
    const distance = Math.hypot(target.x - unit.frame.x, target.z - unit.frame.z);
    if (distance > ARRIVAL_CHECK) return;
    if (!isSpotTaken(space, target.x, target.z, WORKER_COLLISION_RADIUS, index)) return;
    const spot = findFreeSpot(space, target.x, target.z, WORKER_COLLISION_RADIUS, index, isFree);
    if (!spot || !unit.redirect(spot.x, spot.z)) unit.stop();
  };

  /** Stops a walker that barely moved over two periods (pressed against a standing crowd). */
  const giveUpWhenStuck = (unit: CrowdUnit, index: number, step: number) => {
    const { frame } = unit;
    stuckTime[index]! += step;
    if (stuckTime[index]! < STUCK_PERIOD) return;
    const moved = Math.hypot(frame.x - stuckX[index]!, frame.z - stuckZ[index]!);
    stuckTime[index] = 0;
    stuckX[index] = frame.x;
    stuckZ[index] = frame.z;
    const stuck = frame.target !== null && moved < STUCK_DISTANCE;
    stuckStrikes[index] = stuck ? stuckStrikes[index]! + 1 : 0;
    if (stuckStrikes[index]! < STUCK_STRIKES) return;
    stuckStrikes[index] = 0;
    unit.stop();
  };

  /** One collision step after the units walked `step` seconds. */
  const step = (seconds: number) => {
    fillSpace();
    computeSeparation(space, seconds);
    applySeparation(space, canMove);
    for (let index = 0; index < units.length; index++) {
      const unit = units[index]!;
      unit.frame.x = space.x[index]!;
      unit.frame.z = space.z[index]!;
      avoidTakenTarget(unit, index);
      giveUpWhenStuck(unit, index, seconds);
    }
  };

  return {
    /** Big animals (or other moving obstacles) the workers walk around. */
    setObstacles: (source: ObstacleSource | null) => {
      obstacles = source;
    },
    step
  };
};
