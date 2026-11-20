import { getKnownRocks } from "../../render-common/rocks/island-rock-instances";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { BLOCKING, PROP, type WorldData } from "../world/world-data";
import { isInBridgeFootprint } from "./bridge-masonry";
import { isNearDoorLane } from "./settlement-entrance";
import { distanceToSegment } from "./settlement-geometry";
import { isNavigationClear } from "./settlement-navigation";
import type { ResourceTarget, SettlementContext, SettlementPoint } from "./settlement-types";

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
const obstacleCache = new WeakMap<WorldData, { revision: number; count: number;
  rocks: ReturnType<typeof getKnownRocks>; buckets: Map<number, Bounds[]> }>();
const fishingObstacles = (world: WorldData) => {
  const rocks = getKnownRocks(world), revision = world.buildRevision ?? 0;
  const cached = obstacleCache.get(world);
  if (cached?.revision === revision && cached.count === world.props.count && (cached.rocks === rocks || (!cached.rocks.length && !rocks.length))) return cached.buckets;
  const buckets = new Map<number, Bounds[]>();
  const insert = (bounds: Bounds) => {
    for (let z = Math.max(0, Math.floor(bounds.minZ)); z <= Math.min(world.cellsZ - 1, Math.floor(bounds.maxZ)); z++)
      for (let x = Math.max(0, Math.floor(bounds.minX)); x <= Math.min(world.cellsX - 1, Math.floor(bounds.maxX)); x++) {
        const key = z * world.cellsX + x, entries = buckets.get(key) ?? [];
        entries.push(bounds); buckets.set(key, entries);
      }
  };
  for (let index = 0; index < world.props.count; index++) {
    if (world.props.types[index] !== PROP.largeRock) continue;
    const radius = .45 + world.props.scale[index]! * .8;
    const x = world.props.x[index]!, z = world.props.z[index]!;
    insert({ minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius });
  }
  for (const rock of rocks) {
    const extentX = rock.axes.reduce((sum, axis) => sum + Math.abs(axis[0]), 0) * .5 + .12;
    const extentZ = rock.axes.reduce((sum, axis) => sum + Math.abs(axis[2]), 0) * .5 + .12;
    insert({ minX: rock.centre[0] - extentX, maxX: rock.centre[0] + extentX,
      minZ: rock.centre[2] - extentZ, maxZ: rock.centre[2] + extentZ });
  }
  obstacleCache.set(world, { revision, count: world.props.count, rocks, buckets });
  return buckets;
};

/**
 * The water shader paints shore foam until .18 deep (water-glsl shoreFoam); a cast lands past that
 * band, in open water where fish can live, never in the wet foam fringe of the beach.
 */
export const FISHING_MIN_WATER_DEPTH = .25;
/** Cast distances from the shore cell centre; longer casts reach past gentle shallow beaches. */
const FISHING_CAST_REACHES = [1.75, 2, 2.25, 2.5, 1.5];

const wetPoint = (world: WorldData, x: number, z: number) => {
  if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return null;
  if (world.blocking[Math.floor(z) * world.cellsX + Math.floor(x)] !== BLOCKING.water) return null;
  const surface = world.waterSurface ? sampleSmooth(world, world.waterSurface, x, z) : NaN;
  const y = Number.isFinite(surface) ? surface : world.seaLevel;
  if (world.waterDepth) {
    const depth = sampleSmooth(world, world.waterDepth, x, z);
    if (!Number.isFinite(depth) || depth < FISHING_MIN_WATER_DEPTH) return null;
  }
  const visibleWater = world.waterDepth || Number.isFinite(surface);
  if (visibleWater && sampleSmooth(world, world.heights, x, z) > y - FISHING_MIN_WATER_DEPTH) return null;
  const bounds = fishingObstacles(world).get(Math.floor(z) * world.cellsX + Math.floor(x)) ?? [];
  if (bounds.some(bound => x >= bound.minX && x <= bound.maxX && z >= bound.minZ && z <= bound.maxZ)) return null;
  return { x, y, z };
};

/** A paid catch still needs real, deep enough water: an editor may have filled the cast spot. */
export const isFishingCastWet = (world: WorldData, target: ResourceTarget) =>
  wetPoint(world, target.x, target.z) !== null;

/** Keep the entire foot/stance disk on visible dry ground, outside the actual rendered rocks. */
export const FISHER_SHORE_CLEARANCE = .2;
/** A small, validated dry corridor lets a returning fisher recover from a shore-side detour. */
export const FISHER_SHORE_RECOVERY_WIDTH = .85;
/** A standing fisher uses low banks; tall drops require a different activity/model. */
export const FISHER_MAX_BANK_HEIGHT = .75;
/**
 * Dry, walkable, rock free and off every bridge under the whole .2 stance disk; no footing check
 * (paths too).
 */
