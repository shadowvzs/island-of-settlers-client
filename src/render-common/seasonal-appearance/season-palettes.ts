import { PROP } from "../../shared/world/world-data";

type Rgb = readonly [number, number, number];

/**
 * Foliage season classes (A1, seasons plan 11): one per prop material, so the shader knows the species
 * where the atlas cannot tell (walnut shares the oak sprays, mahogany the hardwood leaves). 0 never
 * changes: evergreens, tropical trees, buildings and everything placed by game state.
 */
export const SEASON_CLASS = {
  none: 0, oak: 1, birch: 2, cherry: 3, walnut: 4, hardwood: 5, shrub: 6
} as const;
export type SeasonClass = (typeof SEASON_CLASS)[keyof typeof SEASON_CLASS];
export const SEASON_CLASS_COUNT = 7;

/**
 * Autumn tones per class: base (most clusters), hot (deeper red/orange clusters), pale (late, yellowish
 * clusters). Albedo colours before the light: vivid and readable at gameplay distance, not neon. The
 * leaf texture's luminance is kept, so veins and folds survive the recolour.
 */
export const AUTUMN_PALETTES: Readonly<Record<SeasonClass, readonly [Rgb, Rgb, Rgb]>> = {
  [SEASON_CLASS.none]: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
  [SEASON_CLASS.oak]: [[0.80, 0.38, 0.10], [0.66, 0.20, 0.07], [0.78, 0.58, 0.20]],
  [SEASON_CLASS.birch]: [[0.96, 0.78, 0.16], [0.95, 0.60, 0.10], [0.86, 0.86, 0.36]],
  [SEASON_CLASS.cherry]: [[0.80, 0.14, 0.10], [0.92, 0.40, 0.10], [0.72, 0.22, 0.28]],
  [SEASON_CLASS.walnut]: [[0.90, 0.76, 0.20], [0.84, 0.56, 0.14], [0.66, 0.70, 0.28]],
  [SEASON_CLASS.hardwood]: [[0.82, 0.44, 0.14], [0.70, 0.26, 0.10], [0.84, 0.62, 0.24]],
  [SEASON_CLASS.shrub]: [[0.84, 0.40, 0.07], [0.70, 0.18, 0.05], [0.86, 0.64, 0.12]]
};

/**
 * D1 dormant (snow-free late autumn / early spring): the share of leaf clusters a bare broadleaf keeps,
 * per class. Oaks hold some dry leaves through the winter (marcescence); the rest drop almost all.
 */
export const DORMANT_KEEP: Readonly<Record<SeasonClass, number>> = {
  [SEASON_CLASS.none]: 1,
  [SEASON_CLASS.oak]: 0.12,
  [SEASON_CLASS.birch]: 0.04,
  [SEASON_CLASS.cherry]: 0.04,
  [SEASON_CLASS.walnut]: 0.04,
  [SEASON_CLASS.hardwood]: 0.03,
  [SEASON_CLASS.shrub]: 0.08
};
/** Dry clinging leaves: russet brown and pale tan (albedo, luminance kept like the autumn tones). */
export const DORMANT_TONES: readonly [Rgb, Rgb] = [[0.50, 0.30, 0.14], [0.62, 0.46, 0.26]];
/**
 * Far sprites (impostors, tree views) cannot show the branches behind their baked leaves: a dormant sprite
 * keeps a few dry clusters (DORMANT_SPRITE_KEEP) and turns the rest of its crown into an airy grey-brown
 * twig haze (BARE_CROWN_TONE, about DORMANT_SPRITE_HAZE of its texels), the way a bare crown reads from afar.
 */
export const DORMANT_SPRITE_KEEP = 0.08;
export const DORMANT_SPRITE_HAZE = 0.55;
export const BARE_CROWN_TONE: Rgb = [0.30, 0.25, 0.20];

/**
 * Spring young leaves per class (SP1): base and a second, yellower flush; light, fresh green, not lime.
 * Cherry sprays are authored in blossom, so spring leaves them as painted (its row is never read).
 */
export const SPRING_PALETTES: Readonly<Record<SeasonClass, readonly [Rgb, Rgb]>> = {
  [SEASON_CLASS.none]: [[0, 0, 0], [0, 0, 0]],
  [SEASON_CLASS.oak]: [[0.40, 0.58, 0.20], [0.50, 0.60, 0.24]],
  [SEASON_CLASS.birch]: [[0.46, 0.64, 0.24], [0.55, 0.66, 0.28]],
  [SEASON_CLASS.cherry]: [[0.40, 0.58, 0.20], [0.50, 0.60, 0.24]],
  [SEASON_CLASS.walnut]: [[0.44, 0.58, 0.22], [0.52, 0.56, 0.26]],
  [SEASON_CLASS.hardwood]: [[0.40, 0.58, 0.20], [0.48, 0.60, 0.24]],
  [SEASON_CLASS.shrub]: [[0.42, 0.60, 0.20], [0.50, 0.62, 0.25]]
};

/**
 * M1 monsoon: deep, saturated lush green on every seasonal class (cherry keeps its painted blossom). The leaf
 * colour's saturation rises by MONSOON_SATURATION, then MONSOON_DEEPEN darkens it towards a deep wet green.
 */
export const MONSOON_SATURATION = 0.3;
export const MONSOON_DEEPEN: Rgb = [0.62, 0.82, 0.6];

/** Luminance of an ordinary summer leaf albedo: the recolour maps it to the palette tone. */
export const AUTUMN_LEAF_LUMA = 0.3;
/** Range of the kept leaf luminance (relative to AUTUMN_LEAF_LUMA): no washed-out or black leaves. */
export const AUTUMN_LUMA_RANGE = [0.35, 1.2] as const;

const CLASS_BY_KIND: Readonly<Partial<Record<number, SeasonClass>>> = {
  [PROP.broadleafTree]: SEASON_CLASS.oak,
  [PROP.birchTree]: SEASON_CLASS.birch,
  [PROP.walnutTree]: SEASON_CLASS.walnut,
  [PROP.hardwoodTree]: SEASON_CLASS.hardwood,
  [PROP.bush]: SEASON_CLASS.shrub,
  [PROP.berryBush]: SEASON_CLASS.shrub,
  [PROP.broadleafShrub]: SEASON_CLASS.shrub,
  [PROP.fieldShrub]: SEASON_CLASS.shrub,
  [PROP.riverShrub]: SEASON_CLASS.shrub,
  [PROP.willowShrub]: SEASON_CLASS.shrub,
  [PROP.sapling]: SEASON_CLASS.shrub
};

/** The season class of a world prop kind (conifer, cedar, palm, mahogany and the rest: none). */
export const getSeasonClass = (kind: number): SeasonClass => CLASS_BY_KIND[kind] ?? SEASON_CLASS.none;
