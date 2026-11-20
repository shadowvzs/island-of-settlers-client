import { hashTexel } from "../../../src/render-common/materials/tile-canvas";
import { type FoliageElement, paintElement, type Rgb, shadedColour, type TilePainter } from "./foliage-canvas";
import { cellBorderDistance, clamp01, fractalNoise, mix, ridge, smoothstep, veinProfile } from "./foliage-noise";
import { bezierAngle, bezierPoint, paintPrickle, paintStem, type Point, type StemStyle } from "./stem-art";

export interface LeafStyle {
  base: Rgb;
  /** Vein colour multiplier (pale, slightly yellow midrib and laterals). */
  vein: Rgb;
  tint: number;
}

/** Neutral, palette-tinted rose foliage (vertex tint supplies the green). */
export const TINTED_ROSE_LEAF: LeafStyle = { base: [0.84, 0.84, 0.81], tint: 1, vein: [1.34, 1.3, 0.94] };
/** Baked natural rose green for mixed tiles (sRGB about #4C7A30). */
export const BAKED_ROSE_LEAF: LeafStyle = { base: [0.08, 0.21, 0.03], tint: 0, vein: [1.75, 1.55, 1.15] };
export const ROSE_CANE: StemStyle = { base: [0.1, 0.13, 0.03], roughness: 0.5, tint: 0, translucency: 0.2 };
export const ROSE_PRICKLE: StemStyle = { base: [0.3, 0.09, 0.035], roughness: 0.45, tint: 0, translucency: 0.15 };

/** Peak-normalized blade half-width y^a (1-y)^b: rounded base (a < 1), acute tip (b < 1). */
export const bladeHalfWidth = (y: number, width: number, baseExponent: number, tipExponent: number) => {
  if (y <= 0 || y >= 1) return 0;
  const peak = baseExponent / (baseExponent + tipExponent);
  const norm = Math.pow(peak, baseExponent) * Math.pow(1 - peak, tipExponent);
  return width * Math.pow(y, baseExponent) * Math.pow(1 - y, tipExponent) / norm;
};

/** Forward-pointing (towards the apex) serrate teeth: long slanted basal edge, short steep distal edge. */
const serrationCut = (y: number, teeth: number, depth: number, salt: number) => {
  const phase = y * teeth + 0.3, tooth = Math.floor(phase), p = phase - tooth;
  const profile = p < 0.78 ? Math.pow(p / 0.78, 1.35) : Math.pow((1 - p) / 0.22, 0.85);
  const jitter = 0.7 + 0.6 * hashTexel(tooth, 3, salt);
  return depth * jitter * (1 - profile) * smoothstep(0.06, 0.24, y) * (1 - smoothstep(0.9, 0.985, y));
};

export interface LeafletSpec {
  frame: FoliageElement["frame"];
  salt: number;
  style: LeafStyle;
  teeth: number;
  width?: number;
}

const LATERAL_PAIRS = 8;

/** Pinnate lateral veins curving towards the apex, ending in marginal loops (pale core, dark flank). */
const lateralVeins = (x: number, y: number, across: number, salt: number, texel: number) => {
  const ax = Math.abs(x), curve = y - 0.62 * ax - 1.25 * ax * ax;
  const phase = curve * LATERAL_PAIRS - 0.35, index = Math.round(phase);
  const jitter = (hashTexel(index, x < 0 ? 1 : 2, salt) - 0.5) * 0.18;
  const slope = 0.62 + 2.5 * ax;
  const distance = Math.abs(phase - index - jitter) / LATERAL_PAIRS / Math.sqrt(1 + slope * slope);
  const inRange = index >= 1 && index <= LATERAL_PAIRS - 1 ? 1 : 0;
  const fade = (1 - smoothstep(0.72, 0.93, across)) * inRange;
  const profile = veinProfile(distance, 0.0085 * (1 - 0.55 * across), texel * 0.9);
  return { core: profile.core * fade, flank: profile.flank * fade };
};

