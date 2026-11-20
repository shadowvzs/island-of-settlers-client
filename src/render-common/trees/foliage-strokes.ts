import { smoothstep } from "../../shared/world/noise";
import { type AtlasCanvas,darkenPixel, writePixel } from "./atlas-canvas";

export type Rgb = readonly [number, number, number];

/** Pixel rectangle of one atlas cell; strokes are given in cell coordinates. */
export interface CellArea {
  height: number;
  width: number;
  x: number;
  y: number;
}

const isInside = (area: CellArea, x: number, y: number) =>
  x >= 0 && y >= 0 && x < area.width && y < area.height;

export interface LeafStroke {
  /** Radians, 0 = +x; the leaf points from (x, y) at its stalk towards the tip. */
  angle: number;
  color: Rgb;
  /**
   * Blade folded along the midrib: the +across half is lit by this share, the other half shaded
   * by it (unset: flat).
   */
  fold?: number;
  /** Stacking height: later leaves sit on top of earlier ones. */
  layer: number;
  length: number;
  /** Rounded lobes per side of an obovate blade (oak); 0 or unset: a smooth margin. */
  lobes?: number;
  /** Darker margin (share) that outlines the blade against the leaves behind it; unset: none. */
  rim?: number;
  /** 0 slender lanceolate .. 1 broad ovate. */
  roundness: number;
  /** Painted waxy highlight on the lit half of a glossy blade (0 matte .. 1 glossy). */
  sheen?: number;
  /** Ageing: share of the blade with brown speckles and a yellowed margin (0 / unset: healthy). */
  spots?: number;
  surface: number;
  /** Large teeth per side of a double serrated, ovate-acuminate blade (birch, shrubs); unset: none. */
  teeth?: number;
  /** Tooth depth as a share of the half width (default 0.16; small teeth half of it). */
  toothDepth?: number;
  /** Paler underside of a turned leaf: raised, lighter vein network. */
  underside?: boolean;
  /** Secondary vein pairs (default: lobes, else 7). */
  veins?: number;
  /** Serrated blade: widest point along the blade (default 0.3: birch). */
  widest?: number;
  width: number;
  x: number;
  y: number;
}

/** Half width at `along` (0 stalk .. 1 tip): broad body, drawn-out tip, a soft wavy margin. */
const getLeafHalfWidth = (along: number, roundness: number) => {
  if (along <= 0 || along >= 1) return 0;
  const body = Math.pow(
    Math.sin(Math.PI * Math.pow(along, 0.62 + roundness * 0.2)),
    0.75 + (1 - roundness) * 0.6
  );
  const tip = 1 - smoothstep(0.75, 1, along) * 0.4;
  return body * tip * (1 + Math.sin(along * 37) * 0.025);
};

/**
 * Oak margin: rounded lobes with narrow sinuses cut about halfway to the midrib; the two sides
 * are offset a little and the lobes shrink towards the base and the tip.
 */
const getLobeScale = (along: number, lobes: number, side: number) => {
  const phase = along * lobes + 0.35 + side * 0.18;
  const lobe = Math.sqrt(Math.abs(Math.sin(Math.PI * phase)));
  const depth = 0.58 * smoothstep(0.05, 0.25, along) * (1 - smoothstep(0.82, 1, along) * 0.6);
  return 1 - depth + depth * lobe;
};

/**
 * Oak blade outline: obovate (widest beyond the middle), a narrow wedge base with two small ear
 * lobes beside the short stalk, a broad rounded tip.
 */
const getObovateHalfWidth = (along: number) => {
  if (along <= 0 || along >= 1) return 0;
  const body = Math.pow(Math.sin(Math.PI * Math.pow(along, 1.45)), 0.7);
  const ears = 0.2 * Math.exp(-(((along - 0.06) / 0.04) ** 2));
  return Math.min(1, body + ears);
};

/**
 * Serrated blade: a rounded base, widest at `widest`, then straight sides (birch: triangular-ovate)
 * or, for blades widest further out, convex sides closing into an acute tip (hazel, hornbeam,
 * willow); a double serrated margin: sharp large teeth leaning towards the tip, a small one between.
 */
