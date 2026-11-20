import { rgb } from "../color";
import { type BladeStyle,paintBladeClump, paintClover } from "./grass-blades";
import {
  densityAt,
  fillBase,
  type MaterialRecipe,
  range,
  type RecipeContext,
  scatter,
  scatterDebris,
  scatterGrid,
  scatterLeaves,
  scatterStones,
  unit} from "./recipe-helpers";
import { blendPaint, hashTexel, type Rgb, setPaint, stampDisc } from "./tile-canvas";

/** Shared soil, thatch and debris colours under every grass type. */
const UNDERGROWTH = {
  leaves: [rgb(0x7a5a30), rgb(0x8f6c38), rgb(0x5f4426)],
  pebbles: [rgb(0x7d766b), rgb(0x958b7b), rgb(0x6a6158)],
  soil: rgb(0x3d3622),
  soilLight: rgb(0x52482e),
  thatch: [rgb(0x5a4f2e), rgb(0x6f6238), rgb(0x857546), rgb(0x4f5530)]
} as const;

const DRY_BLADES = [rgb(0x9c8c4c), rgb(0xb4a35e), rgb(0xc4b77a), rgb(0x8a8040)] as const;

/** Damp humus and sun-baked earth break the otherwise uniform soil sheet. */
const DAMP_SOIL = [rgb(0x2c2b1c), rgb(0x3b3824)] as const;
const DRY_SOIL = [rgb(0x645438), rgb(0x766445)] as const;
const EARTH_PATCH = [rgb(0x3a2f1e), rgb(0x4c3d25), rgb(0x5c4b2e)] as const;

interface MeadowSettings {
  blades: BladeStyle;
  clumpBlades: number;
  clumpRadius: number;
  clumpSpacing: number;
  /** How strongly cover varies across the tile (bare patches vs. dense tufts). */
  densityContrast: number;
  /** Small bare-earth patches under the blades. */
  earthPatches: number;
  /** Loose single blades filling the gaps, per clump. */
  fillRatio: number;
  extras: (context: RecipeContext) => void;
}

const paintSoil = (context: RecipeContext) => {
  const { noise } = context;
  fillBase(context, (u, v, x, y, paint) => {
    const tone = unit(noise.fbm(u, v, 12, 2));
    const broad = noise.gradient(u + 0.37, v - 0.19, 4);
    const damp = Math.min(1, Math.max(0, 0.5 + broad * 0.55));
    const baked = Math.max(0, -broad);
    const crumb = noise.gradient(u, v, 84);
    setPaint(paint, UNDERGROWTH.soil, UNDERGROWTH.soilLight, tone,
      .94 + crumb * .055 + (hashTexel(x, y, 3) - .5) * .08);
    blendPaint(paint, DAMP_SOIL[0], DAMP_SOIL[1], tone, damp * 0.45);
    blendPaint(paint, DRY_SOIL[0], DRY_SOIL[1], tone, baked * 0.28);
    paint.roughness = .96 - damp * .05;
    return .1 + tone * .06 + damp * .015 + crumb * .008;
  });
};

/** Shallow bare-earth patches with a soft rim, so the cover does not read as a flat sheet. */
const paintEarthPatches = (context: RecipeContext, count: number) => {
  const { paint, random } = context;
  scatter(context, count, (x, y) => {
    const radius = range(random, 6, 15);
    const height = range(random, 0.115, 0.155);
    setPaint(paint, EARTH_PATCH[2], EARTH_PATCH[1], random(), range(random, 0.88, 1));
    paint.roughness = 0.94;
    stampDisc(context.canvas, x, y, radius * 1.35, height - 0.012, 0.02, paint);
    setPaint(paint, EARTH_PATCH[0], EARTH_PATCH[1], random(), range(random, 0.9, 1.04));
    paint.roughness = 0.92;
    stampDisc(context.canvas, x, y, radius, height, 0.05, paint);
    const pebble = random();
    if (pebble < 0.35) {
      setPaint(paint, UNDERGROWTH.pebbles[0], UNDERGROWTH.pebbles[2], random(), 1);
      stampDisc(
        context.canvas,
        x + range(random, -radius, radius),
        y + range(random, -radius, radius),
        range(random, 1, 2.2),
        height + 0.02,
        0.1,
        paint
      );
    }
  });
};

