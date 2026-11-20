import { clamp, smoothstep } from "../../shared/world/noise";
import type { Random } from "../../shared/world/rng";
import type { BirdBuildingAvoidance } from "./bird-building-avoidance";
import {
  approach,
  getBankAngle,
  getFlapTarget,
  getLandingProfile,
  getPitchAngle,
  getTakeoffProfile,
  smoothingFactor,
  steerHeading,
  wrapAngle
} from "./bird-flight";
import { type Flock,TAKEOFF_SECONDS } from "./bird-flock";
import { type HabitatField,sampleHabitat } from "./bird-habitat";
import type { BirdPool } from "./bird-pool";
import { getRoofSlot } from "./bird-roof-perches";
import { BIRD_SPECIES, type BirdSpecies } from "./bird-species";

const TAU = Math.PI * 2;
/** Birds aim at a point this far ahead of their slot, so they never swirl around it. */
const LOOKAHEAD = 1.3;
const SPLIT_DISTANCE = 3.5;
const SETTLE_RADIUS = 1.3;
const SETTLE_SECONDS = 0.7;
const APPEAR_SECONDS = 0.3;
const BURST_CHANCE = 0.06;
const MIN_CLEARANCE = 0.2;
/** Fastest lift (units per second) when a bird is below the crowns or ground it flies over. */
const FLOOR_LIFT = 4;
/** A landing that takes longer than this settles the stragglers where they are. */
const LANDING_TIMEOUT = 12;

export interface BirdContext {
  buildings?: BirdBuildingAvoidance;
  field: HabitatField;
  random: Random;
  step: number;
  time: number;
}

/** Landing flocks draw together over the perch (1 = normal spacing). */
const getLandingGather = (flock: Flock) => {
  if (flock.mode !== "land") return 1;
  const distance = Math.hypot(flock.landX - flock.x, flock.landZ - flock.z);
  return clamp(distance / flock.landDistance, 0.25, 1);
};

/** Scratch target of a bird (hot path: no allocation). */
const slot = { height: 0, x: 0, z: 0 };
const roofSlot = { x: 0, y: 0, z: 0 };
const previous = { x: 0, y: 0, z: 0 },
  position = { x: 0, y: 0, z: 0 };

/** Where the bird wants to be: its loose, drifting slot in the flock, ahead of the leader. */
const getSlotTarget = (pool: BirdPool, bird: number, flock: Flock, time: number) => {
  const seed = pool.seed[bird]!;
  const split = smoothstep(0, 1.5, pool.detach[bird]!) * pool.detachSide[bird]! * SPLIT_DISTANCE;
  const side = pool.offsetSide[bird]! + Math.sin(time * 0.31 * (1 + seed) + seed * 10) * 0.45;
  const forward = pool.offsetForward[bird]! + Math.sin(time * 0.23 + seed * 7) * 0.5;
  const gather = getLandingGather(flock);
  const ahead = LOOKAHEAD + forward * gather;
  const lateral = side * gather + split;
  const cos = Math.cos(flock.heading);
  const sin = Math.sin(flock.heading);
  slot.x = flock.x + cos * ahead - sin * lateral;
  slot.z = flock.z + sin * ahead + cos * lateral;
  slot.height = flock.y + pool.offsetHeight[bird]! + Math.sin(time * 0.27 + seed * 3) * 0.3;
  return slot;
};

/** Glide / flap stretches alternate with random lengths; bursts of faster beats now and then. */
const updateFlapRhythm = (
  pool: BirdPool,
  bird: number,
  species: BirdSpecies,
  context: BirdContext
) => {
  const { random, step } = context;
  pool.glideTimer[bird]! -= step;
  if (pool.glideTimer[bird]! <= 0) {
    const gliding = pool.gliding[bird] === 1 ? 0 : 1;
    pool.gliding[bird] = gliding;
    const share = gliding ? species.glideShare : 1 - species.glideShare;
    pool.glideTimer[bird] = share * (0.8 + random() * 2.4);
  }
  if (random() < BURST_CHANCE * step) pool.flapBoost[bird] = 1.5;
  pool.flapBoost[bird] = approach(pool.flapBoost[bird]!, 1, step * 0.45);
};

const getModeBoost = (flock: Flock) => {
  if (flock.mode === "takeoff")
    return getTakeoffProfile(flock.modeTime / TAKEOFF_SECONDS).flapBoost;
  return flock.mode === "scatter" ? 1.6 : 1;
};

const isGliding = (pool: BirdPool, bird: number, flock: Flock) => {
  if (flock.mode === "land") {
    const distance = Math.hypot(flock.landX - flock.x, flock.landZ - flock.z);
    return getLandingProfile(distance, flock.landDistance).glide || pool.settle[bird]! >= 0;
  }
  return pool.gliding[bird] === 1 && flock.mode !== "takeoff" && flock.mode !== "scatter";
};

