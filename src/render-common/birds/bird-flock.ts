import { clamp, type Noise2 } from "../../shared/world/noise";
import type { Random } from "../../shared/world/rng";
import type { BirdBuildingAvoidance } from "./bird-building-avoidance";
import {
  approach,
  getLandingProfile,
  getMeanderHeading,
  getSteerTurn,
  getTakeoffProfile,
  smoothingFactor,
  steerHeading,
  wrapAngle
} from "./bird-flight";
import { getPerchHeight, type HabitatField,sampleHabitat, scoreHabitat } from "./bird-habitat";
import type { BirdRoofPerch } from "./bird-roof-perches";
import { BIRD_SPECIES, type BirdSpecies } from "./bird-species";
import { getViewDistance, type ViewRegion } from "./bird-view";

export const MAX_FLOCK_SIZE = 7;
export const TAKEOFF_SECONDS = 2.2;
const SCATTER_SECONDS = 2.6;
const PROBE_DISTANCE = 5;
const PROBE_ANGLE = 0.55;
/** Beyond this share of the view the flock is pulled back in (unless it is leaving). */
const LEASH_START = 0.7;
const CLIMB_RATE = 1.1;
const SINK_RATE = 0.8;
const FOREST_CLEARANCE = 1.2;
const previousPosition = { x: 0, y: 0, z: 0 };

export type FlockMode = "takeoff" | "wander" | "circle" | "land" | "rest" | "scatter";

/** The invisible leader point of a flock (or a lone bird) that wanders; birds follow it. */
export interface Flock {
  active: boolean;
  age: number;
  circleRadius: number;
  circleSign: number;
  /** Mean direction the flock meanders around; it drifts and shifts now and then. */
  course: number;
  /** Seconds until the next gentle change of course. */
  courseTimer: number;
  /** Cruise height above the canopy / ground / water for this flight. */
  cruise: number;
  /** Seconds of flight left before the flock looks for a perch or leaves. */
  flightLeft: number;
  heading: number;
  roof: BirdRoofPerch | null;
  landDistance: number;
  landX: number;
  landY: number;
  landZ: number;
  /** Leaving flocks are no longer held in view and get recycled once they are out of it. */
  leaving: boolean;
  members: Int16Array;
  mode: FlockMode;
  modeLength: number;
  modeTime: number;
  noiseSeed: number;
  outOfView: number;
  size: number;
  species: number;
  speed: number;
  splitTimer: number;
  /** Turn rate of the last step (radians per second). */
  turn: number;
  x: number;
  y: number;
  z: number;
}

/** World services a flock step needs. */
export interface FlockContext {
  buildings?: BirdBuildingAvoidance;
  /** 0 (night, storm: flocks head home) .. 1. */
  activity: number;
  field: HabitatField;
  noise: Noise2;
  random: Random;
  region: ViewRegion;
  step: number;
  time: number;
}

export const createFlock = (): Flock => ({
  active: false,
  age: 0,
  circleRadius: 3,
  circleSign: 1,
  course: 0,
  courseTimer: 0,
  cruise: 1,
  flightLeft: 0,
  heading: 0,
  roof: null,
  landDistance: 1,
  landX: 0,
  landY: 0,
  landZ: 0,
  leaving: false,
  members: new Int16Array(MAX_FLOCK_SIZE),
  mode: "wander",
  modeLength: 0,
  modeTime: 0,
  noiseSeed: 0,
  outOfView: 0,
  size: 0,
  species: 0,
  speed: 0,
  splitTimer: 0,
  turn: 0,
  x: 0,
  y: 0,
  z: 0
});

export const setFlockMode = (flock: Flock, mode: FlockMode, length: number) => {
  flock.mode = mode;
  flock.modeTime = 0;
  flock.modeLength = length;
};

/**
 * Height the flock wants above the spot: canopy or surface plus cruise, gently undulating, with
 * extra clearance over forests (crowns in front would hide birds skimming the canopy).
 */
