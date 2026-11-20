import { DMath } from "../../shared/math/deterministic-math";
/**
 * Shared collision of moving bodies (workers, animals, ground critters): a hashed grid of
 * circles, separation with sidestepping for walkers, gentle drift for standing bodies, and
 * fixed obstacles that never move. Fixed capacity, nothing allocated per step.
 */

/** What a body in the crowd does: idle, walking, or an obstacle (moves for nobody here). */
export const BODY = { idle: 0, moving: 1, obstacle: 2 } as const;
export type BodyKind = (typeof BODY)[keyof typeof BODY];

/** Largest body radius the grid supports (cells); bigger bodies are clamped to it. */
const MAX_BODY_RADIUS = 0.75;
/** A walking body starts to sidestep this far before touching (cells). */
const AVOID_MARGIN = 0.25;
/** Grid cell (cells): at least the largest contact distance plus the avoidance margin. */
const GRID_CELL = MAX_BODY_RADIUS * 2 + AVOID_MARGIN;
/** Hash buckets of the grid (a power of two; buckets are shared, cells are told apart). */
const BUCKET_COUNT = 2048;
/** Sidestep speed at contact (cells per second). */
const SIDESTEP_SPEED = 0.7;
/** Share of an overlap two idle bodies resolve per step (a gentle push, never a jump). */
const IDLE_PUSH = 0.3;
/** Largest correction per step (cells) of a walker: no visible pops. */
const MAX_CORRECTION = 0.04;
/** Largest correction per step of a standing worker (about 1 cell per second): a gentle drift. */
const MAX_IDLE_CORRECTION = 0.008;
/** Corrections below this are dropped (no sub pixel creeping). */
const MIN_CORRECTION = 1e-5;

/** Hash of a grid cell (spatial hashing primes). */
const toBucket = (cellX: number, cellZ: number) =>
  (Math.imul(cellX, 73856093) ^ Math.imul(cellZ, 19349663)) & (BUCKET_COUNT - 1);

/**
 * Every body of one collision step as a struct of arrays in a hashed grid: fixed capacity,
 * nothing allocated while running, neighbours in O(1) per body.
 */
export const createCrowdSpace = (capacity: number) => ({
  capacity,
  cellX: new Int32Array(capacity),
  cellZ: new Int32Array(capacity),
  correctionX: new Float32Array(capacity),
  correctionZ: new Float32Array(capacity),
  count: 0,
  dirX: new Float32Array(capacity),
  dirZ: new Float32Array(capacity),
  head: new Int32Array(BUCKET_COUNT).fill(-1),
  kind: new Uint8Array(capacity),
  /** Indices found by the last `gatherNear`. */
  near: new Int32Array(capacity),
  next: new Int32Array(capacity),
  radius: new Float32Array(capacity),
  x: new Float32Array(capacity),
  z: new Float32Array(capacity)
});

export type CrowdSpace = ReturnType<typeof createCrowdSpace>;

export const clearCrowd = (space: CrowdSpace) => {
  space.count = 0;
  space.head.fill(-1);
};

/** Adds a body (walking direction for moving ones); its index, or -1 when the space is full. */
export const addBody = (
  space: CrowdSpace,
  x: number,
  z: number,
  radius: number,
  kind: BodyKind,
  dirX = 0,
  dirZ = 0
) => {
  if (space.count === space.capacity) return -1;
  const index = space.count++;
  const cellX = Math.floor(x / GRID_CELL);
  const cellZ = Math.floor(z / GRID_CELL);
  const bucket = toBucket(cellX, cellZ);
  space.x[index] = x;
  space.z[index] = z;
  space.radius[index] = Math.min(radius, MAX_BODY_RADIUS);
  space.kind[index] = kind;
  space.dirX[index] = dirX;
  space.dirZ[index] = dirZ;
  space.cellX[index] = cellX;
  space.cellZ[index] = cellZ;
  space.next[index] = space.head[bucket]!;
  space.head[bucket] = index;
  return index;
};

/** Share of an overlap that `self` resolves: walkers yield to standing bodies and obstacles. */
const pushShare = (self: number, other: number) => {
  if (self === BODY.moving) return other === BODY.moving ? 0.5 : 1;
  if (other === BODY.moving) return 0;
  return other === BODY.idle ? IDLE_PUSH * 0.5 : IDLE_PUSH;
};

/** Collects the bodies of the 3 x 3 grid cells around (x, z) into `space.near`; their count. */
const gatherNear = (space: CrowdSpace, x: number, z: number) => {
  const centerX = Math.floor(x / GRID_CELL);
  const centerZ = Math.floor(z / GRID_CELL);
  let found = 0;
  for (let cellZ = centerZ - 1; cellZ <= centerZ + 1; cellZ++)
    for (let cellX = centerX - 1; cellX <= centerX + 1; cellX++)
      for (let other = space.head[toBucket(cellX, cellZ)]!; other !== -1;) {
        // Buckets are shared by distant cells: only the bodies of this cell count.
        if (space.cellX[other] === cellX && space.cellZ[other] === cellZ)
          space.near[found++] = other;
        other = space.next[other]!;
      }
  return found;
};

/** Pushes `self` out of `other` along the normal (its share) and, while walking towards it,
 * slides it around on the side away from it (right hand for a head-on meeting). */