const getSerratedHalfWidth = (along: number, leaf: LeafStroke) => {
  if (along <= 0 || along >= 1) return 0;
  const widest = leaf.widest ?? 0.3;
  const base = Math.pow(Math.sin(Math.min(1, along / widest) * Math.PI * 0.5), 0.6);
  const toTip = Math.max(0, (1 - along) / (1 - widest));
  const straight = Math.pow(toTip, 1.2);
  const convex = Math.pow(Math.sin(Math.min(1, toTip) * Math.PI * 0.5), 1.15);
  const taper = along <= widest ? 1 : straight + (convex - straight) * smoothstep(0.3, 0.4, widest);
  const phase = along * (leaf.teeth ?? 0);
  const large = Math.pow(phase - Math.floor(phase), 1.6);
  const small = Math.pow(phase * 2 - Math.floor(phase * 2), 1.6);
  const depth = leaf.toothDepth ?? 0.16;
  const edge = smoothstep(0.08, 0.2, along) * (1 - smoothstep(0.92, 1, along));
  return base * taper * (1 - edge * depth * (large + small * 0.45));
};

const getBladeHalfWidth = (leaf: LeafStroke, along: number, across: number) => {
  if (leaf.teeth) return getSerratedHalfWidth(along, leaf);
  const asymmetry = 1 - .08 * (.25 + along * .75) * (leaf.surface % 7) / 6 *
    Math.max(0, Math.sign(across));
  if (!leaf.lobes) return getLeafHalfWidth(along, leaf.roundness) * asymmetry;
  return getObovateHalfWidth(along) * getLobeScale(along, leaf.lobes, Math.sign(across)) * asymmetry;
};

/** Smooth 0..1 lattice noise in pixels (mottling, speckles): baked once, not on a sim path. */
const hash = (x: number, y: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const latticeNoise = (x: number, y: number) => {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fx = smoothstep(0, 1, x - cellX);
  const fy = smoothstep(0, 1, y - cellY);
  const top = hash(cellX, cellY) + (hash(cellX + 1, cellY) - hash(cellX, cellY)) * fx;
  const bottom = hash(cellX, cellY + 1) + (hash(cellX + 1, cellY + 1) - hash(cellX, cellY + 1)) * fx;
  return top + (bottom - top) * fy;
};

/** Vein strengths (0..1) of a blade pixel: midrib, secondary veins and the fine net between. */
interface VeinField {
  midrib: number;
  net: number;
  vein: number;
}

/**
 * Pinnate venation: a midrib tapering to the tip, paired secondary veins that leave it at an
 * angle and arc towards the tip near the margin (into the lobes / teeth), and a faint reticulate
 * net between them. Widths are in pixels, so veins stay one to two pixels wide on every cell.
 */
const getVeins = (leaf: LeafStroke, point: LeafPoint): VeinField => {
  const halfPixels = Math.max(1, point.half * leaf.width);
  const fromMidrib = Math.abs(point.across) * halfPixels;
  const midribWidth = Math.max(0.55, leaf.width * 0.045 * (1 - point.along * 0.75));
  const midrib = smoothstep(midribWidth + 0.7, midribWidth - 0.3, fromMidrib);
  const pairs = leaf.veins ?? (leaf.lobes || 7);
  const side = Math.abs(point.across);
  const phase = point.along * pairs - Math.pow(side, 0.85) * 1.15 + (point.across > 0 ? 0.18 : 0);
  const spacing = leaf.length / pairs;
  const distance = Math.abs(phase - Math.round(phase)) * spacing * 0.75;
  const width = Math.max(0.45, leaf.width * 0.016);
  const fade = smoothstep(0.96, 0.6, side) * smoothstep(0.02, 0.1, point.along);
  const vein = smoothstep(width + 0.8, width - 0.2, distance) * fade * (1 - midrib);
  const cell = Math.max(2.5, spacing * 0.32);
  const netX = Math.abs(Math.sin((point.x + latticeNoise(point.y / cell, point.x / cell) * cell) * 2.4 / cell));
  const netY = Math.abs(Math.sin((point.y + latticeNoise(point.x / cell, point.y / cell) * cell) * 2.4 / cell));
  const net = smoothstep(0.12, 0.0, Math.min(netX, netY)) * fade * (1 - vein) * (1 - midrib);
  return { midrib, net, vein };
};

/** A blade pixel: across -1..1 (relative to the local half width), inside: pixels to the edge. */
interface LeafPoint {
  across: number;
  along: number;
  /** Local half width (share of `width`). */
  half: number;
  inside: number;
  x: number;
  y: number;
}

/** Fold light on the two halves of the blade and the darker outline (1 where unset). */
const getBladeTone = (leaf: LeafStroke, point: LeafPoint) => {
  const fold = 1 + (leaf.fold ?? 0) * smoothstep(-0.25, 0.25, point.across) * 2 - (leaf.fold ?? 0);
  const rim = 1 - (leaf.rim ?? 0) * (1 - smoothstep(0, 1.8, point.inside));
  return fold * rim;
};

/** Vein colour: lighter and yellower than the blade (more so on a turned underside). */
const VEIN_LIGHT: Rgb = [1.32, 1.24, 0.82];
const SPOT: Rgb = [0.2, 0.11, 0.03];
const AGED_MARGIN: Rgb = [0.3, 0.24, 0.05];

/** Waxy highlight band on the lit half, strongest mid-blade (glossy leaves only). */
const getSheen = (leaf: LeafStroke, point: LeafPoint) => {
  if (!leaf.sheen) return 0;
  const band = Math.exp(-(((point.across - 0.38) / 0.28) ** 2));
  return leaf.sheen * band * Math.sin(Math.PI * point.along) * 0.5;
};

/** Brown speckles and a dry yellow-brown margin on ageing leaves. */
const getAgeing = (leaf: LeafStroke, point: LeafPoint) => {
  if (!leaf.spots) return { margin: 0, spot: 0 };
  const speckle = latticeNoise(point.x * 0.45 + leaf.surface * 3.1, point.y * 0.45);
  return {
    margin: leaf.spots * (1 - smoothstep(0, 3.5, point.inside)),
    spot: smoothstep(1 - leaf.spots * 0.35, 1 - leaf.spots * 0.3, speckle)
  };
};

const mixRgb = (from: Rgb, to: Rgb, amount: number): Rgb => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount
];

