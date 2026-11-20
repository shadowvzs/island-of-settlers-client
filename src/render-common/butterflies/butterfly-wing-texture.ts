import { createRandom } from "../../shared/world/rng";
import {
  BUTTERFLY_VARIANTS,
  fromCellTexel,
  getButterflyCell,
  writeCellTexel
} from "../flyers/flyer-atlas-layout";
import type { Vec3 } from "../props/mesh-builder";
import { type Marking,paintMarkings } from "./butterfly-markings";
import { BUTTERFLY_SPECIES } from "./butterfly-species";
import {
  addScaleGrain,
  finishWing,
  getTexelVeins,
  type TexelVeins,
  type WingSide
} from "./butterfly-wing-paint";
import {
  CARD_X_MAX,
  CARD_X_MIN,
  CARD_Z_MAX,
  getWingPixel,
  type WingPixel,
  type WingShape
} from "./butterfly-wing-shape";

/** Anti-aliasing width of the painted outline (wingspan units, about one texel). */
const OUTLINE_SOFTNESS = 0.006;
/** Texels this far outside the outline only get the ground colour (no visible detail). */
const PLAIN_OUTSIDE = 0.02;

/** Card position (x forward, z out) of a cell point (u, v 0..1): the wing card's UV mapping. */
const getCardPoint = (u: number, v: number) => ({
  x: CARD_X_MIN + u * (CARD_X_MAX - CARD_X_MIN),
  z: v * CARD_Z_MAX
});

/** Seed of a species' pattern variant (the same art on every page). */
const getVariantSeed = (species: number, variant: number) =>
  7919 * (species + 1) + 104729 * variant;

/** A species' card texels (shape and veins), shared by its variants and both sides. */
interface CardTexel {
  pixel: WingPixel;
  veins: TexelVeins;
}

const createCardTexels = (shape: WingShape, size: number): CardTexel[] => {
  const cell = getButterflyCell(0, 0, false);
  const texels: CardTexel[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const { u, v } = fromCellTexel(cell, column, row);
      const { x, z } = getCardPoint(u, v);
      const pixel = getWingPixel(shape, x, z, OUTLINE_SOFTNESS);
      const outside = pixel.inside < -PLAIN_OUTSIDE;
      texels.push({ pixel, veins: outside ? NO_VEINS : getTexelVeins(pixel, shape) });
    }
  }
  return texels;
};

const NO_VEINS: TexelVeins = { end: 0, vein: 0 };

const paintTexel = (texel: CardTexel, side: WingSide, markings: readonly Marking[]): Vec3 => {
  const { pixel, veins } = texel;
  const ground = side.paint(pixel);
  if (pixel.inside < -PLAIN_OUTSIDE) return ground;
  const marked = paintMarkings(ground, pixel, markings);
  const signed = side.top ? side.top(marked, pixel) : marked;
  return finishWing(signed, pixel, veins, side.style);
};

interface WingCellJob {
  markings: readonly Marking[];
  species: number;
  texels: readonly CardTexel[];
  under: boolean;
  variant: number;
}

/** Paints one side of a variant's wing card: colour everywhere (no dark mip fringes), alpha. */
const paintWingCell = (pixels: Uint8Array, job: WingCellJob) => {
  const species = BUTTERFLY_SPECIES[job.species]!;
  const side = job.under ? species.under : species.upper;
  const cell = getButterflyCell(job.species, job.variant, job.under);
  const salt = (job.species * BUTTERFLY_VARIANTS + job.variant) * 2 + (job.under ? 1 : 0);
  for (let row = 0; row < cell.height; row += 1) {
    for (let column = 0; column < cell.width; column += 1) {
      const texel = job.texels[row * cell.width + column]!;
      const color = addScaleGrain(paintTexel(texel, side, job.markings), column, row, salt);
      writeCellTexel(pixels, cell, column, row, color, texel.pixel.coverage);
    }
  }
};

/** Paints every species' pattern variants (upper and under side) into the flyer atlas. */
export const paintButterflyWings = (pixels: Uint8Array) => {
  const { width } = getButterflyCell(0, 0, false);
  BUTTERFLY_SPECIES.forEach((species, index) => {
    const texels = createCardTexels(species.shape, width);
    for (let variant = 0; variant < BUTTERFLY_VARIANTS; variant += 1) {
      const markings = species.markings(createRandom(getVariantSeed(index, variant)), variant);
      const job = { species: index, texels, variant };
      paintWingCell(pixels, { ...job, markings: markings.upper, under: false });
      paintWingCell(pixels, { ...job, markings: markings.under, under: true });
    }
  });
};