const updateWings = (pool: BirdPool, bird: number, flock: Flock, context: BirdContext) => {
  const species = BIRD_SPECIES[pool.species[bird]!]!;
  updateFlapRhythm(pool, bird, species, context);
  const boost = Math.max(pool.flapBoost[bird]!, getModeBoost(flock));
  const target = getFlapTarget(pool.verticalSpeed[bird]!, isGliding(pool, bird, flock), boost);
  pool.flap[bird] = approach(pool.flap[bird]!, target, context.step * 3);
  const rate = species.flapRate * pool.rateFactor[bird]! * boost * (0.35 + 0.65 * pool.flap[bird]!);
  pool.phase[bird] = (pool.phase[bird]! + TAU * rate * context.step) % TAU;
};

/** Horizontal steering and speed towards the slot; returns the turn rate of this step. */
const steerToSlot = (pool: BirdPool, bird: number, flock: Flock, context: BirdContext) => {
  const { step } = context;
  const species = BIRD_SPECIES[pool.species[bird]!]!;
  const dx = slot.x - pool.x[bird]!;
  const dz = slot.z - pool.z[bird]!;
  const before = pool.heading[bird]!;
  const turnRate = species.turnRate * (flock.mode === "scatter" ? 1.6 : 1.2);
  const along = dx * Math.cos(before) + dz * Math.sin(before);
  /** A slot fallen behind is waited for (align and slow down), never chased in a loop. */
  let desired = along < -0.2 ? flock.heading : Math.atan2(dz, dx);
  if (context.buildings) {
    position.x = pool.x[bird]!;
    position.y = pool.y[bird]!;
    position.z = pool.z[bird]!;
    desired = context.buildings.heading(
      position,
      desired,
      pool.speed[bird]!,
      species.size * 0.6,
      pool,
      bird,
      flock.roof
    );
  }
  pool.heading[bird] = steerHeading(before, desired, turnRate, step);
  const catchUp = clamp((along - LOOKAHEAD) * 0.35, -0.5, 0.7);
  const settling = pool.settle[bird]! >= 0;
  const base = flock.speed * pool.speedFactor[bird]!;
  const target = settling ? base * 0.4 : base * (1 + catchUp);
  pool.speed[bird] = approach(pool.speed[bird]!, Math.max(0.2, target), step * 2.5);
  return wrapAngle(pool.heading[bird]! - before) / step;
};

const updateHeight = (pool: BirdPool, bird: number, flock: Flock, context: BirdContext) => {
  const { step } = context;
  const settling = pool.settle[bird]! >= 0;
  let target = settling ? flock.landY : slot.height;
  if (context.buildings && !settling) {
    position.x = pool.x[bird]!;
    position.y = pool.y[bird]!;
    position.z = pool.z[bird]!;
    const radius = BIRD_SPECIES[pool.species[bird]!]!.size * 0.6;
    target = Math.max(
      target,
      context.buildings.clearance(
        position,
        pool.heading[bird]!,
        pool.speed[bird]!,
        radius,
        flock.roof
      )
    );
  }
  const climb = flock.mode === "takeoff" ? 1.6 : 1.1;
  const wanted = clamp((target - pool.y[bird]!) * 1.5, -1, climb);
  pool.verticalSpeed[bird] = approach(pool.verticalSpeed[bird]!, wanted, step * 3);
  pool.y[bird]! += pool.verticalSpeed[bird]! * step;
  const free = pool.appear[bird]! >= 1 && flock.mode !== "land" && flock.mode !== "takeoff";
  if (!free) return;
  const { field } = context;
  const [x, z] = [pool.x[bird]!, pool.z[bird]!];
  /** The coarse canopy grid can lie below a sharp peak: the exact surface is a floor too. */
  const floor = Math.max(sampleHabitat(field, field.canopy, x, z), field.surface(x, z));
  const below = floor + MIN_CLEARANCE - pool.y[bird]!;
  if (below <= 0) return;
  /** Lifted over crowns and slopes at a steep climb, never in one jump (takeoff from a crown). */
  pool.y[bird]! += Math.min(below, FLOOR_LIFT * step);
  pool.verticalSpeed[bird] = Math.max(pool.verticalSpeed[bird]!, 0);
};

/** Landing: close to the perch the bird sinks into the crown or grass and disappears. */
const updateSettle = (pool: BirdPool, bird: number, flock: Flock, step: number) => {
  if (pool.settle[bird]! < 0) {
    const distance = Math.hypot(flock.landX - pool.x[bird]!, flock.landZ - pool.z[bird]!);
    const late = flock.modeTime > LANDING_TIMEOUT;
    if (flock.mode !== "land" || (distance > SETTLE_RADIUS && !late)) return;
    pool.settle[bird] = 0;
  }
  pool.settle[bird] = Math.min(1, pool.settle[bird]! + step / SETTLE_SECONDS);
  pool.appear[bird] = 1 - smoothstep(0.35, 1, pool.settle[bird]!);
};

