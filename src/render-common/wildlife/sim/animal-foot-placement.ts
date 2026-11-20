import { DMath } from "../../../shared/math/deterministic-math";
import { sampleSmooth } from "../../../shared/world/grid-geometry";
import { smoothstep } from "../../../shared/world/noise";
import type { WorldData } from "../../../shared/world/world-data";
import { HOCK_TUCK_ONSET, POSE } from "../model/animal-rig";
import { solveTwoBone } from "../model/foot-ik";
import {
  createLegPoints,
  getHipHeight,
  getLegPoints,
  getRootHeight,
  LEG_SEGMENTS,
  LEGS,
  pitchAboutRoot
} from "../model/leg-geometry";

/** The terrain the feet stand on (the island, or a test slope). */
export type FootGround = Pick<WorldData, "cellsX" | "cellsZ" | "heights">;

/** Where and how an animal instance stands this frame (the renderer's instance transform). */
export interface FootPlacementBody {
  heading: number;
  pitch: number;
  roll: number;
  scale: number;
  x: number;
  /** Ground height plus the pose lift (world units): the instance origin height. */
  y: number;
  z: number;
}

/** A foot this high above the stance (share of the leg) is in its swing: no IK. */
const SWING_START = 0.03;
const SWING_FULL = 0.1;
/** The body never crouches deeper than this share of the leg to reach a low foot. */
const MAX_CROUCH = 0.3;
/** Hocks stay below the bedded hock tuck (the rig rolls the cannon past it). */
const MAX_HOCK = HOCK_TUCK_ONSET - 0.02;
/** Smaller corrections (share of the leg) are left alone. */
const MIN_CORRECTION = 0.002;

const legs = LEGS.map(() => createLegPoints());
const sole = [0, 0, 0];
const errors = new Float32Array(LEGS.length);
const weights = new Float32Array(LEGS.length);

/** Instance transform of a model point (rig pose already applied) to world height and xz. */
export const toWorld = (body: FootPlacementBody, point: number[]) => {
  const cosPitch = DMath.cos(body.pitch);
  const sinPitch = DMath.sin(body.pitch);
  const x1 = point[0]! * cosPitch - point[1]! * sinPitch;
  const y1 = point[0]! * sinPitch + point[1]! * cosPitch;
  const cosRoll = DMath.cos(-body.roll);
  const sinRoll = DMath.sin(-body.roll);
  const y2 = y1 * cosRoll - point[2]! * sinRoll;
  const z2 = y1 * sinRoll + point[2]! * cosRoll;
  const cosHeading = DMath.cos(body.heading);
  const sinHeading = DMath.sin(body.heading);
  point[0] = body.x + (x1 * cosHeading - z2 * sinHeading) * body.scale;
  point[1] = body.y + y2 * body.scale;
  point[2] = body.z + (x1 * sinHeading + z2 * cosHeading) * body.scale;
};

/** The leg's segments (front or hind) of a species. */
const getSegments = (species: number, front: boolean) =>
  front ? LEG_SEGMENTS[species]!.front : LEG_SEGMENTS[species]!.hind;

/** Scratch result of measureFoot (no allocation). */
const footReading = { error: 0, raised: 0 };

/** The leg being measured (module scratch, set by measureFoot). */
const measuring = {
  body: null as FootPlacementBody | null,
  ground: null as FootGround | null,
  legHeight: 1,
  liftShare: 0,
  pitch: 0,
  rootHeight: 0
};

/** One sole point into footReading: its height above the stance and its ground error. */
const readSolePoint = (point: readonly number[]) => {
  const { body, ground, legHeight, liftShare, pitch, rootHeight } = measuring;
  sole[0] = point[0]!;
  sole[1] = point[1]!;
  sole[2] = point[2]!;
  pitchAboutRoot(sole, pitch, rootHeight);
  footReading.raised = Math.min(footReading.raised, sole[1]! / legHeight + liftShare);
  toWorld(body!, sole);
  const error = sampleSmooth(ground!, ground!.heights, sole[0]!, sole[2]!) - sole[1]!;
  footReading.error = Math.max(footReading.error, error);
};

/**
 * Leg `index` against the ground with the pose of `pose` (writes the leg's points): `error`
 * is the ground minus the lowest of heel, contact and toe (world units, > 0 sunk in, < 0
 * floating), `raised` the lowest sole point above the stance (share of the leg; 0 planted).
 */
export const measureFoot = (
  species: number,
  index: number,
  pose: Float32Array,
  offset: number,
  lift: number,
  body: FootPlacementBody,
  ground: FootGround
) => {
  const info = LEGS[index]!;
  const points = getLegPoints(
    species,
    info,
    pose[offset + info.hip]!,
    pose[offset + info.knee]!,
    legs[index]!
  );
  measuring.body = body;
  measuring.ground = ground;
  measuring.legHeight = getHipHeight(getSegments(species, info.front));
  measuring.liftShare = lift / measuring.legHeight;
  measuring.pitch = pose[offset + POSE.bodyPitch]!;
  measuring.rootHeight = getRootHeight(species);
  footReading.error = -Infinity;
  footReading.raised = Infinity;
  readSolePoint(points.heel);
  readSolePoint(points.foot);
  readSolePoint(points.toe);
  return footReading;
};

/** Stance weight of a foot `raised` (share of the leg) above the stance: 0 in the swing. */
export const getStanceWeight = (raised: number) => 1 - smoothstep(SWING_START, SWING_FULL, raised);

/**
 * Ground error of every foot (ground minus foot, world units) and its stance weight: feet
 * lifted in a swing (or a hop) fade out, `blend` (0 .. 1) scales them all.
 */
