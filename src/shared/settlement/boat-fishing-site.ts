import { FISHING_SKIFF_BEAM, FISHING_SKIFF_LENGTH } from "../../render-common/ships/fishing-skiff-dimensions";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { BLOCKING, type WorldData } from "../world/world-data";
import { findBoatNetPoints, nearestClearCell } from "./boat-fishing-nets";
import {
  type BoatWaterClasses, boatWaterDepth, type BoatWaterKind, boatWaterKindAt, boatWaterlineAlong,
  boatWaterSurface, classifyBoatWater, isSkiffWaterClear
} from "./boat-fishing-water";
import { isInBridgeFootprint } from "./bridge-masonry";
import {
  BOAT_BOW_ON_SAND, BOAT_ENTRY_FARTHEST, BOAT_ENTRY_NEAREST, BOAT_ENTRY_STEP, BOAT_FLOAT_DEPTH, BOAT_FLOAT_REACH,
  BOAT_FOOTPRINT_STEP, BOAT_FOUR_NEIGHBOURS, BOAT_MAX_BANK_HEIGHT, BOAT_MAX_LAUNCH_ROLL, BOAT_ROAD_MARGIN,
  BOAT_SITE_SLOTS, BOAT_SLOT_EVALUATIONS, BOAT_SLOT_PATH_ATTEMPTS, BOAT_SLOT_SPACING, BOAT_STANCE_FARTHEST,
  BOAT_STANCE_NEAREST, BOAT_STANCE_STEP
} from "./constants";
import { roadBaseWidth, type RoadSegment } from "./road-types";
import { isNearDoorLane } from "./settlement-entrance";
import { FISHER_DOOR_LANE_CLEARANCE, isFishingShoreSegmentClear, isFishingShoreStandClear }
  from "./settlement-fishing";
import { distanceToSegment } from "./settlement-geometry";
import { isNavigationClear } from "./settlement-navigation";
import { groundPath } from "./settlement-paths";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { buildingAreaRange } from "./settlement-work-ranges";

/**
 * Where a Fishery's skiff is lowered, parked and beached. `x`/`z`/`shoreEntry`/`waterY` form a
 * `groundPath` shore approach (like a rod stance); `launch` is where the floating skiff starts rowing.
 */
export interface BoatLaunchSlot {
  launch: SettlementPoint;
  shoreEntry: SettlementPoint;
  waterY: number;
  x: number;
  /** Heading from the sand into the water. */
  yaw: number;
  z: number;
}

/** Cached boat validation of one Fishery for one work radius (FISHER-BOAT §1.2). */
export type BoatFishingSite =
  | { ok: false; radius: number }
  | { nets: SettlementPoint[]; ok: true; radius: number; slots: BoatLaunchSlot[]; water: BoatWaterKind };

/** Slots and nets other fisheries already hold, so two fisheries never share one. */
export interface BoatSiteReservations {
  nets: readonly SettlementPoint[];
  slots: readonly SettlementPoint[];
}

interface ShoreCandidate {
  cell: number;
  directionX: number;
  directionZ: number;
  distance: number;
}

/** The Fishery's adjustable work circle: its shore search uses the same centre and radius. */
export const fisheryWorkRange = (building: SettlementBuilding) => buildingAreaRange(building);

const shoreCandidates = (
  world: WorldData, classes: BoatWaterClasses, centre: SettlementPoint, radius: number
) => {
  const candidates: ShoreCandidate[] = [];
  const minX = Math.max(0, Math.floor(centre.x - radius));
  const maxX = Math.min(world.cellsX - 1, Math.ceil(centre.x + radius));
  const minZ = Math.max(0, Math.floor(centre.z - radius));
  const maxZ = Math.min(world.cellsZ - 1, Math.ceil(centre.z + radius));
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    const cell = z * world.cellsX + x;
    if (world.blocking[cell] === BLOCKING.water) continue;
    const distance = DMath.hypot(x + .5 - centre.x, z + .5 - centre.z);
    if (distance > radius) continue;
    for (const [directionX, directionZ] of BOAT_FOUR_NEIGHBOURS)
      if (boatWaterKindAt(world, classes, x + directionX, z + directionZ))
        candidates.push({ cell, directionX, directionZ, distance });
  }
  return candidates.sort((a, b) => a.distance - b.distance || a.cell - b.cell);
};