const updateLook = (pool: BirdPool, bird: number, turn: number, step: number) => {
  const smoothing = smoothingFactor(4, step);
  const bank = getBankAngle(turn, pool.speed[bird]!);
  pool.bank[bird]! += (bank - pool.bank[bird]!) * smoothing;
  const pitch = getPitchAngle(pool.verticalSpeed[bird]!, pool.speed[bird]!);
  pool.pitch[bird]! += (pitch - pool.pitch[bird]!) * smoothing;
};

/** Terminal roof approach: brake over the ridge, descend onto a fixed nonoverlapping slot. */
const landOnRoof = (pool: BirdPool, bird: number, flock: Flock, context: BirdContext) => {
  const roof = flock.roof!;
  const member = flock.members.indexOf(bird),
    target = getRoofSlot(roof, member, flock.size, roofSlot);
  const dx = target.x - pool.x[bird]!,
    dz = target.z - pool.z[bird]!,
    distance = Math.hypot(dx, dz);
  const before = pool.heading[bird]!;
  pool.heading[bird] = steerHeading(
    before,
    distance > 0.06 ? Math.atan2(dz, dx) : roof.heading,
    BIRD_SPECIES[flock.species]!.turnRate * 1.2,
    context.step
  );
  previous.x = pool.x[bird]!;
  previous.y = pool.y[bird]!;
  previous.z = pool.z[bird]!;
  // Vertical clearance depends on each bird's own distance, preventing low diagonal approaches.
  const height = target.y + Math.max(0, distance - 0.2) * 0.35;
  const factor = smoothingFactor(2, context.step);
  position.x = previous.x + dx * factor;
  position.z = previous.z + dz * factor;
  position.y = Math.max(target.y, approach(previous.y, height, context.step * 0.8));
  context.buildings?.move(previous, position, BIRD_SPECIES[flock.species]!.size * 0.6, roof);
  pool.x[bird] = position.x;
  pool.y[bird] = position.y;
  pool.z[bird] = position.z;
  pool.speed[bird] = Math.hypot(position.x - previous.x, position.z - previous.z) / context.step;
  pool.verticalSpeed[bird] = (position.y - previous.y) / context.step;
  if (distance < 0.06 && Math.abs(position.y - target.y) < 0.015) {
    pool.settle[bird] = Math.min(
      1,
      Math.max(0, pool.settle[bird]!) + context.step / SETTLE_SECONDS
    );
    pool.flap[bird] = approach(pool.flap[bird]!, 0, context.step * 3);
    if (pool.settle[bird] >= 1) {
      pool.x[bird] = target.x;
      pool.y[bird] = target.y;
      pool.z[bird] = target.z;
      pool.heading[bird] = roof.heading;
      pool.speed[bird] = 0;
      pool.verticalSpeed[bird] = 0;
      pool.bank[bird] = 0;
      pool.pitch[bird] = 0;
    }
  } else updateWings(pool, bird, flock, context);
  pool.appear[bird] = 1;
  updateLook(pool, bird, wrapAngle(pool.heading[bird]! - before) / context.step, context.step);
};

/** One fixed step of a bird following its flock. */
export const updateBird = (pool: BirdPool, bird: number, flock: Flock, context: BirdContext) => {
  const { step } = context;
  if (pool.settle[bird]! >= 1) return;
  if (flock.roof && flock.mode === "land") {
    landOnRoof(pool, bird, flock, context);
    return;
  }
  if (pool.delay[bird]! > 0) {
    pool.delay[bird]! -= step;
    return;
  }
  if (pool.settle[bird]! < 0)
    pool.appear[bird] = Math.min(1, pool.appear[bird]! + step / APPEAR_SECONDS);
  pool.detach[bird] = Math.max(0, pool.detach[bird]! - step);
  previous.x = pool.x[bird]!;
  previous.y = pool.y[bird]!;
  previous.z = pool.z[bird]!;
  getSlotTarget(pool, bird, flock, context.time);
  const turn = steerToSlot(pool, bird, flock, context);
  updateHeight(pool, bird, flock, context);
  updateWings(pool, bird, flock, context);
  updateSettle(pool, bird, flock, step);
  updateLook(pool, bird, turn, step);
  pool.x[bird]! += Math.cos(pool.heading[bird]!) * pool.speed[bird]! * step;
  pool.z[bird]! += Math.sin(pool.heading[bird]!) * pool.speed[bird]! * step;
  if (!context.buildings) return;
  position.x = pool.x[bird]!;
  position.y = pool.y[bird]!;
  position.z = pool.z[bird]!;
  context.buildings.move(
    previous,
    position,
    BIRD_SPECIES[pool.species[bird]!]!.size * 0.6,
    flock.roof
  );
  pool.x[bird] = position.x;
  pool.y[bird] = position.y;
  pool.z[bird] = position.z;
};
