import { hashTexel } from "../../../src/render-common/materials/tile-canvas";
import { type ElementFrame, type FoliageElement, type FoliageSample, paintElement, type Rgb, shadedColour,
  type TilePainter } from "../climber-foliage/foliage-canvas";
import { cellBorderDistance, clamp01, fractalNoise, mix, ridge, smoothstep,
  veinProfile } from "../climber-foliage/foliage-noise";
import { bladeHalfWidth } from "../climber-foliage/rose-leaf-art";
import { paintStem, type Point, type StemStyle } from "../climber-foliage/stem-art";

/** Neutral, palette-tinted verge leaf tissue: the vertex tint supplies each species' green. */
export const VERGE_LEAF: Rgb = [0.84, 0.84, 0.8];
/** Pale vein multiplier (applied on the tinted green). */
const VEIN: Rgb = [1.32, 1.3, 0.96];
export const VERGE_PETIOLE: StemStyle = { base: [0.72, 0.74, 0.6], roughness: 0.5, tint: 1, translucency: 0.35 };

interface BladeShading {
  across: number;
  /** 0..1 vein strength (pale core). */
  vein: number;
  /** 0..1 groove flank strength (darker). */
  groove: number;
  x: number;
  y: number;
  salt: number;
}

/** Shared verge leaf surface: dome, pale veins in impressed grooves, mottle and a darker margin. */
const shadeBlade = ({ across, groove, salt, vein, x, y }: BladeShading, light = 1): FoliageSample => {
  const mottle = fractalNoise(x * 6 + salt, y * 6, salt) * 0.16;
  const edge = smoothstep(0.72, 1, across), base = 1 - smoothstep(0, 0.1, y);
  const luminance = light * (0.92 + mottle - edge * 0.12) * (1 - 0.18 * base);
  const colour = shadedColour(VERGE_LEAF, luminance, 1 - 0.2 * groove - 0.15 * base);
  return {
    colour: colour.map((channel, index) => channel * mix(1, VEIN[index]!, vein)) as unknown as Rgb,
    relief: 0.012 * Math.sqrt(1 - across * across) - 0.012 * vein - 0.004 * groove - 0.004 * edge * edge,
    roughness: 0.45 + 0.15 * vein + fractalNoise(x * 40, y * 40, salt + 5) * 0.08,
    tint: 1,
    translucency: 0.78 - 0.45 * vein + 0.1 * edge
  };
};

/** Greater plantain: broad ovate blade, 5-7 parallel arcuate veins meeting at base and tip. */
export const plantainLeafElement = (frame: ElementFrame, salt: number): FoliageElement => {
  const width = 0.36, half = (y: number) => bladeHalfWidth(y, width, 0.75, 0.62);
  const ribs = 3;
  return {
    bounds: [-width * 1.1, -0.02, width * 1.1, 1.02],
    distance: (x, y) => {
      const wave = 0.012 * Math.sin(y * 17 + salt) * smoothstep(0.2, 0.8, y);
      return Math.max(Math.abs(x) - half(y) + wave, -y * 0.5, (y - 1) * 0.5);
    },
    frame,
    shade: (x, y, _distance, texel) => {
      const extent = Math.max(1e-4, half(y)), across = clamp01(Math.abs(x) / extent);
      let vein = 0, groove = 0;
      for (let rib = 0; rib <= ribs; rib += 1) {
        const line = veinProfile(Math.abs(across - rib / (ribs + 0.6)) * extent,
          (rib === 0 ? 0.012 : 0.0075) * (1 - 0.5 * y), texel * 0.9);
        vein = Math.max(vein, line.core * (rib === 0 ? 1 : 0.85));
        groove = Math.max(groove, line.flank);
      }
      const cross = ridge(cellBorderDistance(x * 22, y * 30, salt), 0.06) * 0.25;
      return shadeBlade({ across, groove, salt, vein: Math.max(vein, cross), x, y });
    },
    shadow: 0.3
  };
};

/** Back-pointing (runcinate) lobe cut of a dandelion leaf margin. */
const runcinateCut = (y: number, salt: number) => {
  const phase = y * 4.6 + 0.2, lobe = Math.floor(phase), p = phase - lobe;
  const depth = 0.55 + 0.35 * hashTexel(lobe, 5, salt);
  const profile = p < 0.78 ? Math.pow(p / 0.78, 0.7) : Math.pow((1 - p) / 0.22, 1.6);
  return depth * (1 - profile) * smoothstep(0.12, 0.3, y) * (1 - smoothstep(0.82, 0.95, y));
};

