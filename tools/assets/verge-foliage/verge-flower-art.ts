import { hashTexel } from "../../../src/render-common/materials/tile-canvas";
import { type FoliageElement, paintElement, type Rgb, shadedColour,
  type TilePainter } from "../climber-foliage/foliage-canvas";
import { clamp01, fractalNoise, mix, smoothstep } from "../climber-foliage/foliage-noise";
import { paintStem, type Point, type StemStyle } from "../climber-foliage/stem-art";

/** Baked natural colours (linear): flowers keep their own hue, never the leaf tint. */
const DANDELION_YELLOW: Rgb = [0.95, 0.66, 0.03];
const DANDELION_CENTRE: Rgb = [0.86, 0.43, 0.012];
const DAISY_WHITE: Rgb = [0.86, 0.86, 0.8];
const DAISY_DISC: Rgb = [0.85, 0.48, 0.02];
const CLOVER_WHITE: Rgb = [0.95, 0.9, 0.84];
const CLOVER_OLD: Rgb = [0.78, 0.5, 0.48];
const YARROW_WHITE: Rgb = [0.84, 0.82, 0.74];
const PLANTAIN_SEED: Rgb = [0.2, 0.2, 0.08];
const SEED_STRAW: Rgb = [0.4, 0.36, 0.16];
export const GREEN_STALK: StemStyle = { base: [0.16, 0.3, 0.05], roughness: 0.5, tint: 0, translucency: 0.3 };
const STRAW_STALK: StemStyle = { base: [0.3, 0.32, 0.1], roughness: 0.55, tint: 0, translucency: 0.25 };

const disc = (radius: number, centre: Point): Pick<FoliageElement, "bounds" | "frame"> => ({
  bounds: [-radius * 1.1, -radius * 1.1, radius * 1.1, radius * 1.1],
  frame: { angle: 0, length: 1, origin: centre }
});

/** Dandelion capitulum from above: rings of strap-shaped ligules, a denser orange-gold centre. */
export const paintDandelionHead = (painter: TilePainter, centre: Point, radius: number, salt: number) =>
  paintElement(painter, {
    ...disc(radius, centre),
    distance: (x, y) => {
      const theta = Math.atan2(x, y), r = Math.hypot(x, y);
      const frill = 0.07 * Math.pow(Math.abs(Math.sin(theta * 17 + salt)), 3);
      return r - radius * (0.93 - frill + 0.04 * hashTexel(Math.floor((theta + 4) * 17), 1, salt));
    },
    shade: (x, y) => {
      const theta = Math.atan2(x, y), r = Math.hypot(x, y) / radius;
      const ligule = Math.pow(0.5 + 0.5 * Math.cos(theta * (r < 0.55 ? 34 : 26) + r * 3 +
        fractalNoise(x * 9, y * 9, salt) * 2.5), 2);
      const rings = fractalNoise(r * 8, theta * 3, salt + 1);
      const base = DANDELION_YELLOW.map((channel, index) =>
        mix(DANDELION_CENTRE[index]!, channel, smoothstep(0.05, 0.6, r))) as unknown as Rgb;
      return {
        colour: shadedColour(base, 0.84 + 0.16 * ligule + 0.1 * rings - 0.22 * (1 - smoothstep(0, 0.2, r))),
        relief: 0.018 * (1 - r * r) + 0.003 * ligule, roughness: 0.6, tint: 0, translucency: 0.5 * r
      };
    },
    shadow: 0.25
  });