/** Blade colour of one pixel: tone, mottling, veins, sheen and ageing over the leaf colour. */
const getLeafPixelColor = (leaf: LeafStroke, point: LeafPoint, veins: VeinField): Rgb => {
  const mottle = 0.93 + latticeNoise(point.x * 0.16 + leaf.surface, point.y * 0.16) * 0.14;
  const tone = (0.8 + point.along * 0.16 + (1 - Math.abs(point.across)) * 0.1) *
    (1 - veins.net * 0.07) * mottle * getBladeTone(leaf, point);
  const lamina: Rgb = [leaf.color[0] * tone, leaf.color[1] * tone, leaf.color[2] * tone * 0.95];
  const veinShare = (veins.midrib * 0.75 + veins.vein * 0.45) * (leaf.underside ? 1.35 : 1);
  const veined = mixRgb(lamina, [lamina[0] * VEIN_LIGHT[0], lamina[1] * VEIN_LIGHT[1],
    lamina[2] * VEIN_LIGHT[2]], Math.min(1, veinShare));
  const sheen = getSheen(leaf, point);
  const glossy: Rgb = [veined[0] + sheen * 0.1, veined[1] + sheen * 0.12, veined[2] + sheen * 0.09];
  const ageing = getAgeing(leaf, point);
  return mixRgb(mixRgb(glossy, AGED_MARGIN, ageing.margin * 0.7), SPOT, ageing.spot * 0.8);
};

const paintLeafPixel = (
  canvas: AtlasCanvas,
  area: CellArea,
  leaf: LeafStroke,
  point: LeafPoint
) => {
  const veins = getVeins(leaf, point);
  const lengthCurve = Math.sin(Math.PI * point.along);
  const dome = (1 - point.across * point.across) * lengthCurve;
  const veinRelief = leaf.underside ? 0.03 : -0.02;
  writePixel(canvas, area.x + point.x, area.y + point.y, {
    color: getLeafPixelColor(leaf, point, veins),
    coverage: Math.min(1, point.inside + 0.5),
    relief: leaf.layer + dome * .38 + veins.midrib * .07 + veins.vein * veinRelief +
      (leaf.fold ?? .035) * point.across * lengthCurve,
    surface: leaf.surface
  });
};

