import type { Random } from "../../shared/world/rng";
import type { PeriodicNoise } from "./periodic-noise";
import {
  blendPaint,
  hashTexel,
  type Paint,
  type Rgb,
  setPaint,
  stampLeaf,
  stampStone,
  stampStroke,
  type Stroke,
  type TileCanvas,
  writeBase} from "./tile-canvas";

/** Everything a material recipe paints with. Sizes are in texels of the tile. */
export interface RecipeContext {
  canvas: TileCanvas;
  noise: PeriodicNoise;
  paint: Paint;
  random: Random;
}

export type MaterialRecipe = (context: RecipeContext) => void;

/** Base layer shader: sets `paint` for a texel and returns its height. */
export type BaseTexel = (u: number, v: number, x: number, y: number, paint: Paint) => number;

export const unit = (value: number) => value * 0.5 + 0.5;

export const range = (random: Random, min: number, max: number) => min + random() * (max - min);

/** Grains: single darker and lighter texels (soil crumbs, sand grains, grit). */
export const addGrain = (
  paint: Paint,
  x: number,
  y: number,
  dark: Rgb,
  light: Rgb,
  amount: number
) => {
  const grain = hashTexel(x, y, 31);
  if (grain < amount) blendPaint(paint, dark, dark, 0, 0.4);
  else if (grain > 1 - amount) blendPaint(paint, light, light, 0, 0.35);
  return grain;
};

/** Colour along a palette (t 0..1), linearly between neighbouring entries. */
export const setPaintFromRamp = (paint: Paint, ramp: readonly Rgb[], t: number, shade = 1) => {
  const position = Math.min(0.9999, Math.max(0, t)) * (ramp.length - 1);
  const index = Math.floor(position);
  setPaint(paint, ramp[index]!, ramp[index + 1] ?? ramp[index]!, position - index, shade);
};

export const fillBase = (context: RecipeContext, texel: BaseTexel) => {
  const { canvas, paint } = context;
  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) {
      const height = texel(x / canvas.size, y / canvas.size, x, y, paint);
      writeBase(canvas, y * canvas.size + x, paint, height);
    }
  }
};

/** Calls `place` `count` times at random texel positions. */
export const scatter = (
  context: RecipeContext,
  count: number,
  place: (x: number, y: number) => void
) => {
  const { canvas, random } = context;
  for (let index = 0; index < count; index += 1)
    place(random() * canvas.size, random() * canvas.size);
};

/** Jittered grid: even coverage without the gaps and clumps of pure random scattering. */
export const scatterGrid = (
  context: RecipeContext,
  spacing: number,
  place: (x: number, y: number) => void
) => {
  const { canvas, random } = context;
  const cells = Math.max(1, Math.round(canvas.size / spacing));
  const step = canvas.size / cells;
  for (let row = 0; row < cells; row += 1) {
    for (let column = 0; column < cells; column += 1) {
      place((column + random()) * step, (row + random()) * step);
    }
  }
};

/** Density 0..1 at a texel from tileable noise (irregular cover, no visible period). */
export const densityAt = (
  context: RecipeContext,
  x: number,
  y: number,
  period: number,
  contrast: number
) => {
  const { canvas, noise } = context;
  const value = noise.fbm(x / canvas.size, y / canvas.size, period, 3) * contrast + 0.5;
  return Math.min(1, Math.max(0, value));
};

export interface StoneScatter {
  angularity: number;
  /** Fraction of the stone below the surface: 0 lies on top, 0.6 mostly buried. */
  buried: number;
  count: number;
  flatTop: number;
  maxRadius: number;
  minRadius: number;
  palette: readonly Rgb[];
  /** Height of the surface the stones sit in. */
  surface: number;
}

/** Pebbles / stones with a size bias to small ones; partly sunk into the surface. */
export const scatterStones = (context: RecipeContext, options: StoneScatter, salt: number) => {
  const { paint, random } = context;
  scatter(context, options.count, (x, y) => {
    const radius = options.minRadius + (options.maxRadius - options.minRadius) * random() ** 2.2;
    const dome = 0.18 + Math.min(0.5, radius * 0.045);
    setPaintFromRamp(paint, options.palette, random(), range(random, 0.85, 1.1));
    paint.roughness = range(random, 0.55, 0.8);
    stampStone(
      context.canvas,
      {
        angularity: options.angularity * range(random, 0.6, 1),
        baseHeight: options.surface - dome * options.buried,
        dome,
        facets: 4 + Math.floor(random() * 4),
        flatTop: options.flatTop,
        lobes: [range(random, -0.18, 0.18), range(random, -0.1, 0.1), range(random, -0.05, 0.05)],
        radius,
        rimShade: 0.35,
        rotation: random() * Math.PI * 2,
        speckle: 0.12,
        x,
        y
      },
      paint,
      salt
    );
  });
};

/** A thin stroke with random direction: twigs, needles, dry grass bits, seaweed. */
export interface DebrisScatter {
  bend: number;
  count: number;
  height: readonly [number, number];
  length: readonly [number, number];
  palette: readonly Rgb[];
  roughness: number;
  taper: number;
  width: readonly [number, number];
}

export const scatterDebris = (context: RecipeContext, options: DebrisScatter) => {
  const { paint, random } = context;
  scatter(context, options.count, (x, y) => {
    setPaintFromRamp(paint, options.palette, random(), range(random, 0.85, 1.1));
    paint.roughness = options.roughness;
    const height = range(random, options.height[0], options.height[1]);
    stampStroke(context.canvas, createStroke(random, x, y, options, height), paint);
  });
};

const createStroke = (
  random: Random,
  x: number,
  y: number,
  options: DebrisScatter,
  height: number
): Stroke => ({
  angle: random() * Math.PI * 2,
  baseHeight: height,
  bend: (random() - 0.5) * options.bend,
  length: range(random, options.length[0], options.length[1]),
  taper: options.taper,
  tipHeight: height + 0.02,
  wiggle: options.bend * 0.25,
  wiggleFrequency: 1.5,
  width: range(random, options.width[0], options.width[1]),
  x,
  y
});

export interface LeafScatter {
  count: number;
  curl: number;
  height: readonly [number, number];
  length: readonly [number, number];
  palette: readonly Rgb[];
  /** Width relative to the length. */
  shape: readonly [number, number];
  /** Optional 0..1 acceptance at a texel (fewer leaves on moss, more in hollows). */
  accept?: (x: number, y: number) => number;
}

export const scatterLeaves = (context: RecipeContext, options: LeafScatter) => {
  const { paint, random } = context;
  scatter(context, options.count, (x, y) => {
    if (options.accept && random() > options.accept(x, y)) return;
    const length = range(random, options.length[0], options.length[1]);
    setPaintFromRamp(paint, options.palette, random(), range(random, 0.82, 1.12));
    paint.roughness = range(random, 0.7, 0.9);
    stampLeaf(
      context.canvas,
      {
        angle: random() * Math.PI * 2,
        curl: options.curl,
        height: range(random, options.height[0], options.height[1]),
        length,
        width: length * range(random, options.shape[0], options.shape[1]),
        x,
        y
      },
      paint
    );
  });
};