/** Ox-eye daisy from above: white notched rays around a domed golden disc of tiny florets. */
export const paintDaisyHead = (painter: TilePainter, centre: Point, radius: number, salt: number) =>
  paintElement(painter, {
    ...disc(radius, centre),
    distance: (x, y) => {
      const theta = Math.atan2(x, y), r = Math.hypot(x, y), rays = 21;
      const ray = Math.pow(Math.abs(Math.cos(theta * rays / 2 + salt)), 0.35);
      const length = 0.9 + 0.08 * hashTexel(Math.floor((theta + 4) * rays / (Math.PI * 2)), 2, salt);
      return r - radius * length * (0.45 + 0.55 * ray);
    },
    shade: (x, y) => {
      const theta = Math.atan2(x, y), r = Math.hypot(x, y) / radius, inDisc = 1 - smoothstep(0.28, 0.33, r);
      const florets = (fractalNoise(x * 60, y * 60, salt) + 0.5) * inDisc;
      const rayVein = Math.pow(0.5 + 0.5 * Math.cos(theta * 63), 6) * 0.08;
      const base = DAISY_WHITE.map((channel, index) => mix(channel, DAISY_DISC[index]!, inDisc)) as unknown as Rgb;
      const shade = mix(0.9 - rayVein + 0.1 * smoothstep(0.3, 0.9, r), 0.8 + 0.2 * florets, inDisc);
      return { colour: shadedColour(base, shade), relief: inDisc * 0.02 * (1 - r * r * 9) + 0.003 * florets +
        0.004 * (1 - inDisc) * Math.sqrt(clamp01(1 - r * r)),
        roughness: 0.55, tint: 0, translucency: (1 - inDisc) * 0.7 };
    },
    shadow: 0.22
  });

/**
 * Clover head: a globe of tubular florets, the oldest ones reflexed and brownish below. The pale
 * florets take the card tint (red clover pink in the verge recipe); the old ones mostly keep theirs.
 */
export const paintCloverFlower = (painter: TilePainter, centre: Point, radius: number, salt: number) => {
  paintStem(painter, { curve: [[0.5, 0.035], [0.49, (0.035 + centre[1]) / 2], [centre[0], centre[1] - radius * 0.6]],
    radius: [0.013, 0.01], salt, shadow: 0.1, style: GREEN_STALK });
  paintElement(painter, {
    ...disc(radius, centre),
    distance: (x, y) => {
      const theta = Math.atan2(x, y);
      return Math.hypot(x, y) - radius * (0.9 + 0.08 * Math.pow(Math.abs(Math.sin(theta * 11 + salt)), 2));
    },
    shade: (x, y) => {
      const r = Math.hypot(x, y) / radius, theta = Math.atan2(x, y);
      const floret = clamp01(fractalNoise(x * 34 + theta, y * 34, salt) * 1.6 + 0.5);
      const old = smoothstep(0.2, -0.75, y / radius) * 0.75;
      const base = CLOVER_WHITE.map((channel, index) => mix(channel, CLOVER_OLD[index]!, old)) as unknown as Rgb;
      return { colour: shadedColour(base, (0.72 + 0.28 * floret) * (1 - 0.25 * r * r)),
        relief: 0.025 * Math.sqrt(clamp01(1 - r * r)) + 0.004 * floret, roughness: 0.6, tint: 1 - old * 0.7,
        translucency: 0.4 };
    },
    shadow: 0.25
  });
};

/** Plantain seed spike: a slender cylindrical spike of tightly packed capsules on a long scape. */
export const paintPlantainSpike = (painter: TilePainter, salt: number) => {
  paintStem(painter, { curve: [[0.5, 0.035], [0.52, 0.25], [0.5, 0.46]], radius: [0.014, 0.011], salt,
    shadow: 0.1, style: GREEN_STALK });
  paintElement(painter, {
    bounds: [-0.06, -0.02, 0.06, 1.02],
    distance: (x, y) => Math.max(Math.abs(x) - 0.05 * Math.pow(Math.sin(Math.PI * clamp01(y)), 0.35), -y, y - 1),
    frame: { angle: 0.02, length: 0.5, origin: [0.5, 0.46] },
    shade: (x, y) => {
      const across = clamp01(Math.abs(x) / 0.05), capsule = Math.abs(Math.sin(y * 70 + (x > 0 ? 1.4 : 0)));
      const anther = Math.pow(fractalNoise(x * 120, y * 90, salt) + 0.5, 6) * smoothstep(0.55, 0.85, y) * 0.6;
      return { colour: shadedColour(PLANTAIN_SEED, (0.75 + 0.3 * capsule) * (1 - 0.35 * across * across) +
        anther * 1.4), relief: 0.02 * Math.sqrt(1 - across * across) + 0.006 * capsule,
      roughness: 0.65, tint: 0, translucency: 0.15 };
    },
    shadow: 0.2
  });
};

