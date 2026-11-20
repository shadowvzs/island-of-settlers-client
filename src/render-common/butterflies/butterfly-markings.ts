import { lerp3, smoothstep } from "../../shared/world/noise";
import type { Random } from "../../shared/world/rng";
import { randomBetween } from "../../shared/world/rng";
import type { Vec3 } from "../props/mesh-builder";
import { placeOnWing, ramp } from "./butterfly-wing-paint";
import type { WingOutline, WingPixel } from "./butterfly-wing-shape";

/**
 * Variable wing markings: each species' recipe draws a few of these per pattern variant (seeded),
 * so individuals differ while the species' ground colour, shape and signature mark stay.
 */
export type Marking =
  | { color: Vec3; kind: "dot"; size: number; x: number; z: number }
  | {
      /** A cross band at `radial`, `width` thick, waving `zigzag` (radial share) `waves` times. */
      color: Vec3;
      fore: boolean;
      kind: "band";
      radial: number;
      waves: number;
      width: number;
      zigzag: number;
    }
  | {
      /** V marks pointing inwards, `inset` from the margin (wingspan units). */
      color: Vec3;
      count: number;
      fore: boolean;
      inset: number;
      kind: "chevrons";
      size: number;
    }
  | {
      /** Dark streaks between the veins over a radial range. */
      color: Vec3;
      count: number;
      fore: boolean;
      from: number;
      kind: "streaks";
      to: number;
    };

const paintDot = (pixel: WingPixel, marking: { size: number; x: number; z: number }) =>
  1 -
  smoothstep(
    marking.size * 0.7,
    marking.size,
    Math.hypot(pixel.x - marking.x, pixel.z - marking.z)
  );

const paintBand = (pixel: WingPixel, marking: Extract<Marking, { kind: "band" }>) => {
  if (pixel.fore !== marking.fore) return 0;
  const wave = Math.abs(((pixel.across * marking.waves) % 1) * 2 - 1) * 2 - 1;
  const distance = Math.abs(pixel.radial - marking.radial - wave * marking.zigzag);
  return 1 - smoothstep(marking.width * 0.6, marking.width, distance);
};

const paintChevrons = (pixel: WingPixel, marking: Extract<Marking, { kind: "chevrons" }>) => {
  if (pixel.fore !== marking.fore) return 0;
  const cell = (pixel.across * marking.count) % 1;
  const arm = Math.abs(cell - 0.5) * 2;
  const depth = marking.inset + arm * marking.size;
  const line = 1 - smoothstep(0.004, 0.007, Math.abs(pixel.toMargin - depth));
  return line * ramp(0.95, 0.75, arm) * ramp(0.02, 0.1, pixel.across);
};

const paintStreaks = (pixel: WingPixel, marking: Extract<Marking, { kind: "streaks" }>) => {
  if (pixel.fore !== marking.fore) return 0;
  const lane = Math.abs(((pixel.across * marking.count) % 1) - 0.5) * 2;
  const along = ramp(marking.from, marking.from + 0.08, pixel.radial);
  const fade = ramp(marking.to, marking.to - 0.12, pixel.radial);
  return (1 - smoothstep(0.25, 0.45, lane)) * along * fade;
};

const getMarkingWeight = (pixel: WingPixel, marking: Marking) => {
  if (marking.kind === "dot") return paintDot(pixel, marking);
  if (marking.kind === "band") return paintBand(pixel, marking);
  if (marking.kind === "chevrons") return paintChevrons(pixel, marking);
  return paintStreaks(pixel, marking);
};

/** Paints a variant's markings over a colour (in list order). */
export const paintMarkings = (color: Vec3, pixel: WingPixel, markings: readonly Marking[]) => {
  let result = color;
  for (const marking of markings) {
    const weight = getMarkingWeight(pixel, marking);
    if (weight > 0) result = lerp3(result, marking.color, weight);
  }
  return result;
};

/** Where dots may fall: a radial and across range of one wing. */
export interface DotArea {
  across: readonly [number, number];
  outline: WingOutline;
  radial: readonly [number, number];
}

/** Many small dots, a few large ones, or mixed sizes. */
const DOT_STYLES = ["small", "large", "mixed"] as const;
export type DotStyle = (typeof DOT_STYLES)[number];

const getDotCount = (random: Random, style: DotStyle) => {
  if (style === "small") return Math.floor(randomBetween(random, 6, 10));
  if (style === "large") return Math.floor(randomBetween(random, 2, 4));
  return 5;
};

/**
 * Scattered dots (jittered positions and sizes) in a style; random when not given. `scale`
 * sizes them per species (1 = a medium butterfly).
 */
export const scatterDots = (
  random: Random,
  area: DotArea,
  color: Vec3,
  scale = 1,
  style: DotStyle = DOT_STYLES[Math.floor(random() * DOT_STYLES.length)]!
): Marking[] => {
  const count = getDotCount(random, style);
  return Array.from({ length: count }, (_, index) => {
    const large = style === "large" || (style === "mixed" && index % 2 === 0);
    const size = (large ? randomBetween(random, 0.024, 0.034) : randomBetween(random, 0.009, 0.015)) * scale;
    const point = placeOnWing(
      area.outline,
      randomBetween(random, ...area.radial),
      randomBetween(random, ...area.across)
    );
    return { color, kind: "dot", size, x: point[0], z: point[2] } satisfies Marking;
  });
};

/** A zigzag or wavy cross band (straight now and then). */
export const createBand = (
  random: Random,
  fore: boolean,
  radial: number,
  color: Vec3
): Marking => ({
  color,
  fore,
  kind: "band",
  radial: radial + randomBetween(random, -0.05, 0.05),
  waves: Math.floor(randomBetween(random, 3, 8)),
  width: randomBetween(random, 0.035, 0.07),
  zigzag: random() < 0.25 ? 0 : randomBetween(random, 0.02, 0.05)
});

export const createChevrons = (random: Random, fore: boolean, color: Vec3): Marking => ({
  color,
  count: Math.floor(randomBetween(random, 5, 9)),
  fore,
  inset: randomBetween(random, 0.012, 0.024),
  kind: "chevrons",
  size: randomBetween(random, 0.012, 0.022)
});

export const createStreaks = (random: Random, fore: boolean, color: Vec3): Marking => ({
  color,
  count: Math.floor(randomBetween(random, 6, 10)),
  fore,
  from: randomBetween(random, 0.15, 0.35),
  kind: "streaks",
  to: randomBetween(random, 0.7, 0.95)
});