/** One serrate rose leaflet: impressed midrib and laterals, rugose areoles, slight fold. */
export const roseLeafletElement = (spec: LeafletSpec): FoliageElement => {
  const width = spec.width ?? 0.3;
  const margin = (y: number) => bladeHalfWidth(y, width, 0.55, 0.85) - serrationCut(y, spec.teeth, 0.032, spec.salt);
  return {
    bounds: [-width * 1.1, -0.02, width * 1.1, 1.02],
    distance: (x, y) => Math.max(Math.abs(x) - margin(y), -y * 0.5, (y - 1) * 0.5),
    frame: spec.frame,
    shade: (x, y, _distance, texel) => {
      const half = Math.max(1e-4, bladeHalfWidth(y, width, 0.55, 0.85)), across = clamp01(Math.abs(x) / half);
      const midrib = veinProfile(Math.abs(x), 0.012 * (1 - 0.7 * y) + 0.0025, texel * 1.1);
      const lateral = lateralVeins(x, y, across, spec.salt, texel);
      const areole = ridge(cellBorderDistance(x * 34, y * 34, spec.salt), 0.07) * (1 - across * 0.4);
      const vein = Math.max(midrib.core, lateral.core * 0.92, areole * 0.2);
      const groove = Math.max(midrib.flank, lateral.flank * 0.85);
      const mottle = fractalNoise(x * 5 + spec.salt, y * 5, spec.salt) * 0.16;
      const edge = smoothstep(0.7, 1, across), base = 1 - smoothstep(0, 0.12, y);
      const luminance = (0.92 + mottle - edge * 0.12) * (1 - 0.22 * base);
      // Impressed veins: the pale vein itself stays bright, its groove walls take the shade.
      const occlusion = 1 - 0.2 * groove - 0.04 * vein - 0.18 * base;
      const veinColour = spec.style.vein.map(channel => mix(1, channel, vein)) as unknown as Rgb;
      const colour = shadedColour(spec.style.base, luminance, occlusion);
      return {
        colour: [colour[0] * veinColour[0], colour[1] * veinColour[1], colour[2] * veinColour[2]],
        relief: 0.012 * Math.sqrt(1 - across * across) + 0.01 * across - 0.014 * midrib.core -
          0.008 * lateral.core - 0.004 * groove - 0.0012 * areole - 0.004 * edge * edge,
        roughness: 0.4 + 0.18 * vein + fractalNoise(x * 40, y * 40, spec.salt + 5) * 0.08,
        tint: spec.style.tint,
        translucency: 0.82 - 0.55 * midrib.core - 0.3 * lateral.core + 0.1 * edge
      };
    }
  };
};

/** Fringed (glandular-ciliate) stipule wing at the petiole base. */
const stipuleElement = (frame: FoliageElement["frame"], style: LeafStyle, salt: number): FoliageElement => {
  const fringe = (y: number) => 0.035 * Math.pow(Math.abs(Math.sin(y * 34 + salt)), 3);
  const margin = (y: number) => bladeHalfWidth(y, 0.2, 0.9, 0.55) - fringe(y);
  return {
    bounds: [-0.25, -0.02, 0.25, 1.02],
    distance: (x, y) => Math.max(Math.abs(x) - margin(y), -y * 0.5, (y - 1) * 0.5),
    frame,
    shade: (x, y) => ({ colour: shadedColour(style.base, 0.95 - 0.15 * Math.abs(x) / 0.2 + 0.1 * y),
      relief: 0.01 * (1 - Math.abs(x) / 0.2), roughness: 0.5, tint: style.tint, translucency: 0.85 }),
    shadow: 0.18
  };
};

export interface CompoundLeafSpec {
  angle: number;
  leaflets: 5 | 7;
  length: number;
  origin: Point;
  salt: number;
  style: LeafStyle;
}

interface LeafletPlacement { along: number; angle: number; size: number }

