import { lerp3, smoothstep } from "../../shared/world/noise";
import { hashTexel } from "../materials/tile-canvas";
import type { Vec3 } from "../props/mesh-builder";
import {
  getOutlineRadius,
  WING_ROOT_X,
  WING_ROOT_Z,
  type WingOutline,
  type WingPixel,
  type WingShape
} from "./butterfly-wing-shape";

/** Shared painting helpers of the butterfly wing cards (original procedural markings). */

/** 0..1 ramp between two edges (clamped; edges may run downwards). */
export const ramp = (from: number, to: number, value: number) =>
  Math.min(1, Math.max(0, (value - from) / (to - from)));

/** Card point of a wing position (radial 0..1 to the margin, across 0 front .. 1 inner edge). */
export const placeOnWing = (outline: WingOutline, radial: number, across: number): Vec3 => {
  const first = outline.keys[0]![0];
  const last = outline.keys[outline.keys.length - 1]![0];
  const angle = first + (last - first) * across;
  const radius = getOutlineRadius(outline, angle) * radial;
  return [WING_ROOT_X + Math.cos(angle) * radius, 0, WING_ROOT_Z + Math.sin(angle) * radius];
};

export interface EyespotColors {
  iris: Vec3;
  pupil: Vec3;
  ring: Vec3;
}

/** An eyespot: a pale-centred pupil, an iris, a dark ring (mixed over `color`). */
export const paintEyespot = (
  color: Vec3,
  pixel: WingPixel,
  center: Vec3,
  size: number,
  colors: EyespotColors
): Vec3 => {
  const distance = Math.hypot(pixel.x - center[0], pixel.z - center[2]) / size;
  if (distance >= 1) return color;
  const highlight =
    1 -
    smoothstep(
      0.08,
      0.16,
      Math.hypot(pixel.x - center[0] - size * 0.15, pixel.z - center[2] - size * 0.12) / size
    );
  let eye = lerp3(colors.pupil, colors.iris, smoothstep(0.3, 0.38, distance));
  eye = lerp3(eye, colors.ring, smoothstep(0.62, 0.7, distance));
  eye = lerp3(eye, [0.97, 0.96, 0.92], highlight * 0.85);
  return lerp3(eye, color, smoothstep(0.88, 1, distance));
};

/** Ground colour, markings and the side's finishing (veins, margin, fringe, base hair). */
export interface WingStyle {
  base: Vec3;
  baseStrength: number;
  fringe: Vec3;
  margin: Vec3;
  marginWidth: number;
  vein: Vec3;
  veinStrength: number;
}

/**
 * One painted wing side: `paint` the ground colour and fixed marks, then the variant's markings,
 * then `top` (signature marks drawn over everything, e.g. eyespots), then the style's finishing.
 */
export interface WingSide {
  paint: (pixel: WingPixel) => Vec3;
  style: WingStyle;
  top?: (color: Vec3, pixel: WingPixel) => Vec3;
}

/**
 * Generic venation (shares of the wing's angle range): veins from the root, the discal cell
 * closed by a cross vein, veins branching from the cell to the margin.
 */
const VENATION = {
  fore: { cell: 0.42, cellFrom: 0.14, cellTo: 0.72, fromCell: [0.27, 0.39, 0.5, 0.61] },
  hind: { cell: 0.38, cellFrom: 0.16, cellTo: 0.7, fromCell: [0.31, 0.44, 0.57] }
};
const ROOT_VEINS = { fore: [0.03, 0.14, 0.72, 0.9], hind: [0.08, 0.16, 0.7, 0.86] };
const VEIN_WIDTH = 0.0055;

/** Veins fan out a little towards the margin (gently curved, not straight spokes). */
const VEIN_FAN = 0.22;