/** Flat dead blades and stalks between the living grass (organic debris layer). */
const paintThatch = (context: RecipeContext, amount: number) => {
  const { size } = context.canvas;
  scatterDebris(context, {
    bend: 1.2,
    count: Math.round(((size * size) / 55) * amount),
    height: [0.16, 0.26],
    length: [4, 10],
    palette: UNDERGROWTH.thatch,
    roughness: 0.9,
    taper: 0.6,
    width: [1, 1.6]
  });
};

/** Grass grows in clumps of varying density; a slowly turning field combs them one way. */
const paintClumps = (context: RecipeContext, settings: MeadowSettings) => {
  const { canvas, noise, random } = context;
  scatterGrid(context, settings.clumpSpacing, (x, y) => {
    const u = x / canvas.size;
    const v = y / canvas.size;
    const moisture = Math.min(1, Math.max(0, 0.5 + noise.gradient(u + 0.13, v - 0.27, 2) * 0.55));
    const vigour = Math.min(1,
      densityAt(context, x, y, 3, settings.densityContrast) * (0.8 + moisture * 0.35));
    if (random() > 0.45 + vigour * 0.7) return;
    const clump = {
      blades: Math.round(settings.clumpBlades * (0.55 + vigour * 0.6)),
      hue: unit(noise.fbm(u, v, 6, 2)) * 0.75 + moisture * 0.2 + random() * 0.3 - 0.1,
      // Short neighbouring tufts share a lean, without repeating tile-wide combed swirls.
      lean: noise.gradient(u, v, 7) * 2.6 + noise.gradient(u + .31, v + .17, 2) + range(random, -.6, .6),
      moisture,
      radius: settings.clumpRadius * range(random, 0.65, 1.4),
      vigour,
      x,
      y
    };
    paintBladeClump(context, settings.blades, clump);
    const loose = Math.round(settings.fillRatio * (0.5 + vigour));
    for (let index = 0; index < loose; index += 1) {
      const offsetX = x + range(random, -1, 1) * settings.clumpSpacing;
      const offsetY = y + range(random, -1, 1) * settings.clumpSpacing;
      const single = {
        ...clump,
        blades: 1,
        hue: clump.hue + range(random, -0.12, 0.12),
        moisture: Math.min(1, Math.max(0, clump.moisture + range(random, -0.12, 0.12))),
        radius: 0,
        x: offsetX,
        y: offsetY
      };
      paintBladeClump(context, settings.blades, single);
    }
  });
};

const meadowRecipe =
  (settings: MeadowSettings): MaterialRecipe =>
  (context) => {
    paintSoil(context);
    paintThatch(context, 1);
    paintEarthPatches(context, settings.earthPatches);
    scatterStones(
      context,
      {
        angularity: 0.3,
        buried: 0.55,
        count: 40,
        flatTop: 0.7,
        maxRadius: 4,
        minRadius: 1.2,
        palette: UNDERGROWTH.pebbles,
        surface: 0.2
      },
      11
    );
    paintClumps(context, settings);
    settings.extras(context);
  };

/** Clover patches: small groups of round leaflets, slightly bluer than the grass. */
const paintCloverPatches = (context: RecipeContext, patches: number, ramp: readonly Rgb[]) => {
  const { random } = context;
  scatter(context, patches, (x, y) => {
    const leaves = Math.round(range(random, 6, 18));
    for (let index = 0; index < leaves; index += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * 9;
      paintClover(context, x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, ramp);
    }
  });
};

