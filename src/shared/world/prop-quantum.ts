/**
 * Prop quantization (S05): positions on a 1/64-cell grid, rotations on a 2π/65536 step and scales
 * on a 1/4096 step. The map writer stores these layers as u16 only when every value is exactly on
 * the grid and fits; otherwise it falls back to f32, so old and edited maps stay exact.
 */
import { createRandom, deriveSeed } from "./rng";
/** Tick counts of the three grids: 1/64 cell, a full turn in 16 bits, 1/4096 scale. */
const PROP_POSITION_TICKS = 64;
const PROP_ROTATION_TICKS = 65536;
const PROP_SCALE_TICKS = 4096;
export const PROP_POSITION_STEP = 1 / PROP_POSITION_TICKS;
export const PROP_ROTATION_STEP = Math.PI * 2 / PROP_ROTATION_TICKS;
export const PROP_SCALE_STEP = 1 / PROP_SCALE_TICKS;
export const PROP_U16_MAX = 0xffff;

/** Presentation-only wind phase of a prop, derived from the world seed and its spatial id. */
export const propPhase = (seed: number, id: number) =>
  createRandom(deriveSeed(seed, `prop-phase-${id}`))() * Math.PI * 2;

const ticksOf = (value: number, step: number) => Math.round(value / step);

const normaliseRotationTicks = (ticks: number) =>
  ((ticks % PROP_ROTATION_TICKS) + PROP_ROTATION_TICKS) % PROP_ROTATION_TICKS;

export const quantisePropPosition = (value: number) => ticksOf(value, PROP_POSITION_STEP) * PROP_POSITION_STEP;
/** Rotations are stored as a full-turn fraction; negative facings become the equivalent 0..2π turn. */
export const quantisePropRotation = (value: number) =>
  normaliseRotationTicks(ticksOf(value, PROP_ROTATION_STEP)) * PROP_ROTATION_STEP;
export const quantisePropScale = (value: number) => ticksOf(value, PROP_SCALE_STEP) * PROP_SCALE_STEP;

export const propPositionTicks = (value: number) => ticksOf(value, PROP_POSITION_STEP);
export const propRotationTicks = (value: number) => ticksOf(value, PROP_ROTATION_STEP);
export const propScaleTicks = (value: number) => ticksOf(value, PROP_SCALE_STEP);

/** A value is exact when the stored tick count decodes back to the same float32 value. */
const exact = (value: number, step: number) => {
  if (!Number.isFinite(value)) return false;
  const ticks = Math.round(value / step);
  return ticks >= 0 && ticks <= PROP_U16_MAX && Math.fround(ticks * step) === value;
};

export const isExactPropPosition = (value: number) => exact(value, PROP_POSITION_STEP);
export const isExactPropRotation = (value: number) => exact(value, PROP_ROTATION_STEP);
export const isExactPropScale = (value: number) => exact(value, PROP_SCALE_STEP);

/** Position/scale/rotation values that can be stored as an unsigned 16-bit tick count. */
export const fitsU16Ticks = (ticks: number, minimum = 0) =>
  Number.isSafeInteger(ticks) && ticks >= minimum && ticks <= PROP_U16_MAX;

export const decodePropPositionTicks = (ticks: number) => ticks * PROP_POSITION_STEP;
export const decodePropRotationTicks = (ticks: number) => ticks * PROP_ROTATION_STEP;
export const decodePropScaleTicks = (ticks: number) => ticks * PROP_SCALE_STEP;