/** Visits every cell pixel the blade covers (with a half pixel anti-aliased fringe). */
const forEachBladePixel = (area: CellArea, leaf: LeafStroke, visit: (point: LeafPoint) => void) => {
  const cos = Math.cos(leaf.angle);
  const sin = Math.sin(leaf.angle);
  const reach = Math.ceil(leaf.length + leaf.width);
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const x = Math.round(leaf.x) + dx;
      const y = Math.round(leaf.y) + dy;
      if (!isInside(area, x, y)) continue;
      const along = (dx * cos + dy * sin) / leaf.length;
      const across = (-dx * sin + dy * cos) / leaf.width;
      const halfWidth = getBladeHalfWidth(leaf, along, across);
      if (halfWidth <= 0) continue;
      const inside = (halfWidth - Math.abs(across)) * leaf.width;
      if (inside < -0.5) continue;
      visit({ across: across / halfWidth, along, half: halfWidth, inside, x, y });
    }
  }
};

/** One leaf blade with stacking, veins and a domed relief (for the normal map). */
export const paintLeaf = (canvas: AtlasCanvas, area: CellArea, leaf: LeafStroke) =>
  forEachBladePixel(area, leaf, (point) => paintLeafPixel(canvas, area, leaf, point));

/**
 * Soft contact shadow of a blade on what is already painted below it (leaves, twigs), offset
 * away from the light, so overlapping leaves separate; empty pixels stay empty.
 */
export const paintLeafShadow = (
  canvas: AtlasCanvas,
  area: CellArea,
  leaf: LeafStroke,
  shadow: { offset: readonly [number, number]; strength: number }
) => {
  const cast = { ...leaf, x: leaf.x + shadow.offset[0], y: leaf.y + shadow.offset[1] };
  forEachBladePixel(area, cast, (point) =>
    darkenPixel(
      canvas,
      area.x + point.x,
      area.y + point.y,
      1 - shadow.strength * smoothstep(-0.5, 3, point.inside)
    )
  );
};

export interface StemStroke {
  color: Rgb;
  from: readonly [number, number];
  layer: number;
  surface: number;
  /** Radius at the start and at the end (pixels). */
  thickness: readonly [number, number];
  to: readonly [number, number];
}

/** Round tapering stroke (twig, rachis, needle) shaded across its width. */
export const paintStem = (canvas: AtlasCanvas, area: CellArea, stem: StemStroke) => {
  const [fromX, fromY] = stem.from;
  const dirX = stem.to[0] - fromX;
  const dirY = stem.to[1] - fromY;
  const lengthSquared = Math.max(1e-6, dirX * dirX + dirY * dirY);
  const reach = Math.max(...stem.thickness) + 1;
  const minX = Math.floor(Math.min(fromX, stem.to[0]) - reach);
  const maxX = Math.ceil(Math.max(fromX, stem.to[0]) + reach);
  const minY = Math.floor(Math.min(fromY, stem.to[1]) - reach);
  const maxY = Math.ceil(Math.max(fromY, stem.to[1]) + reach);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!isInside(area, x, y)) continue;
      const t = Math.min(1, Math.max(0, ((x - fromX) * dirX + (y - fromY) * dirY) / lengthSquared));
      const distance = Math.hypot(x - fromX - dirX * t, y - fromY - dirY * t);
      const radius = stem.thickness[0] + (stem.thickness[1] - stem.thickness[0]) * t;
      const coverage = Math.min(1, radius - distance + 0.5);
      if (coverage <= 0) continue;
      const round = Math.sqrt(Math.max(0, 1 - (distance / Math.max(radius, 0.5)) ** 2));
      const shade = 0.72 + round * 0.38;
      writePixel(canvas, area.x + x, area.y + y, {
        color: [stem.color[0] * shade, stem.color[1] * shade, stem.color[2] * shade],
        coverage,
        relief: stem.layer + round * 0.2,
        surface: stem.surface
      });
    }
  }
};
