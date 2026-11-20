import { cross, normalize, type Vec3 } from "../props/mesh-builder";
import type { RockFamily } from "./rock-shapes";

/**
 * Why a rock is there (debug colouring, LOD: rubble is dropped first). Pebbles are render only
 * (the contact band where rock meets the ground), never colliders; so are the mountain
 * builder's masses (the stones a mountain is built from, see mountain-builder.ts).
 */
export const ROCK_ROLE = {
  slab: 0,
  plate: 1,
  lip: 2,
  rubble: 3,
  outcrop: 4,
  pebble: 5,
  mass: 6
} as const;
export type RockRole = (typeof ROCK_ROLE)[keyof typeof ROCK_ROLE];

/** One placed rock: a library shape stretched along three world axes. */
export interface RockInstance {
  /** Shape axes in world space, already scaled (unit shape x, y, z map onto these). */
  axes: [Vec3, Vec3, Vec3];
  centre: Vec3;
  /**
   * Standalone stone seen close up (meadow stones, mountain foot boulders): the rock shader adds
   * a finer texture octave (mottling, speckle, pits, hairline cracks, lichen, moss).
   */
  detailed?: boolean;
  /** 0 sheltered (lip, foot, short faces) .. 1 high exposed face: clean vs weathered rock. */
  exposure: number;
  family: RockFamily;
  /** High detail shape (large, close-up rocks) or low (rubble, small plates). */
  high: boolean;
  /** 0..1 how readily moss grows on it (moisture, archetype). */
  moss: number;
  /** Ore of a detailed stone on a surveyed mine field (ORE code; 0 or unset: plain stone). */
  ore?: number;
  role: RockRole;
  /** Placement id: rocks of one formation share it (debug: slab layout). */
  slab: number;
  /**
   * The placement tile (chunk id) that placed it: its mesh chunk and its owner in a map editor
   * rebuild (it may lean over the chunk edge); unset: the chunk under its centre.
   */
  tile?: number;
  /** -1 cool slate .. 1 warm brown / reddish stone. */
  tint: number;
  variant: number;
}


/** Rodrigues rotation of `vector` around the unit `axis`. */
const rotateAround = (vector: Vec3, axis: Vec3, angle: number): Vec3 => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const along = vector[0] * axis[0] + vector[1] * axis[1] + vector[2] * axis[2];
  const turn = cross(axis, vector);
  return [0, 1, 2].map(
    (index) => vector[index]! * cos + turn[index]! * sin + axis[index]! * along * (1 - cos)
  ) as unknown as Vec3;
};

export interface Frame {
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

/** Upright frame: y world up, z out of the face (horizontal), x along the face. */
export const createUprightFrame = (outward: Vec3): Frame => {
  const z = normalize([outward[0], 0, outward[2]]);
  return { x: normalize(cross([0, 1, 0], z)), y: [0, 1, 0], z };
};

/** Slope frame: z the surface normal, y up the slope, x along the contour. */
export const createSlopeFrame = (normal: Vec3): Frame => {
  const x = normalize(cross([0, 1, 0], normal));
  return { x, y: normalize(cross(normal, x)), z: normal };
};

/** Tilts a frame: roll (around z, strata dip) then lean (around x, in or out of the face). */
export const tiltFrame = (frame: Frame, roll: number, lean: number): Frame => {
  const x = rotateAround(frame.x, frame.z, roll);
  const y = rotateAround(frame.y, frame.z, roll);
  return { x, y: rotateAround(y, x, lean), z: rotateAround(frame.z, x, lean) };
};

/** Frame scaled to a size: the instance axes. */
export const scaleFrame = (frame: Frame, size: Vec3): [Vec3, Vec3, Vec3] => [
  frame.x.map((value) => value * size[0]) as unknown as Vec3,
  frame.y.map((value) => value * size[1]) as unknown as Vec3,
  frame.z.map((value) => value * size[2]) as unknown as Vec3
];
