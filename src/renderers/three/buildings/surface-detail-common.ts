import { fract } from "../../../shared/world/noise";

/** One texel of a procedural building surface: tile coordinates plus the shared grain fields. */
export interface SurfaceCoordinate {
  grain: number;
  mineral: number;
  u: number;
  v: number;
  weather: number;
}

/** Albedo multiplier, colour tilt, height (normal map source) and roughness (0…255). */
export interface RomanSurfaceDetail {
  brightness: number;
  colour: [number, number, number];
  height: number;
  roughness: number;
}

export type SurfaceSampler = (point: SurfaceCoordinate) => RomanSurfaceDetail;

/** Stable 0…1 value per block (brick, board, shingle) of a pattern. */
export const blockVariation = (column: number, row: number) =>
  ((Math.imul(column + 5, 1597334677) ^ Math.imul(row + 11, 3812015801)) >>> 0) / 4294967295;

/** Index wrapped into 0…count-1, so patterns stay tileable. */
export const wrapIndex = (index: number, count: number) => ((index % count) + count) % count;

/** Distance from `value` to the nearest whole number (0 on a seam, 0.5 mid-block). */
export const seamDistance = (value: number) => {
  const part = fract(value);
  return Math.min(part, 1 - part);
};