const getCruiseTarget = (flock: Flock, context: FlockContext) => {
  const { field } = context;
  const top = sampleHabitat(field, field.canopy, flock.x, flock.z);
  const forest = sampleHabitat(field, field.forest, flock.x, flock.z);
  const swell = context.noise(context.time * 0.17, flock.noiseSeed + 40) * 0.35;
  const height = top + flock.cruise * (1 + swell) + forest * FOREST_CLEARANCE;
  return flock.roof ? Math.max(height, flock.roof.y + flock.cruise) : height;
};

const probe = (flock: Flock, species: BirdSpecies, field: HabitatField, angle: number) =>
  scoreHabitat(
    field,
    species.habitat,
    flock.x + Math.cos(flock.heading + angle) * PROBE_DISTANCE,
    flock.z + Math.sin(flock.heading + angle) * PROBE_DISTANCE
  );

/**
 * Course drift (radians per second) towards the better habitat side: faint while the way ahead
 * is fine (no circling over one good patch), firm when it leads out of the habitat.
 */
const getHabitatDrift = (flock: Flock, species: BirdSpecies, field: HabitatField) => {
  const left = probe(flock, species, field, -PROBE_ANGLE);
  const right = probe(flock, species, field, PROBE_ANGLE);
  const ahead = probe(flock, species, field, 0);
  if (ahead >= 0.05) return clamp((right - left) * 0.25, -0.12, 0.12);
  return right >= left ? 0.5 : -0.5;
};

/** Gentle pull back towards the view centre once the flock nears the edge. */
const getLeashBias = (flock: Flock, region: ViewRegion) => {
  if (flock.leaving) return 0;
  const distance = getViewDistance(region, flock.x, flock.z);
  if (distance < LEASH_START) return 0;
  const home = Math.atan2(region.centerZ - flock.z, region.centerX - flock.x);
  const strength = Math.min(1, (distance - LEASH_START) * 2.5);
  return clamp(wrapAngle(home - flock.heading), -1, 1) * strength;
};

const moveForward = (flock: Flock, step: number) => {
  flock.x += Math.cos(flock.heading) * flock.speed * step;
  flock.z += Math.sin(flock.heading) * flock.speed * step;
};

/** Steers along the meander around the course, at most `turnRate`. */
const meander = (flock: Flock, context: FlockContext, turnRate: number, weave: number) => {
  const slow = context.noise(context.time * 0.09, flock.noiseSeed);
  const fast = context.noise(context.time * 0.37, flock.noiseSeed + 20) * weave;
  const desired = getMeanderHeading(flock.course, slow, fast);
  applyTurn(flock, getSteerTurn(flock.heading, desired, turnRate), context.step);
};

/** The course drifts with habitat and the view leash; now and then it shifts by up to 70 deg. */
const updateCourse = (flock: Flock, species: BirdSpecies, context: FlockContext) => {
  const { random, step } = context;
  const drift =
    getHabitatDrift(flock, species, context.field) + getLeashBias(flock, context.region) * 0.4;
  flock.course = wrapAngle(flock.course + drift * step);
  flock.courseTimer -= step;
  if (flock.courseTimer > 0) return;
  flock.courseTimer = 6 + random() * 10;
  flock.course = wrapAngle(flock.course + (random() - 0.5) * 2.4);
};

const applyTurn = (flock: Flock, turn: number, step: number) => {
  const smoothed = flock.turn + (turn - flock.turn) * smoothingFactor(2.5, step);
  flock.turn = smoothed;
  flock.heading = wrapAngle(flock.heading + smoothed * step);
};

const climbTowards = (flock: Flock, target: number, climb: number, step: number) => {
  const rate = target > flock.y ? CLIMB_RATE * climb : SINK_RATE;
  flock.y = approach(flock.y, target, rate * step);
};

