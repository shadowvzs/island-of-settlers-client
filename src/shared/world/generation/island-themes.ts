import type { BufferSoil } from "../ground-buffer";

/**
 * The island themes; this table is the one place that defines a theme. A theme is plain
 * numbers (blended per area by theme-field.ts), so a map can mix themes with soft borders. New
 * themes go at the end (the theme weight field stores one byte per theme in this order).
 */
export const ISLAND_THEMES = ["meadow", "desert", "dirt", "snowy"] as const;

/** Themes per vertex in the theme weight field (one byte each). */
export const THEME_COUNT = ISLAND_THEMES.length;

export type IslandTheme = (typeof ISLAND_THEMES)[number];

type Rgb = [number, number, number];

/** Vegetation rule factors (prop-rules.ts, tree-rules.ts). */
export interface ThemeVegetation {
  /** Lowland broadleaf weight multiplier (1 = the mixed temperate lowland). */
  broadleaf: number;
  /** Minimum conifer (upland) weight in the tree species mix: pine stands in the lowland too. */
  conifer: number;
  /** Share of the coastal palm belt and palm groves kept (0: no palms, a cold coast). */
  coastPalms: number;
  /** Meadow flower chance factor. */
  flowers: number;
  /** Glades inside dense forest (1 = default; "Many" forest keeps fewer). */
  glades: number;
  /** Palm grove share away from water (1 = everywhere on the coastal belt and on sand). */
  inlandGroves: number;
  /** Minimum palm (coastal) weight in the tree species mix: palms inland too. */
  palm: number;
  /** Palm grove share on sandy ground far from the coast and water (inland dunes, sand). */
  sandPalms: number;
  /** Share of the bushes and shrubs kept (1 = the meadow density; winter themes go low too). */
  shrubDensity: number;
  /**
   * Cells a bush keeps inside its vegetated ground (grass, lush grass, forest floor), like the
   * grass cover: no bush on the edge of dirt, sand or rock.
   */
  shrubEdgeMargin: number;
  /** Lone trees in the open land factor. */
  solitaryTrees: number;
  /** Warm, Mediterranean share 0..1: fewer cool spruce stands (conifer-rules.ts). */
  warmth: number;
  /** Extra dry tussocks on open ground and dunes (not blocking). */
  tufts: number;
}

/** Render only grass cover (render-common/props/field-cover.ts). */
export interface ThemeCover {
  /** Cover density factor. */
  density: number;
  /** Dry tuft patch boost (added to the dry patch strength). */
  dry: number;
  flowers: number;
  /** Multiplier on the ground tint of grass tufts (ochre, browner). */
  tint: Rgb;
}

/**
 * Everything a theme changes, as parameters of the shared rules (no theme branches in the
 * rules): ground materials, moisture, forest, vegetation mix, grass cover and rock tint.
 */
export interface ThemeParameters {
  /** Clover meadow patches (the lush grass layer) in moist, open meadows; 0 = none. */
  clover: number;
  cover: ThemeCover;
  /** Extra bare soil and stony ground on open land (0 = the meadow rules). */
  dirt: number;
  /** Forest amount offset (added to the world's forest amount). */
  forest: number;
  gravel: number;
  /** Moisture away from rivers (1 = meadow); river banks stay wet, so they turn into oases. */
  moisture: number;
  /** River width factor (narrower desert rivers). */
  riverWidth: number;
  /**
   * Soil between rock pebbles and green ground (ground-chain.ts): dirt, sand in the desert, snow
   * in a snowy theme.
   */
  rockBuffer: BufferSoil;
  /** Shift of the stone tint towards warm / sandstone colours (render-common/rocks). */
  rockTint: number;
  /** Inland sand (dunes) on dry, open ground. */
  sand: number;
  /**
   * Winter 0..1: snow on open land (grass only in sheltered spots), snow on the trees (bare
   * broadleaf crowns), a lower snow line on the rocks, and snowfall instead of rain.
   */
  snow: number;
  vegetation: ThemeVegetation;
  /** Wild animals and birds factor (1 = the meadow numbers). */
  wildlife: number;
}