/** A thin, slightly curved hollow flower stalk from the pivot to the tile top. */
export const paintFlowerStalk = (painter: TilePainter, salt: number) =>
  paintStem(painter, { curve: [[0.5, 0.035], [0.535, 0.5], [0.5, 0.965]], radius: [0.016, 0.012], salt,
    shadow: 0, style: GREEN_STALK });

/** Meadow-grass culm with a loose, nodding panicle of small spikelets. */
export const paintGrassSeedhead = (painter: TilePainter, salt: number) => {
  paintStem(painter, { curve: [[0.5, 0.035], [0.5, 0.3], [0.53, 0.56]], radius: [0.011, 0.008], salt,
    shadow: 0.1, style: STRAW_STALK });
  for (let branch = 0; branch < 9; branch += 1) {
    const along = 0.56 + branch * 0.04, side = branch % 2 ? 1 : -1, reach = 0.18 * (1 - branch / 11);
    const start: Point = [0.53 + (along - 0.56) * 0.3, along];
    const end: Point = [start[0] + side * reach, along + reach * 0.9];
    paintStem(painter, { curve: [start, [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2 + 0.02], end],
      radius: [0.005, 0.003], salt: salt + branch, shadow: 0.05, style: STRAW_STALK });
    for (let spikelet = 0; spikelet < 3; spikelet += 1) {
      const t = 0.45 + spikelet * 0.27;
      paintElement(painter, {
        bounds: [-0.4, -0.02, 0.4, 1.02],
        distance: (x, y) => Math.max(Math.abs(x) - 0.3 * Math.sin(Math.PI * clamp01(y)), -y, y - 1),
        frame: { angle: side * (0.5 + 0.2 * hashTexel(branch, spikelet, salt)), length: 0.05,
          origin: [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t] },
        shade: (x, y) => ({
          colour: shadedColour(SEED_STRAW, 0.8 + 0.25 * Math.abs(Math.sin(y * 12)) - 0.3 * Math.abs(x)),
          relief: 0.02, roughness: 0.6, tint: 0, translucency: 0.45 }),
        shadow: 0.15
      });
    }
  }
};

/** Yarrow corymb from above: a flat dome of many tiny five-rayed white florets with cream centres. */
export const paintYarrowUmbel = (painter: TilePainter, salt: number) => {
  for (let index = 0; index < 46; index += 1) {
    const angle = index * 2.39996, distance = 0.34 * Math.sqrt((index + 0.5) / 46);
    const centre: Point = [0.5 + Math.sin(angle) * distance, 0.5 + Math.cos(angle) * distance];
    const radius = 0.056 + 0.012 * hashTexel(index, 3, salt);
    paintElement(painter, {
      ...disc(radius, centre),
      distance: (x, y) =>
        Math.hypot(x, y) - radius * (0.7 + 0.3 * Math.abs(Math.cos(Math.atan2(x, y) * 2.5 + index))),
      shade: (x, y) => {
        const r = Math.hypot(x, y) / radius, eye = 1 - smoothstep(0.18, 0.32, r);
        const base = YARROW_WHITE.map((channel, at) => mix(channel, [0.72, 0.62, 0.36][at]!, eye)) as unknown as Rgb;
        return { colour: shadedColour(base, 0.82 + 0.18 * (1 - r) - 0.1 * distance), relief: 0.03 * (1 - r * r),
          roughness: 0.6, tint: 0, translucency: 0.5 };
      },
      shadow: 0.35
    });
  }
};
