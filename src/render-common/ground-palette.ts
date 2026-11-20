import { nationTerrainAffinity } from "@shared/catalog";

import type { Nation } from "../../../island-of-settlers-shared/src/nations";
import type { ExpeditionTheme } from "../shared/settlement/island-discovery-policy";
import { ISLAND_THEMES, type IslandTheme, THEME_COUNT } from "../shared/world/generation/island-themes";
import type { GroundPalette, RockPaletteId, SandPaletteId, SoilPaletteId } from "../shared/world/ground-palette";

/**
 * Ground palette tints (GROUND-PALETTE, owner 2026-11-17), shared by the GLSL grounds (full, lite) and the
 * TSL twin. Each palette is the multiplier of the painted tile's colour (per channel), so its grain and
 * relief stay; tan sand and brown soil are the painted tiles (1, 1, 1). The ground mixes the palettes of
 * the vertex's theme weights (`theme` attribute, ISLAND_THEMES order): one matrix column per theme.
 * `wet` is the sand's albedo factor when saturated (applyGroundWetness): white sand stays light, grey and
 * black sand darken more. About half the darkening of other wet ground (ground-palette-3, coordinator
 * 2026-11-17): the soaked swash zone measured 0.57 of dry sand against 0.93 in the owner's footage (TOOL-8);
 * these values bring the default (tan) swash zone to about 0.8 of dry, the damp band keeps its gradient. Values are display-space ratios against the painted tile means
 * (sand 159/146/125, soil 99/78/56; material-textures seed 1234).
 */
interface SandTint { rgb: readonly [number, number, number]; wet: number; }

export const SAND_TINTS: Record<SandPaletteId, SandTint> = {
  tan: { rgb: [1, 1, 1], wet: 0.85 },
  white: { rgb: [1.06, 1.13, 1.24], wet: 0.9 },
  golden: { rgb: [1.13, 1.0, 0.72], wet: 0.86 },
  grey: { rgb: [0.8, 0.86, 0.97], wet: 0.82 },
  red: { rgb: [1.12, 0.78, 0.58], wet: 0.84 },
  black: { rgb: [0.42, 0.45, 0.51], wet: 0.8 },
  /** Coral pink (step 4, editor choice only): light, a rosy blush from red coral and shell fragments. */
  pink: { rgb: [1.17, 1.0, 1.06], wet: 0.89 }
};

export const SOIL_TINTS: Record<SoilPaletteId, readonly [number, number, number]> = {
  brown: [1, 1, 1],
  terraRossa: [1.05, 0.86, 0.82],
  laterite: [1.12, 0.84, 0.72],
  darkBrown: [0.76, 0.74, 0.8],
  loess: [1.32, 1.32, 1.18],
  /**
   * Chalk soil (step 5, Mediterranean): warm cream about 166/152/124 display, never snow white (the snow tile reads
   * about 230/236/245); editor choice.
   */
  chalk: [1.68, 1.95, 2.2],
  /** Volcanic ash (step 5): cool mid grey about 92/88/84, flatter than the brown soil; editor choice. */
  ash: [0.93, 1.13, 1.5]
};

/**
 * Rock tints (step 5): multipliers of the rock and the grey apron of the gentle mountain rock (the walls' grey stone
 * about 104/106/109), so the beds and grain stay. `lava` lays the basalt tile over the gentler rock.
 */
interface RockTint { rgb: readonly [number, number, number]; lava: number; }

export const ROCK_TINTS: Record<RockPaletteId, RockTint> = {
  grey: { rgb: [1, 1, 1], lava: 0 },
  /** Red sandstone of the Nubian and Persian deserts (about 158/94/66). */
  redSandstone: { rgb: [1.32, 0.86, 0.6], lava: 0 },
  /** Golden sandstone / ochre limestone (about 150/128/88). */
  golden: { rgb: [1.34, 1.16, 0.86], lava: 0 },
  /** Cream limestone (about 123/120/107): warm, clearly darker than snow (the tile is already pale). */
  limestone: { rgb: [1.18, 1.13, 0.98], lava: 0 },
  /** Dark basalt (about 52/52/55) with the basalt tile on the gentle rock. */
  basalt: { rgb: [0.5, 0.49, 0.5], lava: 1 }
};

interface ClimatePalette {
  rock: RockPaletteId;
  sand: SandPaletteId;
  soil: SoilPaletteId;
  /** Swamp share 0..1: bare soil turns into swamp mud (render-only variant; step 2). */
  swamp?: number;
  /** Heather moorland share 0..1 on exposed grass (step 5: cold, windy Viking and snowy land). */
  heather?: number;
  /** Tropical jungle floor share 0..1 (step 7): the forest floor turns dark, damp, warm olive. */
  jungle?: number;
}

const TEMPERATE: ClimatePalette = { rock: "grey", sand: "tan", soil: "brown" };

