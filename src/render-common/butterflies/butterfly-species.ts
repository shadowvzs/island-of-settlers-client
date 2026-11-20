import type { ButterflyHabitatTuning, ButterflyTuning } from "@shared/catalog";
import { entriesOfKind } from "@shared/catalog";
import { BUTTERFLY_TUNING } from "@shared/catalog/tuning/butterflies";

import { lerp3 } from "../../shared/world/noise";
import type { Random } from "../../shared/world/rng";
import type { Vec3 } from "../props/mesh-builder";
import {
  createBand,
  createChevrons,
  createStreaks,
  type Marking,
  scatterDots} from "./butterfly-markings";
import {
  paintEyespot,
  placeOnWing,
  ramp,
  type WingSide
} from "./butterfly-wing-paint";
import type { WingPixel } from "./butterfly-wing-shape";

/** Where a species likes to fly (weights of the habitat terms, see butterfly-habitat). */
export type ButterflyHabitatWeights = ButterflyHabitatTuning;

/** A pattern variant's markings of both wing sides. */
interface WingMarkings {
  under: Marking[];
  upper: Marking[];
}

/**
 * A species: the catalog tuning (`tuning/models/butterflies.json`: body colours, flight, habitat, wing outlines
 * and wing styles) with the procedural painting and marking recipes of this module.
 */
export interface ButterflySpecies extends Omit<ButterflyTuning, "under" | "upper"> {
  /**
   * Markings of a pattern variant (dots, bands, chevrons, streaks, patches): the variant picks
   * the recipe, the seeded random jitters counts, sizes and positions.
   */
  markings: (random: Random, variant: number) => WingMarkings;
  /** Lower-case English catalog name. */
  name: string;
  /** Painted wing sides (original procedural markings, no real-photo patterns). */
  under: WingSide;
  upper: WingSide;
}

/** The code half of a species; the catalog supplies the name. */
type ButterflyRecipe = Omit<ButterflySpecies, "name">;

/** The same marks in another colour (an upper side pattern showing faintly below). */
const recolor = (markings: readonly Marking[], color: Vec3): Marking[] =>
  markings.map((marking) => ({ ...marking, color }));

/** White-ringed black dots (ocelli): each dot twice, a pale ring under a dark centre. */
const ringDots = (dots: readonly Marking[]): Marking[] =>
  dots.flatMap<Marking>((dot) =>
    dot.kind === "dot"
      ? [
          { ...dot, color: [0.97, 0.96, 0.93] as Vec3, size: dot.size * 1.6 },
          { ...dot, color: [0.07, 0.07, 0.09] as Vec3 }
        ]
      : [dot]
  );

const ROSE_TUNING = BUTTERFLY_TUNING.roseCrimson!;
const ROSE_SHAPE = ROSE_TUNING.shape;
const ROSE_DARK = ROSE_TUNING.upper.style.margin;
const ROSE_PALE: Vec3 = [0.98, 0.9, 0.82];
const ROSE_DOT_STYLES = ["large", "small", "mixed"] as const;

/** Rose crimson: dark dots of varied size, a few pale spots in the dark margin. */
const getRoseMarkings = (random: Random, variant: number): WingMarkings => {
  const area = { across: [0.3, 0.85], outline: ROSE_SHAPE.fore, radial: [0.4, 0.72] } as const;
  const style = ROSE_DOT_STYLES[variant % ROSE_DOT_STYLES.length]!;
  const fore = scatterDots(random, area, ROSE_DARK, 0.9, style);
  const hindArea = { across: [0.1, 0.6], outline: ROSE_SHAPE.hind, radial: [0.4, 0.65] } as const;
  const hind = scatterDots(random, hindArea, ROSE_DARK, 0.75, "mixed").slice(0, 3);
  const rim = { across: [0.05, 0.75], outline: ROSE_SHAPE.fore, radial: [0.93, 0.95] } as const;
  const pale = scatterDots(random, rim, ROSE_PALE, 0.45, "small");
  return {
    under: [...recolor(fore, [0.22, 0.12, 0.1]), ...recolor(hind, [0.92, 0.84, 0.74])],
    upper: [...fore, ...hind, ...pale]
  };
};