/** Dandelion: oblanceolate, deeply runcinate-lobed leaf with a pale, rosy midrib. */
export const dandelionLeafElement = (frame: ElementFrame, salt: number): FoliageElement => {
  const width = 0.24, outer = (y: number) => bladeHalfWidth(y, width, 1.4, 0.55);
  const half = (y: number) => outer(y) * (1 - 0.72 * runcinateCut(y, salt)) + 0.018 * smoothstep(0.1, 0.3, y);
  return {
    bounds: [-width * 1.1, -0.02, width * 1.1, 1.02],
    distance: (x, y) => Math.max(Math.abs(x) - half(y), -y * 0.5, (y - 1) * 0.5),
    frame,
    shade: (x, y, _distance, texel) => {
      const extent = Math.max(1e-4, outer(y)), across = clamp01(Math.abs(x) / extent);
      const midrib = veinProfile(Math.abs(x), 0.016 * (1 - 0.6 * y) + 0.003, texel * 1.1);
      const lateral = Math.pow(0.5 + 0.5 * Math.cos((y * 4.6 + 0.2 - across * 0.35) * Math.PI * 2), 30) *
        (1 - smoothstep(0.5, 0.9, across)) * 0.45;
      const sample = shadeBlade({ across, groove: midrib.flank, salt, vein: Math.max(midrib.core, lateral), x, y });
      const rosy = midrib.core * (1 - smoothstep(0.1, 0.6, y));
      return { ...sample, colour: [sample.colour[0] * (1 + 0.5 * rosy), sample.colour[1] * (1 - 0.2 * rosy),
        sample.colour[2]], tint: 1 - 0.55 * rosy };
    },
    shadow: 0.3
  };
};

/** White-clover leaflet: obovate, notched tip, fine teeth and the pale chevron band. */
const cloverLeafletElement = (frame: ElementFrame, salt: number): FoliageElement => {
  const width = 0.36, half = (y: number) => bladeHalfWidth(y, width, 0.8, 0.28);
  return {
    bounds: [-width * 1.1, -0.02, width * 1.1, 1.02],
    distance: (x, y) => {
      const notch = 0.18 * Math.exp(-((x / 0.08) ** 2)) * smoothstep(0.85, 1, y);
      const teeth = 0.01 * Math.abs(Math.sin(y * 40 + salt));
      return Math.max(Math.abs(x) - half(y) + teeth, -y * 0.5, y - 1 + notch);
    },
    frame,
    shade: (x, y, _distance, texel) => {
      const extent = Math.max(1e-4, half(y)), across = clamp01(Math.abs(x) / extent);
      const midrib = veinProfile(Math.abs(x), 0.014, texel);
      const laterals = Math.pow(0.5 + 0.5 * Math.cos((y - Math.abs(x) * 0.9) * 26), 14) * (1 - across) * 0.55;
      const chevron = smoothstep(0.07, 0.02, Math.abs(y - 0.4 - Math.abs(x) * 0.75)) * (1 - across * 0.6);
      const sample = shadeBlade({ across, groove: midrib.flank, salt, vein: Math.max(midrib.core, laterals), x, y });
      const pale = 0.55 * chevron;
      return { ...sample, colour: sample.colour.map(channel => mix(channel, 0.8, pale)) as unknown as Rgb,
        tint: 1 - pale };
    },
    shadow: 0.25
  };
};

/** Trifoliate white-clover leaf on its petiole; the leaflets meet at `insertion`. */
export const paintCloverLeaf = (painter: TilePainter, origin: Point, insertion: Point, size: number, salt: number,
  turn = 0) => {
  paintStem(painter, { curve: [origin, [(origin[0] + insertion[0]) / 2 + 0.01, (origin[1] + insertion[1]) / 2],
    insertion], radius: [0.011 * size * 2.4, 0.008 * size * 2.4], salt, shadow: 0.15, style: VERGE_PETIOLE });
  for (const [index, angle] of [-2.05, 0, 2.05].entries()) {
    paintElement(painter, cloverLeafletElement({ angle: angle + turn, length: size, origin: insertion },
      salt * 7 + index));
  }
};

