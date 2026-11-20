import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { BLOCKING, type WorldData } from "../world/world-data";
import { catapultImpactAttacker, type CatapultImpactTarget, catapultMaximumHp } from "./military-catapult-impact";
import type { MilitaryArrow } from "./military-projectiles";
import type { MilitarySpatialGrid } from "./military-spatial-grid";
import { navigationPropRadius, someObstacleNear } from "./navigation-prop-geometry";
import { isPublicBuildingPointClear } from "./settlement-building-navigation";
import type { CombatHit } from "./settlement-combat-core";
import type { SettlementSoldier } from "./settlement-military";
import type { SettlementContext } from "./settlement-types";

/**
 * CAT-6 marble roll (owner 2026-11-07/08). After its direct hit a marble shot rolls on along its
 * flight bearing: constant rolling friction plus the terrain slope along the bearing decide how far.
 * Flat ground: v² / (2 × friction) = 4 tiles. Downhill rolls further (capped), uphill shorter.
 */
export const MARBLE_ROLL_SPEED = 4;
export const MARBLE_ROLL_FRICTION = 2;
/** Deceleration per unit of height gradient along the bearing (game-tuned, not a rigid sphere). */
export const MARBLE_ROLL_SLOPE = 2.2;
export const MARBLE_ROLL_MAXIMUM_DISTANCE = 6;
/** At most this many units take roll damage; the first contact at full speed takes 50 %. */
export const MARBLE_ROLL_HITS = 3;
export const MARBLE_ROLL_DAMAGE = .5;
/** Ball radius plus a body radius, measured on the ground plane. */
const ROLL_CONTACT = .3;
/** A body more than this above or below the ball (a garrison figure) is out of reach. */
const ROLL_CONTACT_HEIGHT = .6;
/** A rise or drop steeper than this per tile is a cliff edge: the ball stops before it. */
const ROLL_CLIFF_GRADIENT = 1.2;
const ROLL_SAMPLE = .1;
const SLOPE_PROBE = .2;
const BALL_RADIUS = .12;
const WORLD_MARGIN = .12;

export interface CatapultRoll {
  /** Tiles travelled so far; the renderer turns the ball by distance / radius. */
  distance: number;
  /** Unit bearing on the ground plane, fixed at landing. */
  dx: number; dz: number;
  /** Roll damage dealt so far (the direct-hit victims are only in `touched`). */
  hits: number;
  /** Tiles per second; 0 once the ball has stopped. */
  speed: number;
  /** Every unit already struck by this shot (direct hit and roll): never struck twice. */
  touched: number[];
}

export interface CatapultRollScene {
  hit: CombatHit;
  soldiers: ReadonlyMap<number, SettlementSoldier>;
  targets: MilitarySpatialGrid<CatapultImpactTarget>;
}

/** A landed marble shot starts to roll along the horizontal direction of its flight. */
export const startCatapultRoll = (arrow: MilitaryArrow) => {
  const length = DMath.hypot(arrow.vx, arrow.vz);
  if (length < 1e-9) { arrow.boulder!.restAge = 0; return; }
  arrow.boulder!.roll = { distance: 0, dx: arrow.vx / length, dz: arrow.vz / length, hits: 0,
    speed: MARBLE_ROLL_SPEED, touched: [] };
};

export const isRollingBoulder = (arrow: MilitaryArrow) =>
  arrow.boulder?.roll !== undefined && arrow.boulder.restAge === undefined;

const groundAt = (world: WorldData, x: number, z: number) => sampleSmooth(world, world.heights, x, z);

const slopeAlong = (world: WorldData, x: number, z: number, roll: CatapultRoll) =>
  (groundAt(world, x + roll.dx * SLOPE_PROBE, z + roll.dz * SLOPE_PROBE) -
    groundAt(world, x - roll.dx * SLOPE_PROBE, z - roll.dz * SLOPE_PROBE)) / (2 * SLOPE_PROBE);

const outsideWorld = (world: WorldData, x: number, z: number) =>
  x < WORLD_MARGIN || z < WORLD_MARGIN || x >= world.cellsX - WORLD_MARGIN || z >= world.cellsZ - WORLD_MARGIN;

const blockedCell = (world: WorldData, x: number, z: number) => {
  const blocking = world.blocking[Math.floor(z) * world.cellsX + Math.floor(x)];
  return blocking === BLOCKING.water || blocking === BLOCKING.cliff;
};

const hitsTrunkOrRock = (world: WorldData, x: number, z: number) =>
  someObstacleNear(world, Math.floor(x), Math.floor(z), 2, prop =>
    DMath.hypot(x - world.props.x[prop]!, z - world.props.z[prop]!) < navigationPropRadius(world, prop) + BALL_RADIUS);

/**
 * Water, cliffs, the world edge, trunks and large rocks stop the ball before them; so do buildings at
 * their real walls, stock and posts: the same national navigation outline the workers walk around
 * (construction sites at their foundation, camps and courtyards at their occupancy mask).
 */