/**
 * Rose crimson: saturated crimson wings (they read on green, brown and pale ground alike) with
 * a dark base and margin, dark dots and pale margin spots; dusky rose-brown below.
 */
const ROSE_CRIMSON: ButterflyRecipe = {
  ...ROSE_TUNING,
  markings: getRoseMarkings,
  under: {
    paint: (pixel) => {
      const base = lerp3([0.56, 0.3, 0.28], [0.42, 0.24, 0.22], pixel.fore ? 0.2 : 0.8);
      return lerp3(base, [0.72, 0.42, 0.36], ramp(0.4, 0.85, pixel.radial) * 0.5);
    },
    style: ROSE_TUNING.under.style
  },
  upper: {
    paint: (pixel) => lerp3([0.72, 0.06, 0.18], [0.86, 0.16, 0.26], ramp(0.25, 0.85, pixel.radial)),
    style: ROSE_TUNING.upper.style
  }
};

const EMBER_TUNING = BUTTERFLY_TUNING.ember!;
const EMBER_SHAPE = EMBER_TUNING.shape;
const EMBER_EYE = placeOnWing(EMBER_SHAPE.fore, 0.76, 0.2);
const EMBER_BARS = [0.32, 0.5].map((radial) => placeOnWing(EMBER_SHAPE.fore, radial, 0.1));
const EMBER_BLACK: Vec3 = [0.08, 0.05, 0.04];
const EMBER_EYE_COLORS = {
  iris: [0.38, 0.45, 0.85],
  pupil: [0.06, 0.05, 0.08],
  ring: [0.08, 0.06, 0.05]
} as const;

/** Ember: spotted, banded (zigzag) or streaked with chevrons; silver dots below. */
const getEmberMarkings = (random: Random, variant: number): WingMarkings => {
  const foreArea = { across: [0.35, 0.85], outline: EMBER_SHAPE.fore, radial: [0.4, 0.7] } as const;
  const hindArea = {
    across: [0.15, 0.7],
    outline: EMBER_SHAPE.hind,
    radial: [0.35, 0.65]
  } as const;
  const bars: Marking[] = EMBER_BARS.map((bar) => ({
    color: EMBER_BLACK,
    kind: "dot",
    size: 0.03,
    x: bar[0],
    z: bar[2]
  }));
  const upper = [
    ...bars,
    ...[
      () => [
        ...scatterDots(random, foreArea, EMBER_BLACK),
        ...scatterDots(random, hindArea, EMBER_BLACK, 0.8)
      ],
      () => [
        createBand(random, true, 0.6, EMBER_BLACK),
        createBand(random, false, 0.5, EMBER_BLACK)
      ],
      () => [
        ...scatterDots(random, foreArea, EMBER_BLACK),
        createStreaks(random, false, [0.55, 0.22, 0.05]),
        createChevrons(random, false, EMBER_BLACK)
      ]
    ][variant % 3]!()
  ];
  const silverArea = {
    across: [0.1, 0.8],
    outline: EMBER_SHAPE.hind,
    radial: [0.25, 0.75]
  } as const;
  return { under: scatterDots(random, silverArea, [0.92, 0.9, 0.84], 0.8), upper };
};

/** Lunules: pale crescents in the dark margin band, one between each pair of veins. */
const getLunules = (pixel: WingPixel, count: number) => {
  const inBand = ramp(0.012, 0.02, pixel.toMargin) * ramp(0.042, 0.032, pixel.toMargin);
  return inBand * (Math.sin(pixel.across * Math.PI * count) > 0.35 ? 1 : 0);
};