const height = (world: WorldData, point: SettlementPoint) => sampleSmooth(world, world.heights, point.x, point.z);
const along = (point: SettlementPoint, candidate: ShoreCandidate, forward: number, side = 0) => ({
  x: point.x + candidate.directionX * forward - candidate.directionZ * side,
  z: point.z + candidate.directionZ * forward + candidate.directionX * side
});

const isHullPointClear = (context: SettlementContext, point: SettlementPoint, roads: readonly RoadSegment[]) => {
  const { world } = context.options;
  if (point.x < 0 || point.z < 0 || point.x >= world.cellsX || point.z >= world.cellsZ) return false;
  if (context.occupied[Math.floor(point.z) * world.cellsX + Math.floor(point.x)]) return false;
  if (isInBridgeFootprint(context, point)) return false;
  const onRoad = roads.some(road =>
    distanceToSegment(point, road.start, road.end) <= roadBaseWidth(road) / 2 + BOAT_ROAD_MARGIN);
  if (onRoad) return false;
  return !context.buildings.some(building => isNearDoorLane(building, point, FISHER_DOOR_LANE_CLEARANCE));
};

/** Off roads, bridges, door lanes and building plots under the whole parked hull (bow at the waterline). */
const isFootprintClear = (
  context: SettlementContext, waterline: SettlementPoint, candidate: ShoreCandidate, roads: readonly RoadSegment[]
) => {
  const sides = [-FISHING_SKIFF_BEAM / 2, 0, FISHING_SKIFF_BEAM / 2];
  const sternReach = FISHING_SKIFF_LENGTH - BOAT_BOW_ON_SAND;
  for (let forward = -BOAT_BOW_ON_SAND; forward <= sternReach; forward += BOAT_FOOTPRINT_STEP)
    for (const side of sides)
      if (!isHullPointClear(context, along(waterline, candidate, forward, side), roads)) return false;
  return true;
};

/** The skiff floats one tile out, in skiff-clear water of the same component. */
const floatsAhead = (
  world: WorldData, classes: BoatWaterClasses, waterline: SettlementPoint, candidate: ShoreCandidate
) => {
  for (let reach = BOAT_FLOAT_REACH; reach <= BOAT_FLOAT_REACH + 2; reach += .25) {
    const float = along(waterline, candidate, reach);
    if (!boatWaterKindAt(world, classes, float.x, float.z)) continue;
    if (boatWaterDepth(world, float.x, float.z) < BOAT_FLOAT_DEPTH) continue;
    if (!classes.clear[Math.floor(float.z) * world.cellsX + Math.floor(float.x)] || !isSkiffWaterClear(world, float.x, float.z)) continue;
    return nearestClearCell(world, classes, float) < 0 ? null : float;
  }
  return null;
};

/** A low, level beach: no cliff and no side slope under the hull. */
const isLowLevelBeach = (world: WorldData, stance: SettlementPoint, candidate: ShoreCandidate, surface: number) => {
  if (height(world, stance) - surface > BOAT_MAX_BANK_HEIGHT) return false;
  const left = along(stance, candidate, 0, -FISHING_SKIFF_BEAM / 2);
  const right = along(stance, candidate, 0, FISHING_SKIFF_BEAM / 2);
  return Math.abs(height(world, left) - height(world, right)) <= BOAT_MAX_LAUNCH_ROLL;
};

const walkingEntry = (
  context: SettlementContext, stance: SettlementPoint, candidate: ShoreCandidate, surface: number
) => {
  for (let step = BOAT_ENTRY_NEAREST; step <= BOAT_ENTRY_FARTHEST; step += BOAT_ENTRY_STEP) {
    const entry = along(stance, candidate, -step);
    if (isNavigationClear(context, entry) && isFishingShoreSegmentClear(context, entry, stance, surface)) return entry;
  }
  return null;
};