/** A vein from the root at `share` of the wing's angle range, thinner towards the margin. */
const getRayVein = (
  pixel: WingPixel,
  radius: number,
  share: number,
  outline: WingOutline,
  width: number
) => {
  const first = outline.keys[0]![0];
  const range = outline.keys[outline.keys.length - 1]![0] - first;
  const fan = VEIN_FAN * pixel.radial * pixel.radial * (share - 0.5);
  const angle = first + (share + fan) * range;
  const taper = width * (1.25 - 0.5 * pixel.radial);
  return 1 - smoothstep(taper * 0.45, taper, radius * Math.abs(pixel.angle - angle));
};

/** 0..1 vein line coverage of a card point. */
const getVeinMask = (pixel: WingPixel, shape: WingShape, width = VEIN_WIDTH) => {
  const outline = pixel.fore ? shape.fore : shape.hind;
  const radius = Math.hypot(pixel.x - WING_ROOT_X, pixel.z - WING_ROOT_Z);
  const venation = pixel.fore ? VENATION.fore : VENATION.hind;
  let mask = 0;
  for (const share of pixel.fore ? ROOT_VEINS.fore : ROOT_VEINS.hind)
    mask = Math.max(mask, getRayVein(pixel, radius, share, outline, width));
  if (pixel.radial > venation.cell) {
    for (const share of venation.fromCell)
      mask = Math.max(mask, getRayVein(pixel, radius, share, outline, width));
  }
  const inCell = pixel.across > venation.cellFrom && pixel.across < venation.cellTo;
  const cellEdge = Math.abs(pixel.radial - venation.cell) * (radius / Math.max(pixel.radial, 0.01));
  if (inCell) mask = Math.max(mask, 1 - smoothstep(width * 0.45, width, cellEdge));
  return mask * smoothstep(0.04, 0.12, pixel.radial);
};

/** Vein coverage of a texel (shape only, shared by every variant and side). */
export interface TexelVeins {
  /** Wider vein mask: the dark checks of the fringe where a vein ends. */
  end: number;
  vein: number;
}

/** A texel's veins: the fringe's wide mask only near the margin (it is not cheap). */
export const getTexelVeins = (pixel: WingPixel, shape: WingShape): TexelVeins => ({
  end: pixel.toMargin < 0.01 ? getVeinMask(pixel, shape, VEIN_WIDTH * 2.2) : 0,
  vein: getVeinMask(pixel, shape)
});

/** Fringe hairs at the margin: checkered dark where a vein ends, pale between. */
const paintFringe = (color: Vec3, pixel: WingPixel, veinEnd: number, style: WingStyle) => {
  const fringe = 1 - smoothstep(0.004, 0.009, pixel.toMargin);
  if (fringe <= 0) return color;
  return lerp3(color, lerp3(style.fringe, style.margin, veinEnd * 0.6), fringe * 0.85);
};

/** Veins, margin band, fringe, hairy base and the forewing's shadow over the hindwing. */
export const finishWing = (color: Vec3, pixel: WingPixel, veins: TexelVeins, style: WingStyle) => {
  let result = lerp3(color, style.base, ramp(0.3, 0.02, pixel.radial) * style.baseStrength);
  result = lerp3(result, style.vein, veins.vein * style.veinStrength * (0.35 + 0.65 * pixel.radial));
  if (style.marginWidth > 0) {
    const band = 1 - smoothstep(style.marginWidth * 0.75, style.marginWidth, pixel.toMargin);
    result = lerp3(result, style.margin, band);
  }
  result = paintFringe(result, pixel, veins.end, style);
  if (pixel.fore) return result;
  const shadow = 1 - smoothstep(0, 0.022, pixel.foreGap);
  return lerp3(result, [0, 0, 0], shadow * 0.32);
};

/** Fine scale grain: a little per texel variation so flat colours read as scales. */
export const addScaleGrain = (color: Vec3, column: number, row: number, salt: number): Vec3 => {
  const grain = 1 + (hashTexel(column, row, salt) - 0.5) * 0.07;
  return [color[0] * grain, color[1] * grain, color[2] * grain];
};
