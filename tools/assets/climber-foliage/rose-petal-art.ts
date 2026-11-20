import { type ElementFrame, type FoliageElement, type Rgb, shadedColour } from "./foliage-canvas";
import { cellBorderDistance, clamp01, fractalNoise, mix, ridge, smoothstep } from "./foliage-noise";
import { bladeHalfWidth, type LeafStyle } from "./rose-leaf-art";

export interface PetalStyle {
  base: Rgb;
  /** Baked pale claw colour the base fades to (cream eye of red and white roses). */
  claw: Rgb;
  tint: number;
}

export const TINTED_PETAL: PetalStyle = { base: [0.86, 0.86, 0.86], claw: [1, 0.93, 0.7], tint: 1 };

export interface PetalSpec {
  /** 0..1: how strongly the claw fades to the baked pale colour. */
  clawFade: number;
  /** Concave cupping of the inner face (edges raised). */
  cup: number;
  /** Depth darkening towards the claw (petals seen inside an open bloom). */
  depth: number;
  frame: ElementFrame;
  salt: number;
  shadow?: number;
  style: PetalStyle;
  /** Half-width at the shoulder, relative to the petal length. */
  width: number;
}

const SHOULDER = 0.6;

/** Broadly obovate petal: narrow claw, widest above the middle, rounded crown with a shallow notch. */
const petalHalfWidth = (y: number, width: number) => {
  if (y <= 0 || y >= 1) return 0;
  if (y <= SHOULDER) return width * (0.12 + 0.88 * Math.pow(Math.sin(Math.PI / 2 * y / SHOULDER), 1.15));
  return width * Math.pow(1 - ((y - SHOULDER) / (1 - SHOULDER)) ** 2, 0.55);
};

export const petalElement = (spec: PetalSpec): FoliageElement => {
  const distance = (x: number, y: number) => {
    const wave = 0.014 * Math.sin(y * 19 + spec.salt) * smoothstep(0.45, 1, y);
    const body = Math.max(Math.abs(x) - petalHalfWidth(y, spec.width) + wave, -y * 0.5, (y - 1) * 0.5);
    return Math.max(body, -(Math.hypot(x, y - 1.03) - 0.06));
  };
  return {
    bounds: [-spec.width * 1.1, -0.02, spec.width * 1.1, 1.03],
    distance,
    frame: spec.frame,
    shade: (x, y, signed) => {
      const claw = 1 - smoothstep(0, 0.42, y), rim = 1 - smoothstep(0, 0.045, -signed);
      const raised = 1 - smoothstep(0, 0.32, -signed);
      const fan = Math.atan2(x, y + 0.12) * 46 + fractalNoise(x * 6, y * 6, spec.salt) * 4;
      const veins = Math.pow(0.5 + 0.5 * Math.cos(fan), 12) * (1 - smoothstep(0.55, 1, y));
      const velvet = fractalNoise(x * 95, y * 95, spec.salt + 3) * 0.05;
      const flush = fractalNoise(x * 3 + spec.salt, y * 3, spec.salt + 9) * 0.08;
      const luminance = 0.9 + 0.1 * claw - 0.05 * veins + 0.06 * rim + velvet + flush;
      const occlusion = 1 - spec.depth * Math.pow(1 - smoothstep(0, 0.55, y), 1.4);
      const base = spec.style.base.map((channel, index) => mix(channel, spec.style.claw[index]!, claw * spec.clawFade));
      return {
        colour: shadedColour(base as unknown as Rgb, luminance, occlusion),
        relief: spec.cup * raised * raised + 0.008 * rim + 0.0015 * veins + velvet * 0.01,
        roughness: 0.62 + fractalNoise(x * 50, y * 50, spec.salt + 1) * 0.1,
        tint: spec.style.tint * (1 - 0.45 * claw * spec.clawFade),
        translucency: 0.92 - 0.25 * claw + 0.06 * rim
      };
    },
    shadow: spec.shadow ?? 0.4
  };
};

