import { hashTexel } from "../../../src/render-common/materials/tile-canvas";
import { type ElementFrame, type FoliageElement, paintElement, type Rgb, shadedColour,
  type TilePainter } from "./foliage-canvas";
import { cellBorderDistance, clamp01, fractalNoise, mix, ridge, smoothstep, veinProfile } from "./foliage-noise";
import { bezierAngle, bezierPoint, paintStem, type Point, type StemStyle } from "./stem-art";

/** One lobe of the polar outline: direction, reach, angular half-width and tip sharpness. */
interface Lobe { angle: number; exponent: number; reach: number; spread: number }

export type IvyLeafForm = "juvenile-3" | "juvenile-5" | "adult";

interface IvyLeafShape { lobes: Lobe[]; notch: number; palm: number; veins: number[] }

const mirrored = (angle: number, reach: number, spread: number, exponent = 0.8): Lobe[] =>
  [{ angle: -angle, exponent, reach, spread }, { angle, exponent, reach, spread }];

/** Hedera helix: juvenile leaves palmately 3-5 lobed, adult (flowering) leaves ovate-rhombic, unlobed. */
const IVY_SHAPES: Record<IvyLeafForm, IvyLeafShape> = {
  "juvenile-3": { lobes: [{ angle: 0, exponent: 0.95, reach: 1, spread: 0.85 }, ...mirrored(1.15, 0.74, 0.8, 0.95),
    ...mirrored(2.2, 0.46, 0.75, 2)], notch: 0.8, palm: 0.42, veins: [0, -1.15, 1.15, -2.15, 2.15] },
  "juvenile-5": { lobes: [{ angle: 0, exponent: 0.9, reach: 1, spread: 0.64 }, ...mirrored(0.95, 0.8, 0.6, 0.9),
    ...mirrored(1.9, 0.56, 0.58, 1)], notch: 0.82, palm: 0.4, veins: [0, -0.95, 0.95, -1.9, 1.9] },
  adult: { lobes: [{ angle: 0, exponent: 0.85, reach: 1, spread: 0.55 },
    { angle: 0, exponent: 0.5, reach: 0.6, spread: 2.3 }],
    notch: 0.45, palm: 0.22, veins: [0, -0.75, 0.75] }
};

const softMax = (a: number, b: number) => {
  const high = Math.max(a, b);
  return high + Math.log(Math.exp((a - high) * 32) + Math.exp((b - high) * 32)) / 32;
};

const outlineRadius = (shape: IvyLeafShape, theta: number) => {
  let radius = shape.palm;
  for (const lobe of shape.lobes) {
    const offset = Math.abs(theta - lobe.angle);
    radius = softMax(radius, lobe.reach * Math.pow(Math.max(0, 1 - offset / lobe.spread), lobe.exponent));
  }
  return radius * (1 - shape.notch * Math.exp(-(((Math.PI - Math.abs(theta)) / 0.32) ** 2)));
};

const segmentDistance = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay, t = clamp01(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1e-9));
  return { distance: Math.hypot(x - ax - dx * t, y - ay - dy * t), t };
};

/** Palmate main veins into every lobe, three secondary veins on each side of them (pale core, dark flank). */
const ivyVeins = (shape: IvyLeafShape, x: number, y: number, texel: number) => {
  let main = 0, secondary = 0, flank = 0;
  for (const angle of shape.veins) {
    const reach = outlineRadius(shape, angle) * 0.9, tx = Math.sin(angle) * reach, ty = Math.cos(angle) * reach;
    const along = segmentDistance(x, y, 0, 0, tx, ty);
    const primary = veinProfile(along.distance, 0.012 * (1 - 0.65 * along.t) + 0.0025, texel * 0.9);
    main = Math.max(main, primary.core); flank = Math.max(flank, primary.flank);
    for (const at of [0.3, 0.52, 0.72]) for (const side of [-1, 1]) {
      const sx = tx * at, sy = ty * at, branch = angle + side * 0.78, length = reach * 0.34 * (1 - at * 0.5);
      const twig = segmentDistance(x, y, sx, sy, sx + Math.sin(branch) * length, sy + Math.cos(branch) * length);
      const minor = veinProfile(twig.distance, 0.0068 * (1 - 0.55 * twig.t) + 0.0018, texel * 0.5);
      secondary = Math.max(secondary, minor.core); flank = Math.max(flank, minor.flank * 0.8);
    }
  }
  return { flank: flank * (1 - Math.max(main, secondary)), main, secondary };
};