const separatePair = (space: CrowdSpace, self: number, other: number, step: number) => {
  const dx = space.x[self]! - space.x[other]!;
  const dz = space.z[self]! - space.z[other]!;
  const distance = DMath.hypot(dx, dz);
  const contact = space.radius[self]! + space.radius[other]!;
  const moving = space.kind[self] === BODY.moving;
  if (distance >= contact + (moving ? AVOID_MARGIN : 0)) return;
  // Exactly on top of each other: a fixed direction by index (deterministic).
  let normalX: number;
  let normalZ: number;
  if (distance > 1e-6) {
    normalX = dx / distance;
    normalZ = dz / distance;
  } else {
    normalX = self < other ? 1 : -1;
    normalZ = 0;
  }
  const overlap = contact - distance;
  if (overlap > 0) {
    const share = pushShare(space.kind[self]!, space.kind[other]!);
    space.correctionX[self]! += normalX * overlap * share;
    space.correctionZ[self]! += normalZ * overlap * share;
  }
  if (!moving) return;
  const dirX = space.dirX[self]!;
  const dirZ = space.dirZ[self]!;
  const ahead = -(normalX * dirX + normalZ * dirZ);
  if (ahead <= 0) return;
  let tangentX = -normalZ;
  let tangentZ = normalX;
  const forward = tangentX * dirX + tangentZ * dirZ;
  const side = Math.abs(forward) > 1e-3 ? forward : tangentX * -dirZ + tangentZ * dirX;
  if (side < 0) {
    tangentX = -tangentX;
    tangentZ = -tangentZ;
  }
  const closeness = Math.min(1, 1 - (distance - contact) / AVOID_MARGIN);
  const sidestep = SIDESTEP_SPEED * step * closeness * ahead;
  space.correctionX[self]! += tangentX * sidestep;
  space.correctionZ[self]! += tangentZ * sidestep;
};

/** Corrections of every non obstacle body for one fixed step of `step` seconds. */
export const computeSeparation = (space: CrowdSpace, step: number) => {
  for (let self = 0; self < space.count; self++) {
    space.correctionX[self] = 0;
    space.correctionZ[self] = 0;
    if (space.kind[self] === BODY.obstacle) continue;
    const found = gatherNear(space, space.x[self]!, space.z[self]!);
    for (let slot = 0; slot < found; slot++) {
      const other = space.near[slot]!;
      if (other !== self) separatePair(space, self, other, step);
    }
  }
};

/** Whether body `index` may move from one point to another (its walkable ground). */
export type CanMove = (
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  index: number
) => boolean;

/**
 * Moves the bodies by their corrections (capped per step) where `canMove` allows it; a blocked
 * correction slides along one axis, else the body stays (never into a blocked cell).
 */
export const applySeparation = (space: CrowdSpace, canMove: CanMove) => {
  for (let index = 0; index < space.count; index++) {
    let correctionX = space.correctionX[index]!;
    let correctionZ = space.correctionZ[index]!;
    const length = DMath.hypot(correctionX, correctionZ);
    if (length < MIN_CORRECTION) continue;
    const limit = space.kind[index] === BODY.moving ? MAX_CORRECTION : MAX_IDLE_CORRECTION;
    if (length > limit) {
      correctionX *= limit / length;
      correctionZ *= limit / length;
    }
    const x = space.x[index]!;
    const z = space.z[index]!;
    if (canMove(x, z, x + correctionX, z + correctionZ, index)) {
      space.x[index] = x + correctionX;
      space.z[index] = z + correctionZ;
    } else if (canMove(x, z, x + correctionX, z, index)) space.x[index] = x + correctionX;
    else if (canMove(x, z, x, z + correctionZ, index)) space.z[index] = z + correctionZ;
  }
};

/** Whether a standing body (idle worker or obstacle) other than `self` covers the spot. */
export const isSpotTaken = (
  space: CrowdSpace,
  x: number,
  z: number,
  radius: number,
  self: number
) => {
  const found = gatherNear(space, x, z);
  for (let slot = 0; slot < found; slot++) {
    const other = space.near[slot]!;
    if (other === self || space.kind[other] === BODY.moving) continue;
    const distance = DMath.hypot(space.x[other]! - x, space.z[other]! - z);
    if (distance < space.radius[other]! + radius) return true;
  }
  return false;
};

const FREE_SPOT_RINGS = 6;

/** The nearest spot around (x, z) that is free ground (`isFree`) and not taken, or null. */
export const findFreeSpot = (
  space: CrowdSpace,
  x: number,
  z: number,
  radius: number,
  self: number,
  isFree: (x: number, z: number) => boolean
) => {
  for (let ring = 1; ring <= FREE_SPOT_RINGS; ring++) {
    const steps = ring * 8;
    for (let step = 0; step < steps; step++) {
      const angle = (step / steps) * Math.PI * 2;
      const spotX = x + DMath.cos(angle) * ring * radius;
      const spotZ = z + DMath.sin(angle) * ring * radius;
      if (!isSpotTaken(space, spotX, spotZ, radius, self) && isFree(spotX, spotZ))
        return { x: spotX, z: spotZ };
    }
  }
  return null;
};

/** Adds one obstacle (centre and radius in cells) to a collision step. */
export type AddObstacle = (x: number, z: number, radius: number) => void;
/** Lists the moving obstacles of a step (workers, animals, critters) through `add`. */
export type ObstacleSource = (add: AddObstacle) => void;

/** Several obstacle sources as one. */
export const combineObstacles =
  (...sources: readonly ObstacleSource[]): ObstacleSource =>
  (add) => {
    for (const source of sources) source(add);
  };