/** A spot ahead to land in: a crown top or open grass, whichever the species perches on. */
export const findPerch = (flock: Flock, context: FlockContext) => {
  const species = BIRD_SPECIES[flock.species]!;
  const { field, random } = context;
  const roof =
    species.size <= 0.8 && species.perches !== "ground"
      ? context.buildings?.roofNear(flock, species.size, flock.size)
      : null;
  if (roof) return { distance: Math.hypot(roof.x - flock.x, roof.z - flock.z), ...roof, roof };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const angle = flock.heading + (random() - 0.5) * 1.2;
    const distance = 5 + random() * 6;
    const x = flock.x + Math.cos(angle) * distance;
    const z = flock.z + Math.sin(angle) * distance;
    if (scoreHabitat(field, species.habitat, x, z) < 0.1) continue;
    const y = getPerchHeight(field, species, x, z);
    if (
      y !== null &&
      context.buildings &&
      !context.buildings.clear({ x, y, z }, species.size * 0.6 + 1.3)
    )
      continue;
    if (y !== null) return { distance, x, y, z, roof: null };
  }
  return null;
};

/** Flight time is up: land if a perch is ahead, otherwise drift out of view. */
const endFlight = (flock: Flock, context: FlockContext) => {
  const species = BIRD_SPECIES[flock.species]!;
  const perch = species.perches === "none" ? null : findPerch(flock, context);
  if (!perch) {
    flock.leaving = true;
    flock.flightLeft = Infinity;
    return;
  }
  flock.roof = perch.roof;
  flock.landX = perch.x;
  flock.landY = perch.y;
  flock.landZ = perch.z;
  flock.landDistance = perch.distance;
  setFlockMode(flock, "land", Infinity);
};

/** Brief circling above a forest: 0.8 to 1.3 loops with a breathing radius, then wandering on. */
const maybeStartCircle = (flock: Flock, species: BirdSpecies, context: FlockContext) => {
  if (species.circling <= 0 || flock.modeTime < 4) return;
  const forest = sampleHabitat(context.field, context.field.forest, flock.x, flock.z);
  if (forest < 0.5 || context.random() > species.circling * context.step * 0.06) return;
  flock.circleRadius = 2.2 + context.random() * 2.2;
  flock.circleSign = context.random() < 0.5 ? -1 : 1;
  const loops = 0.8 + context.random() * 0.5;
  setFlockMode(flock, "circle", (loops * Math.PI * 2 * flock.circleRadius) / flock.speed);
};

const updateWander = (flock: Flock, species: BirdSpecies, context: FlockContext) => {
  const { step } = context;
  updateCourse(flock, species, context);
  meander(flock, context, species.turnRate * 0.6, 1);
  const speedNoise = context.noise(context.time * 0.07, flock.noiseSeed + 90) * 0.12;
  flock.speed = approach(flock.speed, species.speed * (1 + speedNoise), step * 1.2);
  climbTowards(flock, getCruiseTarget(flock, context), 1, step);
  if (context.activity < 0.2) flock.flightLeft = Math.min(flock.flightLeft, 1);
  flock.flightLeft -= step;
  if (flock.flightLeft <= 0 && !flock.leaving) endFlight(flock, context);
  else if (flock.mode === "wander") maybeStartCircle(flock, species, context);
};

const updateCircle = (flock: Flock, species: BirdSpecies, context: FlockContext) => {
  const breathing = 1 + context.noise(context.time * 0.3, flock.noiseSeed + 7) * 0.35;
  const turn = (flock.circleSign * flock.speed) / (flock.circleRadius * breathing);
  applyTurn(flock, clamp(turn, -species.turnRate, species.turnRate), context.step);
  climbTowards(flock, getCruiseTarget(flock, context) + 0.6, 0.7, context.step);
  if (flock.modeTime <= flock.modeLength) return;
  flock.course = flock.heading;
  setFlockMode(flock, "wander", Infinity);
};

const updateTakeoff = (flock: Flock, species: BirdSpecies, context: FlockContext) => {
  const profile = getTakeoffProfile(flock.modeTime / TAKEOFF_SECONDS);
  flock.speed = species.speed * profile.speed;
  meander(flock, context, species.turnRate * 0.3, 0.5);
  climbTowards(flock, getCruiseTarget(flock, context), profile.climb * 1.4, context.step);
  if (flock.modeTime > TAKEOFF_SECONDS) setFlockMode(flock, "wander", Infinity);
};