export interface IvyStyle {
  base: Rgb;
  /** Baked pale vein colour the veins fade towards (tint is reduced on veins). */
  vein: Rgb;
  /** 0..1: how strongly veins leave the palette tint (whitish juvenile veins). */
  veinPallor: number;
}

export const TINTED_IVY: IvyStyle = { base: [0.84, 0.84, 0.8], vein: [0.92, 0.95, 0.76], veinPallor: 0.55 };
/** Small cluster leaves: the minimum-width veins cover more of the blade, so they pale less. */
const TINTED_CLUSTER_IVY: IvyStyle = { ...TINTED_IVY, veinPallor: 0.4 };
export const TINTED_ADULT_IVY: IvyStyle = { base: [0.84, 0.84, 0.8], vein: [0.9, 0.92, 0.72], veinPallor: 0.42 };
export const IVY_STEM: StemStyle = { base: [0.1, 0.07, 0.035], roughness: 0.6, tint: 0, translucency: 0.1 };
const IVY_PETIOLE: StemStyle = { base: [0.42, 0.4, 0.3], roughness: 0.45, tint: 0.6, translucency: 0.3 };
const IVY_ROOTLET: StemStyle = { base: [0.26, 0.2, 0.11], roughness: 0.7, tint: 0, translucency: 0.1 };

export interface IvyLeafSpec {
  form: IvyLeafForm;
  frame: ElementFrame;
  /** Luminance multiplier (young leaves lighter). */
  light?: number;
  salt: number;
  style: IvyStyle;
}

/** Glossy, leathery ivy leaf with pale palmate venation and a cordate base around the petiole. */
export const ivyLeafElement = (spec: IvyLeafSpec): FoliageElement => {
  const shape = IVY_SHAPES[spec.form], light = spec.light ?? 1;
  return {
    bounds: [-1, -0.6, 1, 1.02],
    distance: (x, y) => Math.hypot(x, y) - outlineRadius(shape, Math.atan2(x, y)),
    frame: spec.frame,
    shade: (x, y, signed, texel) => {
      const radius = Math.hypot(x, y), extent = Math.max(1e-4, outlineRadius(shape, Math.atan2(x, y)));
      const reach = clamp01(radius / extent), veins = ivyVeins(shape, x, y, texel);
      const areole = ridge(cellBorderDistance(x * 26, y * 26, spec.salt), 0.08) * 0.35;
      const vein = Math.max(veins.main, veins.secondary * 0.82, areole * 0.35);
      const margin = 1 - smoothstep(0, 0.03, -signed);
      const mottle = fractalNoise(x * 4 + spec.salt, y * 4, spec.salt) * 0.16;
      const pallor = spec.style.veinPallor * vein;
      const blade = shadedColour(spec.style.base, light * (0.9 + mottle + 0.08 * margin) * (1 - 0.12 * (1 - reach)),
        1 - 0.16 * veins.flank);
      return {
        colour: blade.map((channel, index) => mix(channel, spec.style.vein[index]!, pallor)) as unknown as Rgb,
        relief: 0.012 * (1 - reach * reach) - 0.007 * veins.main - 0.0035 * veins.secondary -
          0.002 * veins.flank + 0.004 * margin,
        roughness: 0.28 + 0.14 * vein + fractalNoise(x * 30, y * 30, spec.salt + 4) * 0.06,
        tint: 1 - pallor,
        translucency: 0.45 - 0.25 * veins.main + 0.15 * margin
      };
    },
    shadow: 0.38
  };
};