const measureFeet = (
  species: number,
  pose: Float32Array,
  offset: number,
  lift: number,
  body: FootPlacementBody,
  world: FootGround,
  blend: number
) => {
  for (let index = 0; index < LEGS.length; index += 1) {
    const reading = measureFoot(species, index, pose, offset, lift, body, world);
    weights[index] = blend * getStanceWeight(reading.raised);
    errors[index] = reading.error;
  }
};

/** Model-space side-plane direction of world up (the body tilt and the rig pitch removed). */
const getModelUp = (body: FootPlacementBody, bodyPitch: number) => {
  const tilt = body.pitch + bodyPitch;
  const upright = DMath.cos(body.roll);
  return { x: upright * DMath.sin(tilt), y: upright * DMath.cos(tilt) };
};

/** Re-solves one leg so its foot moves `rise` (model units) up along world vertical. */
const raiseFoot = (
  species: number,
  index: number,
  rise: number,
  up: { x: number; y: number },
  pose: Float32Array,
  offset: number
) => {
  const info = LEGS[index]!;
  const points = legs[index]!;
  const segments = getSegments(species, info.front);
  const targetX = points.foot[0] - points.hip[0] + up.x * rise;
  const targetY = points.foot[1] - points.hip[1] + up.y * rise;
  const foldSign = info.front ? -1 : 1;
  const solved = solveTwoBone(segments, pose[offset + info.knee]!, foldSign, targetX, targetY);
  pose[offset + info.hip] = solved.hip;
  pose[offset + info.knee] = info.front ? solved.knee : Math.min(solved.knee, MAX_HOCK);
};

/** Correction passes after the first solve (the sole tilts with every change). */
const REFINE_PASSES = 2;
/** Scratch body of the refinement passes (the body after its drop). */
const settled: FootPlacementBody = { heading: 0, pitch: 0, roll: 0, scale: 1, x: 0, y: 0, z: 0 };

/** Highest body rise (share of the leg) for a foot whose leg is already folded as far as it goes. */
const MAX_RISE = 0.15;

/**
 * A stance foot still sunk after the passes belongs to a leg folded as short as it goes (a
 * crouching rabbit's tucked hind leg): the body rises by what is left, a little at most.
 */
const getResidualRise = (
  species: number,
  pose: Float32Array,
  offset: number,
  lift: number,
  world: FootGround
) => {
  let rise = 0;
  for (let index = 0; index < LEGS.length; index += 1) {
    if (weights[index]! < 0.5) continue;
    rise = Math.max(rise, measureFoot(species, index, pose, offset, lift, settled, world).error);
  }
  return Math.min(rise, MAX_RISE * getRootHeight(species) * settled.scale);
};

/**
 * Correction pass: the sole tilting with the new angles and the tilted body leave a small
 * residual; each stance foot (and any sunk one) is measured again and corrected.
 */
const refineFeet = (
  species: number,
  pose: Float32Array,
  offset: number,
  lift: number,
  body: FootPlacementBody,
  world: FootGround
) => {
  const legHeight = getRootHeight(species);
  const up = getModelUp(body, pose[offset + POSE.bodyPitch]!);
  for (let index = 0; index < LEGS.length; index += 1) {
    const { error } = measureFoot(species, index, pose, offset, lift, body, world);
    const weight = error > 0 ? 1 : weights[index]!;
    const rise = (error * weight) / body.scale;
    if (Math.abs(rise) < MIN_CORRECTION * legHeight * 0.25) continue;
    raiseFoot(species, index, rise, up, pose, offset);
  }
};

/**
 * Foot placement (two-bone leg IK on the shared channels): each standing foot samples the
 * ground under it once; the body drops to reach the lowest of them (never deeper than
 * MAX_CROUCH of the leg) and every other stance leg bends to put its foot on its own ground;
 * a swinging foot is only lifted out of the ground, and a foot that a fully folded leg cannot
 * lift raises the body a little. `blend` 0 (rests, the fall) keeps the pose. Returns the body
 * height change (world units).
 */
export const placeFeet = (
  species: number,
  pose: Float32Array,
  offset: number,
  lift: number,
  body: FootPlacementBody,
  world: FootGround,
  blend: number
) => {
  if (blend <= 0) return 0;
  measureFeet(species, pose, offset, lift, body, world, blend);
  const legHeight = getRootHeight(species);
  let drop = 0;
  for (let index = 0; index < LEGS.length; index += 1) {
    drop = Math.min(drop, Math.min(0, errors[index]!) * weights[index]!);
  }
  drop = Math.max(drop, -MAX_CROUCH * legHeight * body.scale);
  const up = getModelUp(body, pose[offset + POSE.bodyPitch]!);
  for (let index = 0; index < LEGS.length; index += 1) {
    const sunk = errors[index]! - drop;
    const weight = errors[index]! > 0 ? blend : weights[index]!;
    const rise = (Math.max(0, sunk) * weight) / body.scale;
    if (rise < MIN_CORRECTION * legHeight) continue;
    raiseFoot(species, index, rise, up, pose, offset);
  }
  Object.assign(settled, body);
  settled.y = body.y + drop;
  for (let pass = 0; pass < REFINE_PASSES; pass += 1) {
    refineFeet(species, pose, offset, lift, settled, world);
  }
  const rise = getResidualRise(species, pose, offset, lift, world);
  if (rise <= 0) return drop;
  settled.y += rise;
  refineFeet(species, pose, offset, lift, settled, world);
  return drop + rise;
};