/** Linear grass blade with a slight bend, keeled midrib and fine parallel veins. */
export const grassBladeElement = (frame: ElementFrame, width: number, bend: number, salt: number): FoliageElement => {
  const centre = (y: number) => bend * y * y, half = (y: number) => bladeHalfWidth(y, width, 0.2, 0.9);
  return {
    bounds: [-width * 1.3 + Math.min(0, bend), -0.02, width * 1.3 + Math.max(0, bend), 1.02],
    distance: (x, y) => Math.max(Math.abs(x - centre(y)) - half(y), -y * 0.5, (y - 1) * 0.5),
    frame,
    shade: (x, y, _distance, texel) => {
      const extent = Math.max(1e-4, half(y)), offset = x - centre(y), across = clamp01(Math.abs(offset) / extent);
      const keel = veinProfile(Math.abs(offset), 0.004, texel * 0.8);
      const veins = Math.pow(0.5 + 0.5 * Math.cos(across * Math.PI * 5), 10) * 0.35;
      const tipDry = smoothstep(0.86, 1, y) * 0.25;
      const sample = shadeBlade({ across, groove: keel.flank, salt, vein: Math.max(keel.core, veins), x, y },
        1 + 0.08 * (offset < 0 ? 1 : -1));
      return { ...sample, colour: sample.colour.map((channel, index) =>
        mix(channel, [0.62, 0.52, 0.28][index]!, tipDry)) as unknown as Rgb, tint: 1 - tipDry,
      translucency: 0.85 - 0.3 * keel.core };
    },
    shadow: 0.22
  };
};

/** Ox-eye daisy basal leaf: spatulate, crenate (rounded teeth), long winged petiole. */
export const daisyLeafElement = (frame: ElementFrame, salt: number): FoliageElement => {
  const width = 0.2, outer = (y: number) => bladeHalfWidth(y, width, 2.2, 0.45) + 0.02 * smoothstep(0, 0.2, y);
  const half = (y: number) => outer(y) - 0.03 * Math.pow(Math.abs(Math.sin(y * 30 + salt)), 0.6) *
    smoothstep(0.45, 0.6, y);
  return {
    bounds: [-width * 1.2, -0.02, width * 1.2, 1.02],
    distance: (x, y) => Math.max(Math.abs(x) - half(y), -y * 0.5, (y - 1) * 0.5),
    frame,
    shade: (x, y, _distance, texel) => {
      const extent = Math.max(1e-4, outer(y)), across = clamp01(Math.abs(x) / extent);
      const midrib = veinProfile(Math.abs(x), 0.011, texel);
      const laterals = Math.pow(0.5 + 0.5 * Math.cos((y - Math.abs(x) * 1.1) * 34), 16) *
        smoothstep(0.45, 0.6, y) * (1 - across) * 0.6;
      return shadeBlade({ across, groove: midrib.flank, salt, vein: Math.max(midrib.core, laterals), x, y }, 0.95);
    },
    shadow: 0.25
  };
};

/** Yarrow: narrow, feathery, twice-divided leaf of many fine linear segments along a rachis. */
export const paintYarrowLeaf = (painter: TilePainter, frame: ElementFrame, salt: number) => {
  const segments = 13;
  paintElement(painter, grassBladeElement(frame, 0.02, 0, salt));
  for (let index = 0; index < segments; index += 1) for (const side of [-1, 1]) {
    const along = 0.08 + index / segments * 0.86, reach = 0.26 * bladeHalfWidth(along, 1, 0.6, 0.7);
    const origin = [frame.origin[0] + Math.sin(frame.angle) * along * frame.length,
      frame.origin[1] + Math.cos(frame.angle) * along * frame.length] as const;
    const angle = frame.angle + side * (0.95 + 0.25 * hashTexel(index, side + 2, salt));
    for (const [fork, spread] of [[0, 0], [1, 0.45], [2, -0.4]] as const) {
      paintElement(painter, grassBladeElement({ angle: angle + spread * side * 0.6, length: frame.length * reach *
        (fork ? 0.62 : 1), mirror: side < 0, origin }, 0.12, 0.05, salt + index * 5 + fork));
    }
  }
};
