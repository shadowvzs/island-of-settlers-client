import { rgb } from "./color";

/**
 * One source for every snow colour. Values are unchanged from the former scattered literals;
 * the neutral-albedo pass awaits the owner's screenshot decision (D-W4).
 */
export const SNOW_PALETTE = {
  /** Painted snow-tile albedo. */
  tileBlue: rgb(0xb3c5de),
  tileLight: rgb(0xf6f9fc),
  tileShadow: rgb(0xcbd8ea),
  /** Full-ground lee/shade term (lighting-side blue stays). */
  groundShade: [0.8, 0.87, 1.0] as const,
  liteTone: [0.8, 0.82, 0.86] as const,
  rockLee: [0.84, 0.89, 1.0] as const,
  treeSnow: [0.9, 0.93, 0.98] as const,
  winterPropsSnow: [0.9, 0.93, 0.98] as const,
  winterFoliageSnow: [233, 239, 247] as const
} as const;

/**
 * Noon snow roll-off (D-W4, ground-glsl.ts): lit snow luminance (linear radiance) above `knee`
 * approaches `ceiling`; it fades in between sun heights `sunStart` (just above dawn/dusk) and `sunFull`.
 * Strategic (iso) and cinematic views only: the possessed eye and its spyglass keep the plain snow.
 */
export const SNOW_NOON_ROLL_OFF = {
  ceiling: 1.1,
  knee: 0.75,
  sunFull: 0.75,
  sunStart: 0.4
} as const;

const glsl = (values: readonly number[]) => `vec3(${values.map(value => value.toFixed(3)).join(", ")})`;

export const SNOW_PALETTE_GLSL = {
  groundShade: glsl(SNOW_PALETTE.groundShade),
  liteTone: glsl(SNOW_PALETTE.liteTone),
  rockLee: glsl(SNOW_PALETTE.rockLee),
  treeSnow: glsl(SNOW_PALETTE.treeSnow)
} as const;
