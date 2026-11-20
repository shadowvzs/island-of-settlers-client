import type { Random } from "../../shared/world/rng";
import { range, type RecipeContext,setPaintFromRamp } from "./recipe-helpers";
import { type Rgb,setPaint, stampDisc, stampStroke } from "./tile-canvas";

/** Look of the blades of one grass type. Hue picks a colour along `greens` (0 deep .. 1 fresh). */
export interface BladeStyle {
  dryChance: number;
  dryRamp: readonly Rgb[];
  greens: readonly Rgb[];
  /** Tip height range (base sits at about 0.3, soil at about 0.15). */
  height: readonly [number, number];
  length: readonly [number, number];
  tip: Rgb;
  width: readonly [number, number];
}

/** A tuft: blades rooted around one point, leaning roughly the same way. */
export interface BladeClump {
  blades: number;
  hue: number;
  lean: number;
  /** 0..1 local soil moisture: drier tufts carry more straw and shorter tips. */
  moisture: number;
  radius: number;
  /** 0..1: shorter, sparser and duller blades when low. */
  vigour: number;
  x: number;
  y: number;
}

const rampColor = (ramp: readonly Rgb[], t: number): Rgb => {
  const position = Math.min(0.9999, Math.max(0, t)) * (ramp.length - 1);
  const index = Math.floor(position);
  const from = ramp[index]!;
  const to = ramp[index + 1] ?? from;
  const amount = position - index;
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount
  ];
};

const mixRgb = (from: Rgb, to: Rgb, amount: number, shade: number): Rgb => [
  (from[0] + (to[0] - from[0]) * amount) * shade,
  (from[1] + (to[1] - from[1]) * amount) * shade,
  (from[2] + (to[2] - from[2]) * amount) * shade
];

const shadeRgb = (color: Rgb, shade: number): Rgb => [
  color[0] * shade,
  color[1] * shade,
  color[2] * shade
];

const getBladeColors = (
  random: Random,
  style: BladeStyle,
  hue: number,
  moisture: number,
  vigour: number
) => {
  const dryChance = style.dryChance * (1.6 - vigour) * (1.35 - moisture * 0.5);
  const dry = random() < dryChance;
  const body = dry
    ? rampColor(style.dryRamp, random())
    : rampColor(style.greens, hue + (random() - 0.5) * 0.22);
  const base = shadeRgb(body, range(random, 0.5, 0.66));
  const tip = mixRgb(
    body,
    dry ? body : style.tip,
    range(random, 0.12, 0.38) * (0.85 + moisture * 0.25),
    range(random, 1, 1.14)
  );
  return { base, tip };
};

/** One blade: dark at the root, lighter towards the tip, rising out of the ground. */
const paintBlade = (
  context: RecipeContext,
  style: BladeStyle,
  clump: BladeClump,
  x: number,
  y: number,
  angle: number
) => {
  const { paint, random } = context;
  const { base, tip } = getBladeColors(random, style, clump.hue, clump.moisture, clump.vigour);
  const growth = 0.7 + clump.vigour * 0.4;
  const baseHeight = range(random, 0.26, 0.36);
  const tipHeight = range(random, style.height[0], style.height[1]) * growth;
  paint.roughness = range(random, 0.6, 0.85);
  stampStroke(
    context.canvas,
    {
      angle,
      baseHeight,
      bend: (random() - 0.5) * 0.9,
      length: range(random, style.length[0], style.length[1]) * growth,
      taper: 1,
      tipHeight,
      wiggle: 0,
      wiggleFrequency: 0,
      width: range(random, style.width[0], style.width[1]),
      x,
      y
    },
    paint,
    (t) => setPaint(paint, base, tip, t ** 0.7),
    // A grass leaf arches over its root mat and relaxes at the end instead of rising like a needle.
    (t) => baseHeight + (tipHeight - baseHeight) * Math.sin(t * Math.PI * .7) * .78
  );
};

export const paintBladeClump = (context: RecipeContext, style: BladeStyle, clump: BladeClump) => {
  const { random } = context;
  for (let index = 0; index < clump.blades; index += 1) {
    const around = random() * Math.PI * 2;
    const distance = clump.radius * Math.sqrt(random());
    const x = clump.x + Math.cos(around) * distance;
    const y = clump.y + Math.sin(around) * distance;
    const fan = (around - clump.lean) * 0.25;
    paintBlade(context, style, clump, x, y, clump.lean + fan + (random() - 0.5) * 2.2);
  }
};

/** Three round leaflets (clover / small herbs) slightly above the grass base. */
export const paintClover = (context: RecipeContext, x: number, y: number, ramp: readonly Rgb[]) => {
  const { paint, random } = context;
  const size = range(random, 1.3, 2.1);
  const turn = random() * Math.PI * 2;
  setPaintFromRamp(paint, ramp, random(), range(random, 0.9, 1.1));
  paint.roughness = 0.7;
  const height = range(random, 0.5, 0.75);
  for (let leaflet = 0; leaflet < 3; leaflet += 1) {
    const angle = turn + (leaflet * Math.PI * 2) / 3;
    const centerX = x + Math.cos(angle) * size;
    const centerY = y + Math.sin(angle) * size;
    stampDisc(context.canvas, centerX, centerY, size * 0.75, height, 0.06, paint);
  }
};
