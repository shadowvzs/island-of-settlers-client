import type { Vec3 } from "../../props/mesh-builder";
import { speckle } from "./critter-builder";

/** Body parts a coat paints differently. */
export type QuadPart =
  "body" | "neck" | "head" | "snout" | "nose" | "ear" | "leg" | "foot" | "tail" | "eye" | "horn";

/**
 * Coat colour of a vertex: its part, `along` the part (0 start .. 1 end: rump to chest, base to
 * tip), the ring's up (1 back .. -1 belly) and side share, and its position (patterns).
 */
export type Coat = (part: QuadPart, along: number, up: number, side: number, at: Vec3) => Vec3;

/**
 * An original procedural four legged animal in world units (forward +x, up +y, left +z, feet
 * at y 0). Body stations give the silhouette from rump to chest: x share of the body length,
 * height and width shares, lift (share of the body height).
 */
export interface QuadShape {
  body: readonly (readonly [x: number, height: number, width: number, lift: number])[];
  bodyHeight: number;
  bodyLength: number;
  bodyWidth: number;
  coat: Coat;
  earLength: number;
  /** Ear tilt back (0 upright .. 1 lying flat, floppy boar ears hang). */
  earLie: number;
  earWidth: number;
  headLength: number;
  headRadius: number;
  /** Elbow / stifle above the ground. */
  legLength: number;
  legRadius: number;
  /** Neck rise from the horizontal (radians) and its length. */
  neckAngle: number;
  neckLength: number;
  neckRadius: number;
  snoutLength: number;
  snoutRadius: number;
  tailDroop: number;
  tailLength: number;
  /** Tail thickness in the middle (bushy fox and wolf tails). */
  tailRadius: number;
}

export const mottle = (color: Vec3, at: Vec3, amount: number): Vec3 => {
  const noise = speckle(at[0] * 60, at[1] * 60, at[2] * 60) * amount;
  return [color[0] * (1 + noise), color[1] * (1 + noise), color[2] * (1 + noise)];
};

/** Leg sequence: walk one foot after the other, trot in diagonals. */
type Footfall = "walk" | "trot";

/** One pose (all 0: standing square, head level). */
export interface QuadPose {
  footfall: Footfall;
  /** Gait cycle phase 0..1 (the footfall's leg sequence). */
  gait: number;
  /** Head turn (radians, positive to the left). */
  headYaw: number;
  /** Head down to the ground (sniffing, rooting, grazing: 0..1). */
  reach: number;
  /** Lying down (0 standing .. 1 lying, legs folded). */
  rest: number;
  /** 0 standing still .. 1 full stride. */
  stride: number;
}

export const QUAD_STAND: QuadPose = {
  footfall: "walk",
  gait: 0,
  headYaw: 0,
  reach: 0,
  rest: 0,
  stride: 0
};
