import { TRAFFIC_WEAR_TUNING } from "./traffic-wear-tuning";

/**
 * Per-texel trail line (WEAR-3): the B/A bytes of the wear field hold the direction (folded to
 * 0..π) and the signed offset of the line the walkers or the cart centres really followed through
 * that texel. The shader rebuilds the line from them and places footprints or wheel ruts on it.
 * Offset byte 0 means "no line"; 1..255 cover ±`lineOffsetRange` cells.
 */
const OFFSET_STEPS = 127;
const HALF_TURN = Math.PI;

const foldAngle = (angle: number) => {
  const folded = angle % HALF_TURN;
  return folded < 0 ? folded + HALF_TURN : folded;
};

export const encodeLineAngle = (angle: number) => Math.min(255, Math.floor(foldAngle(angle) * 256 / HALF_TURN));
export const decodeLineAngle = (byte: number) => (byte + 0.5) * HALF_TURN / 256;

export const encodeLineOffset = (offset: number) => {
  const range = TRAFFIC_WEAR_TUNING.lineOffsetRange;
  const clamped = Math.max(-range, Math.min(range, offset));
  return 1 + Math.round((clamped / range + 1) * OFFSET_STEPS);
};
export const decodeLineOffset = (byte: number) =>
  ((byte - 1) / OFFSET_STEPS - 1) * TRAFFIC_WEAR_TUNING.lineOffsetRange;

/** Signed distance of (dx, dz) from a line through the origin with direction `angle` (x, z). */
export const lineLateral = (angle: number, dx: number, dz: number) => -Math.sin(angle) * dx + Math.cos(angle) * dz;

/** Signed turn from `from` to `to`, both folded directions, in (-π/2, π/2]. */
const foldedTurn = (from: number, to: number) => {
  const turn = to - from;
  if (turn > HALF_TURN / 2) return turn - HALF_TURN;
  if (turn <= -HALF_TURN / 2) return turn + HALF_TURN;
  return turn;
};

export interface TrailLineSample {
  /** Field byte of the texel's angle (its offset byte follows). */
  byte: number;
  /** Texel centre in world units. */
  centreX: number;
  centreZ: number;
  /** A point of the trail line and its heading (radians, x/z plane). */
  heading: number;
  x: number;
  z: number;
}

/**
 * Blends a crossing into the texel's stored line. `established` lines keep their direction
 * against crossing trails (junctions keep the dominant path); fresh texels take the line exactly.
 */
export const blendTrailLine = (pixels: Uint8Array, sample: TrailLineSample, established: boolean) => {
  const { byte, centreX, centreZ, heading, x, z } = sample;
  const tuning = TRAFFIC_WEAR_TUNING, storedOffset = pixels[byte + 1]!;
  const crossing = foldAngle(heading);
  if (storedOffset === 0) {
    pixels[byte] = encodeLineAngle(crossing);
    pixels[byte + 1] = encodeLineOffset(lineLateral(crossing, x - centreX, z - centreZ));
    return;
  }
  const stored = decodeLineAngle(pixels[byte]!), turn = foldedTurn(stored, crossing);
  if (established && Math.abs(turn) > tuning.lineMaxTurn) return;
  const blend = Math.abs(turn) > tuning.lineMaxTurn ? 1 : tuning.lineBlend;
  const unwrapped = stored + turn * blend;
  // Crossing the 0/π fold flips the line normal, so the stored offset changes sign.
  const flip = unwrapped < 0 || unwrapped >= HALF_TURN ? -1 : 1;
  const angle = foldAngle(unwrapped), previous = decodeLineOffset(storedOffset) * flip;
  const offset = previous + (lineLateral(angle, x - centreX, z - centreZ) - previous) * blend;
  pixels[byte] = encodeLineAngle(angle);
  pixels[byte + 1] = encodeLineOffset(offset);
};