export const isFishingShoreStandClear = (context: SettlementContext, point: SettlementPoint,
  surface: number) => {
  const { world } = context.options;
  const rocks = fishingObstacles(world);
  const visibleSurface = Boolean(world.waterSurface || world.waterDepth);
  const standingHeight = sampleSmooth(world, world.heights, point.x, point.z);
  if (visibleSurface && standingHeight > surface + FISHER_MAX_BANK_HEIGHT) return false;
  for (let sample = -1; sample < 12; sample++) {
    const angle = sample * Math.PI / 6;
    const x = point.x + (sample < 0 ? 0 : DMath.cos(angle) * FISHER_SHORE_CLEARANCE);
    const z = point.z + (sample < 0 ? 0 : DMath.sin(angle) * FISHER_SHORE_CLEARANCE);
    if (!isNavigationClear(context, { x, z }, false, visibleSurface)) return false;
    // Never on a bridge: its deck, masonry (abutments, piers, parapets) or raised shore ramps.
    if (isInBridgeFootprint(context, { x, z })) return false;
    if (!visibleSurface && world.blocking[Math.floor(z) * world.cellsX + Math.floor(x)] === BLOCKING.water) return false;
    if (visibleSurface && sampleSmooth(world, world.heights, x, z) < surface + .01) return false;
    const bounds = rocks.get(Math.floor(z) * world.cellsX + Math.floor(x)) ?? [];
    if (bounds.some(bound => x >= bound.minX && x <= bound.maxX && z >= bound.minZ && z <= bound.maxZ))
      return false;
  }
  return true;
};

/** Distance from the stance centre to the sole edges of the planted feet (ankle to toe). */
export const FISHER_FOOT_REACH = .1;
/**
 * Owner decision 2026-10-13: only the Fisher's casting stance may stand on sloped beach sand. Facing
 * the water, the feet stand side by side across the slope (level within this roll) ...
 */
export const FISHER_MAX_STANCE_ROLL = .03;
/**
 * ... while the slope down to the water may reach this grade (27 degrees): with the body at the
 * centre height the toes and heels stay within .025 of the sand. Steeper (35-45 degree) sand
 * banks keep the Fisher at their level top edge.
 */
export const FISHER_MAX_STANCE_SLOPE = .5;
/** Feet stay above the waterline and its swash, out of the shore foam. */
export const FISHER_MIN_FEET_ABOVE_WATER = .05;

/** The planted feet neither float nor sink: level across the slope, a moderate grade towards the water. */
const isFishingStanceLevel = (world: WorldData, point: SettlementPoint,
  water: { x: number; y: number; z: number }) => {
  const heading = DMath.atan2(water.x - point.x, water.z - point.z);
  const forwardX = DMath.sin(heading) * FISHER_FOOT_REACH, forwardZ = DMath.cos(heading) * FISHER_FOOT_REACH;
  const height = (x: number, z: number) => sampleSmooth(world, world.heights, point.x + x, point.z + z);
  const centre = height(0, 0), ahead = height(forwardX, forwardZ), behind = height(-forwardX, -forwardZ);
  const left = height(forwardZ, -forwardX), right = height(-forwardZ, forwardX);
  if (Math.abs(left - right) > FISHER_MAX_STANCE_ROLL) return false;
  if (Math.abs((left + right) / 2 - centre) > FISHER_MAX_STANCE_ROLL) return false;
  if (Math.abs((ahead + behind) / 2 - centre) > FISHER_MAX_STANCE_ROLL) return false;
  if (Math.abs(ahead - behind) > 2 * FISHER_FOOT_REACH * FISHER_MAX_STANCE_SLOPE) return false;
  const visibleSurface = Boolean(world.waterSurface || world.waterDepth);
  return !visibleSurface || Math.min(ahead, left, right) >= water.y + FISHER_MIN_FEET_ABOVE_WATER;
};

/** The casting stance: a clear dry disk with planted feet facing the cast point. */
export const isFishingStanceClear = (context: SettlementContext, point: SettlementPoint,
  water: { x: number; y: number; z: number }) =>
  isFishingStanceLevel(context.options.world, point, water) &&
  isFishingShoreStandClear(context, point, water.y);

export const isFishingShoreSegmentClear = (context: SettlementContext, from: SettlementPoint,
  to: SettlementPoint, surface: number) => {
  const count = Math.max(1, Math.ceil(DMath.hypot(to.x - from.x, to.z - from.z) / .05));
  for (let index = 0; index <= count; index++) {
    const point = { x: from.x + (to.x - from.x) * index / count,
      z: from.z + (to.z - from.z) * index / count };
    if (!isFishingShoreStandClear(context, point, surface)) return false;
  }
  return true;
};

/** This permission belongs only to the final selected Fisher shore segment, in both directions. */
export const isFishingShoreStep = (context: SettlementContext,
  actor: { job?: string; target?: ResourceTarget }, point: SettlementPoint) => {
  const shore = actor.job === "Fisher" && actor.target?.kind === "fish" ? actor.target.approach : undefined;
  const entry = shore?.shoreEntry;
  if (!shore || !entry || shore.waterY === undefined) return false;
  if (distanceToSegment(point, entry, shore) > FISHER_SHORE_RECOVERY_WIDTH) return false;
  return isFishingShoreStandClear(context, point, shore.waterY);
};

