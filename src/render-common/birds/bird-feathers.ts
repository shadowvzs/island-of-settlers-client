import { fract, smoothstep } from "../../shared/world/noise";
import {
  type AtlasCell,
  FEATHER_CELL,
  fromCellTexel,
  TAIL_CELL,
  writeCellTexel} from "../flyers/flyer-atlas-layout";
import { hashTexel } from "../materials/tile-canvas";

/**
 * Feather detail of the bird wings and tails: a grey brightness map the species' vertex colours
 * are multiplied with (sampled from the flyer atlas). Its average
 * is FEATHER_MEAN, so the textured wings keep their colour once multiplied by FEATHER_GAIN.
 */
export const FEATHER_MEAN = 0.86;
export const FEATHER_GAIN = 1 / FEATHER_MEAN;

/** Span share (u) where the arm's secondaries end and the hand's primaries begin. */
export const PRIMARY_START = 0.68;
/** Primary feathers painted over the hand (species use 3 or 6 so the feathers line up). */
export const PAINTED_PRIMARIES = 6;
const PAINTED_SECONDARIES = 12;
/** Chord share (v) covered by the covert rows; the flight feathers start under them. */
const COVERT_END = 0.5;
const COVERT_ROW = COVERT_END / 3;
const TAIL_FEATHERS = 10;
const TAIL_COVERT_END = 0.22;

/**
 * Overlapping covert rows: small rounded feather tips (scallops) with a pale fringe, the next
 * row's shadow just past each tip.
 */
const getCovertShade = (u: number, v: number) => {
  const row = Math.floor(v / COVERT_ROW);
  const along = (v - row * COVERT_ROW) / COVERT_ROW;
  const width = row === 0 ? 0.035 : 0.05;
  const across = fract(u / width + row * 0.5) * 2 - 1;
  const tip = 0.72 + 0.28 * (1 - across * across);
  if (along > tip) return 0.74;
  const fringe = smoothstep(tip - 0.16, tip - 0.04, along);
  const side = smoothstep(0.82, 0.98, Math.abs(across));
  return (0.83 + 0.08 * (along / tip)) * (1 - side * 0.08) + fringe * 0.1;
};

/**
 * One flight feather band (0..1 across it): a pale shaft, the vane darker where the next
 * feather overlaps it, a thin dark gap at its edge.
 */
const getVaneShade = (across: number) => {
  if (across > 0.93) return 0.7;
  if (Math.abs(across - 0.4) < 0.045) return 0.98;
  return 0.8 + 0.12 * across;
};

const getFlightFeatherShade = (u: number, v: number) => {
  const primary = u >= PRIMARY_START;
  const bands = primary
    ? ((u - PRIMARY_START) / (1 - PRIMARY_START)) * PAINTED_PRIMARIES
    : (u / PRIMARY_START) * PAINTED_SECONDARIES;
  let shade = getVaneShade(fract(bands));
  /** The greater coverts' shadow over the feather bases, a pale tip on the secondaries. */
  shade *= 1 - 0.18 * (1 - smoothstep(COVERT_END, COVERT_END + 0.06, v));
  if (!primary) shade += 0.06 * smoothstep(0.88, 0.97, v);
  return shade;
};

/** Brightness of the wing feather detail at (u span, v chord). */
export const getWingFeatherShade = (u: number, v: number) =>
  v < COVERT_END ? getCovertShade(u, v) : getFlightFeatherShade(u, v);

/** Brightness of the tail feather detail at (u across, v along): coverts, then the fan. */
const getTailFeatherShade = (u: number, v: number) => {
  if (v < TAIL_COVERT_END) return getCovertShade(u, (v / TAIL_COVERT_END) * COVERT_END);
  const shade = getVaneShade(fract(u * TAIL_FEATHERS));
  return shade * (1 - 0.15 * (1 - smoothstep(TAIL_COVERT_END, TAIL_COVERT_END + 0.08, v)));
};

const paintCell = (
  pixels: Uint8Array,
  cell: AtlasCell,
  shadeAt: (u: number, v: number) => number,
  salt: number
) => {
  for (let row = 0; row < cell.height; row += 1) {
    for (let column = 0; column < cell.width; column += 1) {
      const { u, v } = fromCellTexel(cell, column, row);
      const grain = (hashTexel(column, row, salt) - 0.5) * 0.04;
      const shade = shadeAt(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))) + grain;
      writeCellTexel(pixels, cell, column, row, [shade, shade, shade], 1);
    }
  }
};

/** Paints the wing and tail feather cells of the flyer atlas. */
export const paintBirdFeathers = (pixels: Uint8Array) => {
  paintCell(pixels, FEATHER_CELL, getWingFeatherShade, 11);
  paintCell(pixels, TAIL_CELL, getTailFeatherShade, 12);
};