/** Single leaf card: short petiole stub from the pivot into the cordate base. */
export const paintIvyLeaf = (painter: TilePainter, form: IvyLeafForm, salt: number) => {
  const reach = form === "adult" ? 0.7 : 0.6, insertion: Point = [0.5, form === "adult" ? 0.2 : 0.3];
  paintStem(painter, { curve: [[0.5, 0.035], [0.49, 0.12], insertion], radius: [0.012, 0.009], salt,
    style: IVY_PETIOLE, shadow: 0 });
  paintElement(painter, ivyLeafElement({ form, frame: { angle: 0.02, length: reach, origin: insertion }, salt,
    style: form === "adult" ? TINTED_ADULT_IVY : TINTED_IVY }));
};

interface ClusterLeaf { along: number; form: IvyLeafForm; petiole: number; side: number; size: number; turn: number }

const clusterLeaves = (count: number, salt: number): ClusterLeaf[] => Array.from({ length: count }, (_, index) => {
  const random = (channel: number) => hashTexel(index, channel, salt);
  const along = 0.12 + (index + 0.3 * random(1)) / count * 0.8, side = index % 2 ? 1 : -1;
  return { along, form: random(2) < 0.55 ? "juvenile-3" : "juvenile-5", petiole: 0.05 + random(3) * 0.08, side,
    size: (count > 5 ? 0.25 : 0.33) * (1 - along * 0.28) * (0.88 + random(4) * 0.24),
    turn: side * (0.45 + random(5) * 0.45) };
});

const paintRootlets = (painter: TilePainter, stem: readonly [Point, Point, Point], salt: number) => {
  for (let node = 0; node < 9; node += 1) for (let hair = 0; hair < 4; hair += 1) {
    const along = 0.06 + node * 0.105 + hair * 0.012, at = bezierPoint(stem, along);
    const angle = bezierAngle(stem, along) + (node % 2 ? 1 : -1) * (2 + hashTexel(node, hair, salt) * 0.7);
    const length = 0.025 + hashTexel(hair, node, salt + 1) * 0.02;
    paintStem(painter, { curve: [at, [at[0] + Math.sin(angle) * length * 0.6, at[1] + Math.cos(angle) * length * 0.6],
      [at[0] + Math.sin(angle + 0.3) * length, at[1] + Math.cos(angle + 0.3) * length]],
    radius: [0.003, 0.0015], salt: salt + node, style: IVY_ROOTLET, shadow: 0 });
  }
};

/** Clinging stem with aerial rootlets and alternate juvenile leaves on petioles of different lengths. */
export const paintIvyCluster = (painter: TilePainter, count: number, salt: number) => {
  const stem = [[0.5, 0.03], [0.55, 0.5], [0.49, 0.93]] as const;
  paintRootlets(painter, stem, salt);
  paintStem(painter, { curve: stem, radius: [0.013, 0.008], salt, style: IVY_STEM, shadow: 0.2 });
  const leaves = clusterLeaves(count, salt);
  for (const leaf of leaves) {
    const node = bezierPoint(stem, leaf.along), heading = bezierAngle(stem, leaf.along) + leaf.side * 0.8;
    const insertion: Point = [node[0] + Math.sin(heading) * leaf.petiole, node[1] + Math.cos(heading) * leaf.petiole];
    paintStem(painter, { curve: [node, [(node[0] + insertion[0]) / 2, (node[1] + insertion[1]) / 2 + 0.01], insertion],
      radius: [0.007, 0.005], salt, style: IVY_PETIOLE, shadow: 0.15 });
  }
  leaves.forEach((leaf, index) => {
    const node = bezierPoint(stem, leaf.along), heading = bezierAngle(stem, leaf.along) + leaf.side * 0.8;
    const insertion: Point = [node[0] + Math.sin(heading) * leaf.petiole, node[1] + Math.cos(heading) * leaf.petiole];
    paintElement(painter, ivyLeafElement({ form: leaf.form, frame: { angle: leaf.turn, length: leaf.size,
      mirror: leaf.side < 0, origin: insertion }, light: 0.92 + leaf.along * 0.3, salt: salt + index * 3,
    style: TINTED_CLUSTER_IVY }));
  });
};