const shorelineApproach = (context: SettlementContext, center: SettlementPoint,
  water: { x: number; y: number; z: number }) => {
  const distance = DMath.hypot(water.x - center.x, water.z - center.z);
  const dx = (water.x - center.x) / distance, dz = (water.z - center.z) / distance;
  let best: SettlementPoint | null = null, entry: SettlementPoint | null = null, closest = Infinity;
  const centerClear = isFishingStanceClear(context, center, water);
  for (let step = Math.floor(distance / .05); step >= -30; step--)
    for (const sideways of [0, -.1, .1, -.2, .2]) {
      const point = { x: center.x + dx * step * .05 - dz * sideways,
        z: center.z + dz * step * .05 + dx * sideways };
      const gap = DMath.hypot(water.x - point.x, water.z - point.z);
      if (gap >= closest || !isFishingStanceClear(context, point, water)) continue;
      let start: SettlementPoint | null = center;
      if (!centerClear) start = isNavigationClear(context, point) ? point : null;
      if (!start || !isFishingShoreSegmentClear(context, start, point, water.y)) continue;
      best = point; entry = start; closest = gap;
    }
  if(!best || !entry)return null;
  // Refine against the interpolated visible shoreline rather than stopping at a .05-cell grid.
  // Small side steps follow irregular banks while the entire straight beach leg stays dry.
  for(const stride of [.05,.01,.002])for(let pass=0;pass<12;pass++) {
    let next: SettlementPoint|null=null,nextGap=closest;
    const heading=DMath.atan2(water.x-best.x,water.z-best.z);
    for(const turn of [0,-Math.PI/6,Math.PI/6,-Math.PI/3,Math.PI/3]) {
      const point: SettlementPoint={x:best.x+DMath.sin(heading+turn)*stride,z:best.z+DMath.cos(heading+turn)*stride};
      const gap=DMath.hypot(water.x-point.x,water.z-point.z);
      if(gap>=nextGap || !isFishingStanceClear(context,point,water) ||
        !isFishingShoreSegmentClear(context,entry,point,water.y))continue;
      next=point;nextGap=gap;
    }
    if(!next)break;
    best=next;closest=nextGap;
  }
  return { ...best, shoreEntry: entry, waterY: water.y };
};

/**
 * The Fisher stands at the shore: the line crosses at most this much dry bank or beach before it
 * reaches visible water. Level stances on sloped beaches can sit about a cell above the waterline.
 */
export const FISHER_MAX_DRY_CAST = 1.5;

const isVisiblyWet = (world: WorldData, x: number, z: number, surface: number) => {
  if (world.waterSurface || world.waterDepth) return sampleSmooth(world, world.heights, x, z) < surface;
  return world.blocking[Math.floor(z) * world.cellsX + Math.floor(x)] === BLOCKING.water;
};

/** Length of dry ground under the line from the stance towards the cast point. */
const dryCastLength = (world: WorldData, stance: SettlementPoint,
  water: { x: number; y: number; z: number }) => {
  const distance = DMath.hypot(water.x - stance.x, water.z - stance.z);
  for (let travelled = 0; travelled < distance; travelled += .05) {
    const t = travelled / distance;
    const x = stance.x + (water.x - stance.x) * t, z = stance.z + (water.z - stance.z) * t;
    if (isVisiblyWet(world, x, z, water.y)) return travelled;
  }
  return distance;
};

/** A casting Fisher keeps clear of every door lane (body radius plus a passing settler). */
export const FISHER_DOOR_LANE_CLEARANCE = .45;
const blocksDoorLane = (context: SettlementContext, point: SettlementPoint) =>
  context.buildings.some(building => isNearDoorLane(building, point, FISHER_DOOR_LANE_CLEARANCE));

const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

/** Resource providers may offer water or a shore cell; the catch always belongs in real water. */
export const fishingSites = (context: SettlementContext, target: ResourceTarget): ResourceTarget[] => {
  const { world } = context.options;
  const x = Math.floor(target.x), z = Math.floor(target.z);
  if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return [];
  const water = world.blocking[z * world.cellsX + x] === BLOCKING.water;
  return neighbors.flatMap(([dx, dz]) => {
    const nx = x + dx, nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ) return [];
    const adjacentWater = world.blocking[nz * world.cellsX + nx] === BLOCKING.water;
    if (water === adjacentWater) return [];
    const approach = { x: (water ? nx : x) + .5, z: (water ? nz : z) + .5 };
    if (!isNavigationClear(context, approach)) return [];
    const outwardX = water ? -dx : dx, outwardZ = water ? -dz : dz;
    for (const reach of FISHING_CAST_REACHES) {
      for (const sideways of [0, -.4, .4]) {
        const point = wetPoint(world, approach.x + outwardX * reach - outwardZ * sideways,
          approach.z + outwardZ * reach + outwardX * sideways);
        if (!point) continue;
        const shore = shorelineApproach(context, approach, point);
        if (!shore || dryCastLength(world, shore, point) > FISHER_MAX_DRY_CAST) continue;
        if (blocksDoorLane(context, shore)) continue;
        return [{ ...target, ...point, approach: shore }];
      }
    }
    return [];
  });
};