/**
 * Home climate of a nation, read from the nation content data's landscape affinity (NATION-TERRAIN): the palette's
 * render default and its heather/jungle climate shares. A nation without an affinity keeps the temperate land.
 */
const getNationClimate = (nation: Nation): ClimatePalette => {
  const palette = nationTerrainAffinity(nation)?.palette;
  if (!palette) return TEMPERATE;
  return {
    ...(palette.heather === undefined ? {} : { heather: palette.heather }),
    ...(palette.jungle === undefined ? {} : { jungle: palette.jungle }),
    rock: palette.rock,
    sand: palette.sand,
    soil: palette.soil
  };
};

/** Expedition islands with their own climate (their meadow and dirt land). */
const EXPEDITION_CLIMATE: Partial<Record<ExpeditionTheme, ClimatePalette>> = {
  swamp: { rock: "grey", sand: "tan", soil: "darkBrown", swamp: 1 },
  tropical: { jungle: 1, rock: "grey", sand: "white", soil: "laterite" }
};

const DESERT: ClimatePalette = { rock: "golden", sand: "golden", soil: "terraRossa" };
/** Red/ochre deserts of the Nubian and Persian homelands. */
const RED_DESERT: ClimatePalette = { rock: "redSandstone", sand: "red", soil: "laterite" };
/** Snowy land: grey rock, and heather where the grass shows (cold moor). */
const SNOWY: ClimatePalette = { heather: 0.7, rock: "grey", sand: "grey", soil: "darkBrown" };

/** What the automatic palette reads besides the island's own choice. */
export interface GroundPaletteContext {
  expeditionTheme?: ExpeditionTheme;
  nation?: Nation;
}

const getHomeClimate = ({ expeditionTheme, nation }: GroundPaletteContext) =>
  (expeditionTheme && EXPEDITION_CLIMATE[expeditionTheme]) ?? (nation ? getNationClimate(nation) : TEMPERATE);

const getThemeClimate = (theme: IslandTheme, context: GroundPaletteContext): ClimatePalette => {
  if (theme === "snowy") return SNOWY;
  if (theme !== "desert") return getHomeClimate(context);
  return context.nation === "nubian" || context.nation === "persian" ? RED_DESERT : DESERT;
};

/** The palette of every theme slot: the island's explicit choice wins, else theme and nation choose. */
export const resolveThemePalettes = (palette: GroundPalette | undefined, context: GroundPaletteContext) =>
  ISLAND_THEMES.map((theme): ClimatePalette => {
    const climate = getThemeClimate(theme, context);
    return { ...climate, rock: palette?.rock ?? climate.rock, sand: palette?.sand ?? climate.sand,
      soil: palette?.soil ?? climate.soil };
  });

/**
 * Rock tint of the rock props and the mountain skin (they carry no theme weights): the theme slots' rock tints
 * weighted by the island's theme shares (`shares`: one per ISLAND_THEMES slot, summing to 1).
 */
export const getRockPropTint = (palettes: readonly ClimatePalette[], shares: readonly number[]) =>
  [0, 1, 2].map(channel => palettes.reduce((sum, palette, theme) =>
    sum + ROCK_TINTS[palette.rock].rgb[channel]! * (shares[theme] ?? 0), 0)) as [number, number, number];

/** Column-major 4×4 palette matrices of the ground (one column per theme). */
export interface GroundPaletteMatrices {
  /** Climate shares: heather, jungle floor, two spare. */
  climate: number[];
  /** Rock rgb + the basalt tile share. */
  rock: number[];
  /** Sand rgb + its wet factor. */
  sand: number[];
  /** Soil rgb + the swamp share. */
  soil: number[];
}

export const createGroundPaletteMatrices = (): GroundPaletteMatrices => ({ climate: [], rock: [], sand: [], soil: [] });

/** Fills the matrices; the ground multiplies them by the vertex theme weights. */
export const fillGroundPaletteMatrices = (palettes: readonly ClimatePalette[], matrices: GroundPaletteMatrices) => {
  for (let theme = 0; theme < THEME_COUNT; theme += 1) {
    const palette = palettes[theme]!;
    const { rgb, wet } = SAND_TINTS[palette.sand];
    const soil = SOIL_TINTS[palette.soil];
    const rock = ROCK_TINTS[palette.rock];
    matrices.sand.splice(theme * 4, 4, rgb[0], rgb[1], rgb[2], wet);
    matrices.soil.splice(theme * 4, 4, soil[0], soil[1], soil[2], palette.swamp ?? 0);
    matrices.rock.splice(theme * 4, 4, rock.rgb[0], rock.rgb[1], rock.rgb[2], rock.lava);
    matrices.climate.splice(theme * 4, 4, palette.heather ?? 0, palette.jungle ?? 0, 0, 0);
  }
};