/** Ember: deep orange, black marks, an eyespot at the tip, a black lunuled margin. */
const EMBER: ButterflyRecipe = {
  ...EMBER_TUNING,
  markings: getEmberMarkings,
  under: {
    paint: (pixel) => {
      const marble = 0.5 + 0.5 * Math.sin(pixel.x * 55 + Math.sin(pixel.z * 41) * 2.2);
      const color = lerp3([0.66, 0.46, 0.27], [0.5, 0.35, 0.22], pixel.fore ? marble * 0.3 : marble);
      if (pixel.fore) return lerp3(color, [0.85, 0.52, 0.22], ramp(0.7, 0.2, pixel.radial) * 0.6);
      return lerp3(color, [0.84, 0.76, 0.6], ramp(0.05, 0, Math.abs(pixel.radial - 0.5)) * 0.6);
    },
    style: EMBER_TUNING.under.style,
    top: (color, pixel) =>
      pixel.fore ? paintEyespot(color, pixel, EMBER_EYE, 0.036, EMBER_EYE_COLORS) : color
  },
  upper: {
    paint: (pixel) => lerp3([0.9, 0.42, 0.07], [0.98, 0.6, 0.17], ramp(0.3, 0.85, pixel.radial)),
    style: EMBER_TUNING.upper.style,
    top: (color, pixel) => {
      const eyed = pixel.fore
        ? paintEyespot(color, pixel, EMBER_EYE, 0.042, EMBER_EYE_COLORS)
        : color;
      return lerp3(eyed, [0.96, 0.86, 0.62], getLunules(pixel, pixel.fore ? 9 : 7));
    }
  }
};

const SKY_TUNING = BUTTERFLY_TUNING.skyBlue!;
const SKY_SHAPE = SKY_TUNING.shape;
const SKY_DARK = SKY_TUNING.upper.style.margin;

/** Sky blue: plain, dark marginal chevrons or dark streaked tips; jittered ocelli below. */
const getSkyMarkings = (random: Random, variant: number): WingMarkings => {
  const upper: Marking[] = [
    [],
    [createChevrons(random, false, SKY_DARK)],
    [createStreaks(random, true, [0.24, 0.28, 0.55]), createChevrons(random, false, SKY_DARK)]
  ][variant % 3]!;
  const foreArea = { across: [0.2, 0.8], outline: SKY_SHAPE.fore, radial: [0.55, 0.75] } as const;
  const hindArea = { across: [0.08, 0.7], outline: SKY_SHAPE.hind, radial: [0.5, 0.7] } as const;
  const ocelli = [
    ...scatterDots(random, foreArea, SKY_DARK, 0.55),
    ...scatterDots(random, hindArea, SKY_DARK, 0.5)
  ];
  const chevrons = random() < 0.5 ? [createChevrons(random, false, [0.98, 0.52, 0.16])] : [];
  return { under: [...ringDots(ocelli), ...chevrons], upper };
};

/** Sky blue: small, violet blue with a fine dark rim and white fringe; dove grey below. */
const SKY_BLUE: ButterflyRecipe = {
  ...SKY_TUNING,
  markings: getSkyMarkings,
  under: {
    paint: (pixel) => {
      const color: Vec3 = pixel.fore ? [0.8, 0.79, 0.77] : [0.76, 0.75, 0.72];
      if (pixel.fore) return color;
      const lunule = ramp(0.012, 0.02, pixel.toMargin) * ramp(0.045, 0.034, pixel.toMargin);
      const lit = Math.sin(pixel.across * Math.PI * 6) > 0.2 ? lunule : 0;
      return lerp3(color, [0.98, 0.52, 0.16], lit * ramp(0.75, 0.2, pixel.across));
    },
    style: SKY_TUNING.under.style
  },
  upper: {
    paint: (pixel) => {
      const sheen = ramp(0.2, 0.7, pixel.radial) * ramp(1, 0.6, pixel.radial);
      const color = lerp3([0.36, 0.48, 0.96], [0.52, 0.48, 0.94], pixel.across);
      return lerp3(color, [0.6, 0.72, 1], sheen * 0.45);
    },
    style: SKY_TUNING.upper.style
  }
};