const leafletPlacements = (leaflets: 5 | 7): LeafletPlacement[] => leaflets === 5
  ? [{ along: 0.36, angle: 1.12, size: 0.7 }, { along: 0.72, angle: 0.95, size: 0.86 }]
  : [{ along: 0.26, angle: 1.18, size: 0.6 }, { along: 0.53, angle: 1.04, size: 0.74 },
    { along: 0.8, angle: 0.9, size: 0.86 }];

/** Odd-pinnate rose leaf: stipules, rachis, opposite leaflet pairs and a terminal leaflet. */
export const paintCompoundLeaf = (painter: TilePainter, spec: CompoundLeafSpec) => {
  const rachisLength = spec.length * (spec.leaflets === 5 ? 0.5 : 0.56);
  const bend = (hashTexel(spec.salt, 9, 1) - 0.5) * 0.08 * spec.length;
  const end: Point = [spec.origin[0] + Math.sin(spec.angle) * rachisLength,
    spec.origin[1] + Math.cos(spec.angle) * rachisLength];
  const middle: Point = [(spec.origin[0] + end[0]) / 2 + Math.cos(spec.angle) * bend,
    (spec.origin[1] + end[1]) / 2 - Math.sin(spec.angle) * bend];
  const curve = [spec.origin, middle, end] as const;
  const terminal = spec.length - rachisLength * 0.96, leafletLength = terminal * 0.98;
  for (const side of [-1, 1]) {
    paintElement(painter, stipuleElement({ angle: spec.angle + side * 0.32, length: spec.length * 0.13,
      mirror: side < 0, origin: spec.origin }, spec.style, spec.salt + side));
  }
  leafletPlacements(spec.leaflets).forEach((placement, pair) => {
    const at = bezierPoint(curve, placement.along), axis = bezierAngle(curve, placement.along);
    for (const side of [-1, 1]) {
      paintElement(painter, roseLeafletElement({
        frame: { angle: axis + side * placement.angle, length: leafletLength * placement.size,
          mirror: side < 0,
          origin: [at[0] + Math.sin(axis + side * 1.5) * 0.006, at[1] + Math.cos(axis + side * 1.5) * 0.006] },
        salt: spec.salt * 31 + pair * 2 + (side > 0 ? 1 : 0), style: spec.style, teeth: 17 + pair * 2
      }));
    }
  });
  paintElement(painter, roseLeafletElement({
    frame: { angle: bezierAngle(curve, 1), length: leafletLength, origin: end },
    salt: spec.salt * 31 + 17, style: spec.style, teeth: 24, width: 0.32 }));
  paintStem(painter, { curve, radius: [spec.length * 0.016, spec.length * 0.008], salt: spec.salt,
    style: { base: spec.style.base, roughness: 0.5, tint: spec.style.tint, translucency: 0.3 }, shadow: 0.18 });
};

/** A short leafy cane with three alternate compound leaves and hooked prickles. */
export const paintRoseLeafSpray = (painter: TilePainter, salt: number) => {
  const cane = [[0.5, 0.03], [0.57, 0.5], [0.47, 0.86]] as const;
  const leaves = [{ along: 0.2, angle: 0.95, length: 0.47 }, { along: 0.5, angle: -0.9, length: 0.47 },
    { along: 0.78, angle: 0.55, length: 0.27 }];
  leaves.forEach((leaf, index) => {
    const at = bezierPoint(cane, leaf.along);
    paintCompoundLeaf(painter, { angle: bezierAngle(cane, leaf.along) + leaf.angle, leaflets: 5,
      length: leaf.length, origin: at, salt: salt + index * 5, style: TINTED_ROSE_LEAF });
  });
  paintStem(painter, { curve: cane, radius: [0.016, 0.009], salt, style: ROSE_CANE });
  for (let index = 0; index < 7; index += 1) {
    const along = 0.08 + index * 0.13, side = index % 2 ? 1 : -1;
    paintPrickle(painter, { angle: bezierAngle(cane, along) + side * 2.1, length: 0.028,
      origin: bezierPoint(cane, along), style: ROSE_PRICKLE });
  }
};