/** Tiny flower heads: a few texels of colour on top of the grass, very sparse. */
const paintFlowerHeads = (context: RecipeContext, count: number, colors: readonly Rgb[]) => {
  const { paint, random } = context;
  scatter(context, count, (x, y) => {
    const color = colors[Math.floor(random() * colors.length)]!;
    setPaint(paint, color, color, 0, range(random, 0.9, 1.05));
    paint.roughness = 0.6;
    const florets = Math.round(range(random, 2, 5));
    for (let index = 0; index < florets; index += 1) {
      const fx = x + range(random, -2.5, 2.5);
      const fy = y + range(random, -2.5, 2.5);
      stampDisc(context.canvas, fx, fy, range(random, 0.8, 1.3), 1.02, 0.03, paint);
    }
  });
};

const CLOVER = [rgb(0x3a6a34), rgb(0x4a7d3c), rgb(0x5b8b44)] as const;
const FLOWERS = [rgb(0xe9e6d2), rgb(0xe6cb4c), rgb(0xd9d8c4)] as const;
const LUSH_FLOWERS = [rgb(0xeeead6), rgb(0xe7c94a), rgb(0xa58ac8), rgb(0xe9e3b0)] as const;

/** Temperate meadow: several greens, yellow-green and dry blades, uneven tufts. */
export const meadowGrass = meadowRecipe({
  blades: {
    dryChance: 0.07,
    dryRamp: DRY_BLADES,
    greens: [rgb(0x2f4e1b), rgb(0x3e6123), rgb(0x52732a), rgb(0x6a8532), rgb(0x819043)],
    height: [0.62, 0.95],
    length: [7, 14],
    tip: rgb(0xa8b567),
    width: [1.5, 2.4]
  },
  clumpBlades: 12,
  clumpRadius: 4,
  clumpSpacing: 7,
  densityContrast: 0.85,
  earthPatches: 4,
  extras: (context) => {
    paintCloverPatches(context, 6, CLOVER);
    paintFlowerHeads(context, 14, FLOWERS);
    scatterLeaves(context, {
      count: 10,
      curl: 0.05,
      height: [0.3, 0.5],
      length: [9, 14],
      palette: UNDERGROWTH.leaves,
      shape: [0.45, 0.6]
    });
  },
  fillRatio: 2
});

const SHADE_CLOVER = [rgb(0x2d5528), rgb(0x386330), rgb(0x2a4a2a)] as const;

/**
 * Shaded grass under the trees (the forest floor ground): cooler, darker greens, shorter and a
 * little sparser, mossy clover patches, no fallen leaves (a painted leaf layer looked like it
 * floated above the ground, with the grass blades growing through it).
 */
export const shadedGrass = meadowRecipe({
  blades: {
    dryChance: 0.04,
    dryRamp: DRY_BLADES,
    greens: [rgb(0x223d1a), rgb(0x2b4a1e), rgb(0x355923), rgb(0x2e5130), rgb(0x40632a)],
    height: [0.55, 0.85],
    length: [6, 12],
    tip: rgb(0x748f47),
    width: [1.4, 2.2]
  },
  clumpBlades: 11,
  clumpRadius: 4,
  clumpSpacing: 7,
  densityContrast: 0.75,
  earthPatches: 5,
  extras: (context) => paintCloverPatches(context, 10, SHADE_CLOVER),
  fillRatio: 1.8
});

/** Moist meadow: denser, longer, deeper and bluer greens, clover and a few flowers. */
export const lushGrass = meadowRecipe({
  blades: {
    dryChance: 0.02,
    dryRamp: DRY_BLADES,
    greens: [rgb(0x1f4218), rgb(0x2b521f), rgb(0x396725), rgb(0x326032), rgb(0x4d772b)],
    height: [0.7, 1],
    length: [9, 17],
    tip: rgb(0x86a653),
    width: [1.6, 2.6]
  },
  clumpBlades: 16,
  clumpRadius: 4.5,
  clumpSpacing: 6.5,
  densityContrast: 0.55,
  earthPatches: 2,
  extras: (context) => {
    paintCloverPatches(context, 14, CLOVER);
    paintFlowerHeads(context, 30, LUSH_FLOWERS);
  },
  fillRatio: 2.4
});