const rollBlocked = (context: SettlementContext, from: number, x: number, z: number, step: number) => {
  const world = context.options.world;
  if (outsideWorld(world, x, z) || blockedCell(world, x, z)) return true;
  if (step > 1e-6 && Math.abs(groundAt(world, x, z) - from) / step > ROLL_CLIFF_GRADIENT) return true;
  return hitsTrunkOrRock(world, x, z) || !isPublicBuildingPointClear(context, { x, z }, BALL_RADIUS);
};

/** Distance and end speed of one sub-step under a constant deceleration (negative: speeding up). */
const advanceSpeed = (speed: number, deceleration: number, seconds: number) => {
  if (deceleration > 0 && speed <= deceleration * seconds)
    return { speed: 0, travel: speed * speed / (2 * deceleration) };
  return { speed: speed - deceleration * seconds, travel: speed * seconds - .5 * deceleration * seconds * seconds };
};

/** Roll damage falls linearly with speed from 50 % at the landing speed to 0 at rest. */
export const catapultRollDamage = (speed: number) =>
  MARBLE_ROLL_DAMAGE * Math.max(0, Math.min(1, speed / MARBLE_ROLL_SPEED));

const strikeBodies = (context: SettlementContext, arrow: MilitaryArrow, scene: CatapultRollScene) => {
  const roll = arrow.boulder!.roll!, fraction = catapultRollDamage(roll.speed);
  if (roll.hits >= MARBLE_ROLL_HITS || fraction <= 0) return;
  scene.targets.forEachWithin(arrow.x, arrow.z, ROLL_CONTACT, body => body.faction !== arrow.faction &&
    Math.abs(body.y - arrow.y) <= ROLL_CONTACT_HEIGHT && !roll.touched.includes(body.id) &&
    (scene.soldiers.get(body.id)?.combat?.hp ?? 0) > 0, body => {
    const defender = scene.soldiers.get(body.id);
    if (roll.hits >= MARBLE_ROLL_HITS || !defender?.combat) return;
    if (DMath.hypot(body.x - arrow.x, body.z - arrow.z) > ROLL_CONTACT) return;
    roll.touched.push(body.id); roll.hits += 1;
    scene.hit(catapultImpactAttacker(arrow, scene.soldiers), defender, true, false, 1, false, false,
      catapultMaximumHp(context, defender) * fraction);
  });
};

const stopRoll = (arrow: MilitaryArrow) => {
  arrow.boulder!.roll!.speed = 0; arrow.boulder!.restAge = 0;
};

/** One simulation tick of a rolling marble shot; deterministic (DMath, no random draws). */
export const rollCatapultBoulder = (context: SettlementContext, arrow: MilitaryArrow, dt: number,
  scene: CatapultRollScene) => {
  const roll = arrow.boulder!.roll!, world = context.options.world;
  const steps = Math.max(1, Math.ceil(roll.speed * dt / ROLL_SAMPLE));
  const seconds = dt / steps;
  for (let step = 0; step < steps && roll.speed > 0; step++) {
    const deceleration = MARBLE_ROLL_FRICTION + MARBLE_ROLL_SLOPE * slopeAlong(world, arrow.x, arrow.z, roll);
    const next = advanceSpeed(roll.speed, deceleration, seconds);
    const travel = Math.min(next.travel, MARBLE_ROLL_MAXIMUM_DISTANCE - roll.distance);
    const x = arrow.x + roll.dx * travel, z = arrow.z + roll.dz * travel;
    if (rollBlocked(context, arrow.y, x, z, travel)) { stopRoll(arrow); return; }
    arrow.x = x; arrow.z = z; arrow.y = groundAt(world, x, z);
    roll.distance += travel; roll.speed = next.speed;
    strikeBodies(context, arrow, scene);
    if (roll.distance >= MARBLE_ROLL_MAXIMUM_DISTANCE - 1e-9) roll.speed = 0;
  }
  if (roll.speed <= 0) stopRoll(arrow);
};

/** Saved roll state (save validation). */
export const catapultRollError = (roll: unknown) => {
  if (roll === undefined) return false;
  const value = roll as CatapultRoll;
  if (!value || typeof value !== "object") return true;
  if (![value.distance, value.dx, value.dz, value.speed].every(Number.isFinite)) return true;
  if (Math.abs(DMath.hypot(value.dx, value.dz) - 1) > 1e-6) return true;
  if (value.distance < 0 || value.distance > MARBLE_ROLL_MAXIMUM_DISTANCE + 1e-9) return true;
  if (value.speed < 0 || value.speed > 64) return true;
  if (!Number.isInteger(value.hits) || value.hits < 0 || value.hits > MARBLE_ROLL_HITS) return true;
  return !Array.isArray(value.touched) || !value.touched.every(id => Number.isSafeInteger(id) && id >= 0);
};