const updateLand = (flock: Flock, species: BirdSpecies, context: FlockContext) => {
  const { step } = context;
  if (flock.roof) {
    const dx = flock.landX - flock.x,
      dz = flock.landZ - flock.z,
      distance = Math.hypot(dx, dz);
    flock.heading = steerHeading(flock.heading, Math.atan2(dz, dx), species.turnRate, step);
    flock.speed = Math.min(species.speed * 0.6, distance * 1.5);
    const safeHeight = flock.landY + Math.max(0, distance - 1) * 0.25;
    flock.y = approach(flock.y, safeHeight, step * 0.8);
    return;
  }
  const distance = Math.hypot(flock.landX - flock.x, flock.landZ - flock.z);
  const profile = getLandingProfile(distance, flock.landDistance);
  if (distance > 0.6) {
    const desired = Math.atan2(flock.landZ - flock.z, flock.landX - flock.x);
    const before = flock.heading;
    flock.heading = steerHeading(flock.heading, desired, species.turnRate * 0.8, step);
    flock.turn = wrapAngle(flock.heading - before) / step;
  }
  flock.speed = approach(flock.speed, species.speed * profile.speed, step * 1.5);
  const cruise =
    sampleHabitat(context.field, context.field.canopy, flock.x, flock.z) + flock.cruise;
  const target = flock.landY + (Math.max(cruise, flock.landY) - flock.landY) * profile.height;
  climbTowards(flock, Math.min(flock.y, target), 1, step);
};

const updateScatter = (flock: Flock, species: BirdSpecies, context: FlockContext) => {
  flock.speed = approach(flock.speed, species.speed * 1.5, context.step * 3);
  meander(flock, context, species.turnRate * 0.8, 2);
  climbTowards(flock, getCruiseTarget(flock, context) + 1.5, 1.6, context.step);
  if (flock.modeTime > SCATTER_SECONDS) setFlockMode(flock, "wander", Infinity);
};

/** One fixed step of a flock's leader point. Resting flocks only count their rest down. */
export const updateFlock = (flock: Flock, context: FlockContext) => {
  const species = BIRD_SPECIES[flock.species]!;
  flock.age += context.step;
  flock.modeTime += context.step;
  if (
    flock.roof &&
    flock.mode === "wander" &&
    flock.y > flock.roof.y + 1.2 &&
    Math.hypot(flock.x - flock.roof.x, flock.z - flock.roof.z) > 3
  ) {
    context.buildings?.releaseRoof(flock);
    flock.roof = null;
  }
  if (flock.mode === "rest") return;
  if (flock.mode === "takeoff") updateTakeoff(flock, species, context);
  else if (flock.mode === "circle") updateCircle(flock, species, context);
  else if (flock.mode === "land") updateLand(flock, species, context);
  else if (flock.mode === "scatter") updateScatter(flock, species, context);
  else updateWander(flock, species, context);
  if (context.buildings) {
    const floor = context.buildings.clearance(
      flock,
      flock.heading,
      flock.speed,
      species.size * 0.6,
      flock.roof
    );
    flock.y += Math.min(Math.max(0, floor - flock.y), 2 * context.step);
    const desired = context.buildings.heading(
      flock,
      flock.heading,
      flock.speed,
      species.size * 0.6,
      flock,
      0,
      flock.roof
    );
    flock.heading = steerHeading(flock.heading, desired, species.turnRate, context.step);
    if (Math.abs(wrapAngle(desired - flock.heading)) > 0.001) flock.course = desired;
    previousPosition.x = flock.x;
    previousPosition.y = flock.y;
    previousPosition.z = flock.z;
    moveForward(flock, context.step);
    context.buildings.move(previousPosition, flock, species.size * 0.6, flock.roof);
    return;
  }
  moveForward(flock, context.step);
};