const VIOLET_TUNING = BUTTERFLY_TUNING.duskViolet!;
const VIOLET_SHAPE = VIOLET_TUNING.shape;
/** The under side's dead leaf midrib: a line from the forewing tip to the hindwing point. */
const VIOLET_MIDRIB = [
  placeOnWing(VIOLET_SHAPE.fore, 0.96, 0.18),
  placeOnWing(VIOLET_SHAPE.hind, 0.96, 0.52)
] as const;
const VIOLET_DARK = VIOLET_TUNING.upper.style.margin;
const VIOLET_PALE: Vec3 = [0.92, 0.88, 0.96];

const getMidrib = (pixel: WingPixel) => {
  const [start, end] = VIOLET_MIDRIB;
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  const cross = (pixel.x - start[0]) * dz - (pixel.z - start[2]) * dx;
  return 1 - ramp(0.004, 0.008, Math.abs(cross) / Math.hypot(dx, dz));
};

/** Dusk violet: dark dots of varied size on both wings, pale spots along the forewing margin. */
const getVioletMarkings = (random: Random, variant: number): WingMarkings => {
  const style = (["mixed", "large", "small"] as const)[variant % 3]!;
  const foreArea = {
    across: [0.25, 0.8],
    outline: VIOLET_SHAPE.fore,
    radial: [0.38, 0.7]
  } as const;
  const hindArea = {
    across: [0.15, 0.7],
    outline: VIOLET_SHAPE.hind,
    radial: [0.35, 0.65]
  } as const;
  const dots = [
    ...scatterDots(random, foreArea, VIOLET_DARK, 0.85, style),
    ...scatterDots(random, hindArea, VIOLET_DARK, 0.7, "mixed").slice(0, 3)
  ];
  const rim = { across: [0.05, 0.85], outline: VIOLET_SHAPE.fore, radial: [0.92, 0.95] } as const;
  const pale = scatterDots(random, rim, VIOLET_PALE, 0.45, "small");
  return { under: recolor(dots, [0.3, 0.22, 0.24]), upper: [...dots, ...pale] };
};

/**
 * Dusk violet: deep violet wings (distinct from the light sky blue and the meadow) with a hooked
 * forewing tip, dark dots and pale margin spots; a dead leaf brown below with a midrib.
 */
const DUSK_VIOLET: ButterflyRecipe = {
  ...VIOLET_TUNING,
  markings: getVioletMarkings,
  under: {
    paint: (pixel) => {
      const shade = pixel.radial * 0.6 + pixel.across * 0.4;
      return lerp3([0.56, 0.44, 0.4], [0.44, 0.34, 0.34], shade);
    },
    style: VIOLET_TUNING.under.style,
    top: (color, pixel) => lerp3(color, [0.3, 0.22, 0.2], getMidrib(pixel) * 0.8)
  },
  upper: {
    paint: (pixel) => lerp3([0.36, 0.1, 0.62], [0.52, 0.24, 0.8], ramp(0.25, 0.85, pixel.radial)),
    style: VIOLET_TUNING.upper.style
  }
};

const BUTTERFLY_RECIPES: Readonly<Record<string, ButterflyRecipe>> = {
  duskViolet: DUSK_VIOLET,
  ember: EMBER,
  roseCrimson: ROSE_CRIMSON,
  skyBlue: SKY_BLUE
};

/**
 * Original species (no real-photo markings); the index is the catalog code (`butterfly:*`), the species id in the
 * frame. Loaded synchronously with the butterfly module graph (flyer atlas worker, renderer).
 */
export const BUTTERFLY_SPECIES: readonly ButterflySpecies[] = entriesOfKind("butterfly")
  .map(({ key, text }) => ({ ...BUTTERFLY_RECIPES[key]!, name: text.name.en.toLowerCase() }));