export interface SepalSpec {
  frame: ElementFrame;
  /** Pinnate side appendages: -1 left only, 1 right only, 2 both, 0 none ("bearded" sepals). */
  lobes: -1 | 0 | 1 | 2;
  salt: number;
  style: LeafStyle;
}

const sepalHalfWidth = (y: number) => bladeHalfWidth(y, 0.15, 0.3, 1.2) + 0.06 * Math.exp(-(((y - 0.8) / 0.08) ** 2));

const LOBE_ROOTS = [0.3, 0.46, 0.62] as const;

const sepalLobeDistance = (x: number, y: number, side: number) => {
  let best = Infinity;
  for (const root of LOBE_ROOTS) {
    const ax = side * sepalHalfWidth(root) * 0.7, length = 0.15 * (1 - root * 0.6);
    const dx = side * 0.8, dy = 0.6, along = clamp01(((x - ax) * dx + (y - root) * dy) / length);
    const distance = Math.hypot(x - ax - dx * along * length, y - root - dy * along * length);
    best = Math.min(best, distance - 0.03 * Math.sin(Math.PI * Math.min(1, 0.25 + along)));
  }
  return best;
};

/** Long acuminate rose sepal with a leafy tip, glandular back and optional pinnate lobes. */
export const sepalElement = (spec: SepalSpec): FoliageElement => {
  const sides = spec.lobes === 2 ? [-1, 1] : [spec.lobes].filter(side => side !== 0);
  const distance = (x: number, y: number) => {
    const main = Math.max(Math.abs(x) - sepalHalfWidth(y), -y * 0.5, (y - 1) * 0.5);
    return sides.reduce((best, side) => Math.min(best, sepalLobeDistance(x, y, side)), main);
  };
  return {
    bounds: [-0.3, -0.02, 0.3, 1.02],
    distance,
    frame: spec.frame,
    shade: (x, y, signed) => {
      const glands = ridge(cellBorderDistance(x * 40, y * 40, spec.salt), 0.12) * 0.12;
      const margin = 1 - smoothstep(0, 0.02, -signed), midline = ridge(Math.abs(x), 0.012);
      const luminance = 0.95 - 0.1 * midline + 0.12 * margin - glands + 0.1 * (1 - y);
      return { colour: shadedColour(spec.style.base, luminance), relief: 0.01 * (1 - margin) - 0.004 * midline,
        roughness: 0.55, tint: spec.style.tint * (1 - 0.3 * margin), translucency: 0.7 - 0.3 * midline };
    },
    shadow: 0.3
  };
};

export interface OvoidSpec {
  frame: ElementFrame;
  gloss: number;
  salt: number;
  style: { base: Rgb; tint: number };
  width: number;
}

/** Closed ovoid body: rose hip/receptacle or the furled tip of a bud petal. */
export const ovoidElement = (spec: OvoidSpec): FoliageElement => ({
  bounds: [-spec.width * 1.1, -0.02, spec.width * 1.1, 1.02],
  distance: (x, y) => Math.max(Math.abs(x) - bladeHalfWidth(y, spec.width, 0.8, 0.7), -y * 0.5, (y - 1) * 0.5),
  frame: spec.frame,
  shade: (x, y) => {
    const half = Math.max(1e-4, bladeHalfWidth(y, spec.width, 0.8, 0.7)), across = clamp01(Math.abs(x) / half);
    const round = Math.sqrt(1 - across * across), shine = Math.exp(-(((x / half + 0.35) / 0.3) ** 2)) * spec.gloss;
    return { colour: shadedColour(spec.style.base, 0.72 + 0.28 * round + shine), relief: 0.06 * (1 - across * across),
      roughness: 0.5 - spec.gloss * 0.3, tint: spec.style.tint, translucency: 0.35 + 0.3 * (1 - round) };
  },
  shadow: 0.35
});