const THEMES: Record<IslandTheme, ThemeParameters> = {
  meadow: {
    clover: 1,
    cover: { density: 1, dry: 0, flowers: 1, tint: [1, 1, 1] },
    dirt: 0,
    forest: 0,
    gravel: 0,
    moisture: 1,
    riverWidth: 1,
    rockBuffer: { dirt: 1, sand: 0, snow: 0 },
    rockTint: 0,
    sand: 0,
    snow: 0,
    vegetation: {
      broadleaf: 1,
      conifer: 0,
      coastPalms: 1,
      flowers: 1,
      glades: 1,
      inlandGroves: 1,
      palm: 0,
      sandPalms: 1,
      shrubDensity: 1,
      shrubEdgeMargin: 0.75,
      solitaryTrees: 1,
      warmth: 0,
      tufts: 0
    },
    wildlife: 1
  },
  desert: {
    clover: 0,
    cover: { density: 0.5, dry: 0.6, flowers: 0.1, tint: [1.3, 1.02, 0.6] },
    dirt: 0.25,
    forest: -1,
    gravel: 0.12,
    moisture: 0.25,
    riverWidth: 0.7,
    rockBuffer: { dirt: 0, sand: 1, snow: 0 },
    rockTint: 0.6,
    sand: 0.92,
    snow: 0,
    vegetation: {
      broadleaf: 1,
      conifer: 0,
      coastPalms: 1,
      flowers: 0.1,
      glades: 1,
      inlandGroves: 0.06,
      palm: 0.85,
      sandPalms: 0.3,
      shrubDensity: 0.15,
      shrubEdgeMargin: 0.75,
      solitaryTrees: 0.25,
      warmth: 1,
      tufts: 0.05
    },
    wildlife: 1
  },
  dirt: {
    clover: 0.3,
    cover: { density: 0.65, dry: 0.4, flowers: 0.3, tint: [1.12, 0.94, 0.68] },
    dirt: 0.8,
    forest: -0.55,
    gravel: 0.35,
    moisture: 0.55,
    riverWidth: 1,
    rockBuffer: { dirt: 1, sand: 0, snow: 0 },
    rockTint: 0.3,
    sand: 0,
    snow: 0,
    vegetation: {
      broadleaf: 1,
      conifer: 0.5,
      coastPalms: 1,
      flowers: 0.3,
      glades: 1,
      inlandGroves: 1,
      palm: 0,
      sandPalms: 1,
      shrubDensity: 0.9,
      shrubEdgeMargin: 0.5,
      solitaryTrees: 0.6,
      warmth: 0.45,
      tufts: 0.04
    },
    wildlife: 1
  },
  snowy: {
    clover: 0,
    cover: { density: 0.3, dry: 0.5, flowers: 0, tint: [0.86, 0.9, 0.86] },
    dirt: 0.1,
    forest: 0,
    gravel: 0.12,
    moisture: 0.8,
    riverWidth: 0.85,
    rockBuffer: { dirt: 0, sand: 0, snow: 1 },
    rockTint: 0,
    sand: 0,
    snow: 1,
    vegetation: {
      broadleaf: 1,
      conifer: 0.75,
      coastPalms: 0,
      flowers: 0,
      glades: 1,
      inlandGroves: 0,
      palm: 0,
      sandPalms: 0,
      shrubDensity: 0.4,
      shrubEdgeMargin: 0.4,
      solitaryTrees: 0.5,
      warmth: 0,
      tufts: 0.03
    },
    wildlife: 0.45
  }
};

export const isIslandTheme = (value: unknown): value is IslandTheme =>
  ISLAND_THEMES.some((theme) => theme === value);

export const getThemeParameters = (theme: IslandTheme) => THEMES[theme];

type Blendable = number | readonly Blendable[] | { readonly [key: string]: Blendable };

/** Weighted sum of the same parameter in every theme (numbers, tuples and nested records). */
const blendValue = (values: Blendable[], weights: number[]): Blendable => {
  const first = values[0]!;
  if (typeof first === "number") {
    return values.reduce<number>(
      (sum, value, index) => sum + (value as number) * weights[index]!,
      0
    );
  }
  if (Array.isArray(first)) {
    return first.map((_, item) =>
      blendValue(
        values.map((value) => (value as Blendable[])[item]!),
        weights
      )
    );
  }
  const keys = Object.keys(first);
  return Object.fromEntries(
    keys.map((key) => [
      key,
      blendValue(
        values.map((value) => (value as Record<string, Blendable>)[key]!),
        weights
      )
    ])
  );
};

/**
 * Parameters of a theme mix (weights in ISLAND_THEMES order, any scale): a single theme is its
 * exact table entry, a mix interpolates every table value by weight.
 */
export const blendThemes = (weights: ArrayLike<number>): ThemeParameters => {
  let total = 0;
  let only = -1;
  for (let index = 0; index < THEME_COUNT; index += 1) {
    const weight = weights[index] ?? 0;
    if (weight <= 0) continue;
    total += weight;
    only = only === -1 ? index : -2;
  }
  if (only >= 0) return THEMES[ISLAND_THEMES[only]!];
  if (total <= 0) return THEMES.meadow;
  const normalised = ISLAND_THEMES.map((_, index) => (weights[index] ?? 0) / total);
  const tables = ISLAND_THEMES.map((theme) => THEMES[theme] as unknown as Blendable);
  return blendValue(tables, normalised) as unknown as ThemeParameters;
};

/** Glade share left at the maximum forest amount (2): dense forest stays dense. */
const MANY_FOREST_GLADES = 0.3;

/**
 * The theme with the world's forest amount applied to the tree rules: above the default the
 * dense forest keeps fewer inner glades (the mask alone saturates and would only add glades).
 */
export const applyForestAmount = (theme: ThemeParameters, amount: number): ThemeParameters => {
  if (amount <= 1) return theme;
  const glades = 1 - Math.min(1, amount - 1) * (1 - MANY_FOREST_GLADES);
  return { ...theme, vegetation: { ...theme.vegetation, glades } };
};