/** The closest dry, level stand behind the visible waterline, so the fisher launches at the bow. */
const closestStance = (
  context: SettlementContext, shore: SettlementPoint, candidate: ShoreCandidate, surface: number
) => {
  const { world } = context.options;
  const steps = Math.round((BOAT_STANCE_FARTHEST - BOAT_STANCE_NEAREST) / BOAT_STANCE_STEP);
  for (let index = 0; index <= steps; index++) {
    const stance = along(shore, candidate, -(BOAT_STANCE_NEAREST + index * BOAT_STANCE_STEP));
    if (isLowLevelBeach(world, stance, candidate, surface) && isFishingShoreStandClear(context, stance, surface))
      return stance;
  }
  return null;
};

const evaluateSlot = (
  context: SettlementContext, classes: BoatWaterClasses, candidate: ShoreCandidate, roads: readonly RoadSegment[]
): BoatLaunchSlot | null => {
  const { world } = context.options;
  const cellCentre = { x: candidate.cell % world.cellsX + .5, z: Math.floor(candidate.cell / world.cellsX) + .5 };
  const waterline = along(cellCentre, candidate, .5);
  const surface = boatWaterSurface(world, waterline.x, waterline.z);
  const shore = boatWaterlineAlong(world, cellCentre, candidate.directionX, candidate.directionZ, surface);
  if (!shore) return null;
  const launch = floatsAhead(world, classes, shore, candidate);
  if (!launch) return null;
  const stance = closestStance(context, shore, candidate, surface);
  if (!stance) return null;
  if (!isFootprintClear(context, shore, candidate, roads)) return null;
  const shoreEntry = walkingEntry(context, stance, candidate, surface);
  if (!shoreEntry) return null;
  const yaw = DMath.atan2(candidate.directionX, candidate.directionZ);
  return { launch, shoreEntry, waterY: surface, x: stance.x, yaw, z: stance.z };
};

const nearbyRoads = (context: SettlementContext, centre: SettlementPoint, radius: number) => {
  const reach = radius + FISHING_SKIFF_LENGTH;
  return (context.options.roads.segments?.() ?? []).filter(road =>
    distanceToSegment(centre, road.start, road.end) <= reach);
};

const isSpaced = (point: SettlementPoint, others: readonly SettlementPoint[]) =>
  others.every(other => DMath.hypot(other.x - point.x, other.z - point.z) >= BOAT_SLOT_SPACING);

const findLaunchSlots = (
  context: SettlementContext, classes: BoatWaterClasses, building: SettlementBuilding,
  range: { center: SettlementPoint; radius: number }, reserved: readonly SettlementPoint[]
) => {
  const roads = nearbyRoads(context, range.center, range.radius);
  const slots: BoatLaunchSlot[] = [];
  const candidates = shoreCandidates(context.options.world, classes, range.center, range.radius);
  let pathAttempts = 0;
  for (const candidate of candidates.slice(0, BOAT_SLOT_EVALUATIONS)) {
    if (slots.length >= BOAT_SITE_SLOTS || pathAttempts >= BOAT_SLOT_PATH_ATTEMPTS) break;
    const slot = evaluateSlot(context, classes, candidate, roads);
    if (!slot || !isSpaced(slot, slots) || !isSpaced(slot, reserved)) continue;
    pathAttempts++;
    if (groundPath(context, building.access, slot, building.uid)) slots.push(slot);
  }
  return slots;
};

/**
 * Validates boat fishing for a Fishery (FISHER-BOAT §1.2): a low sea or lake beach within its work
 * radius (never a river bank), reachable on foot, with deep open water to row to. Deterministic.
 */
export const findBoatFishingSite = (
  context: SettlementContext, building: SettlementBuilding, reserved: BoatSiteReservations = { nets: [], slots: [] }
): BoatFishingSite => {
  const range = fisheryWorkRange(building);
  if (!range) return { ok: false, radius: 0 };
  const classes = classifyBoatWater(context.options.world);
  const slots = findLaunchSlots(context, classes, building, range, reserved.slots);
  const first = slots[0];
  if (!first) return { ok: false, radius: range.radius };
  const nets = findBoatNetPoints(context, classes, first.launch, reserved.nets);
  const water = boatWaterKindAt(context.options.world, classes, first.launch.x, first.launch.z);
  if (!nets.length || !water) return { ok: false, radius: range.radius };
  return { nets, ok: true, radius: range.radius, slots, water };
};
