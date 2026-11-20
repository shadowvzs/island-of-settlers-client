import type { NationTerrainAffinity } from "@shared/catalog";

import type { Nation } from "../../../../../island-of-settlers-shared/src/nations";
import { getNationTerrainAffinity } from "../nation-terrain-affinity";
import { type ThemeParameters, type ThemeVegetation } from "./island-themes";

/** Share of a homeland's palm weight that reaches inland away from the coast (the coast keeps its belt). */
const INLAND_PALM_SHARE = 0.35;
/** River amount a wet homeland keeps at the "off" setting, per unit of its multiplier above 1. */
const OFF_RIVER_SHARE = 0.5;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * NATION-TERRAIN (owner 2026-11-18): the nation homeland's tree-mix and forest lean, applied to the themes every
 * generation rule reads (tree species, forest masks, materials). A bias, not a rule: the same generator invariants
 * and guarantees run afterwards, and an absent affinity returns the exact theme table entry.
 */
export const applyNationTerrainAffinity = (
  theme: ThemeParameters, affinity: NationTerrainAffinity | undefined
): ThemeParameters => {
  if (!affinity) return theme;
  const { trees } = affinity;
  const palms = clamp01(trees.palms);
  const vegetation: ThemeVegetation = {
    ...theme.vegetation,
    broadleaf: theme.vegetation.broadleaf * trees.broadleaf,
    conifer: clamp01(theme.vegetation.conifer + trees.conifer),
    palm: Math.max(theme.vegetation.palm, palms * INLAND_PALM_SHARE),
    sandPalms: Math.max(theme.vegetation.sandPalms, palms),
    warmth: palms > 0 ? Math.max(theme.vegetation.warmth, 1) : theme.vegetation.warmth
  };
  return { ...theme, forest: theme.forest + trees.forest, vegetation };
};

/** The homeland affinity of generation options (the nation whose landscape the island leans to). */
export const getOptionsNationAffinity = (
  options: { nation?: Nation }
): NationTerrainAffinity | undefined => getNationTerrainAffinity(options.nation);

/**
 * River amount of a homeland: a wet nation keeps a few streams even at the "off" setting, a dry one thins the
 * requested rivers; `off` stays off for a nation that is not wetter than the temperate default.
 */
export const nationRiverAmount = (requested: number, affinity: NationTerrainAffinity | undefined) => {
  const multiplier = affinity?.water.rivers ?? 1;
  if (multiplier === 1) return requested;
  if (requested <= 0) return multiplier > 1 ? (multiplier - 1) * OFF_RIVER_SHARE : 0;
  return requested * multiplier;
};

/** Ground wetness multiplier of a homeland (1 = the temperate default). */
export const nationWetness = (affinity: NationTerrainAffinity | undefined) => affinity?.water.wetness ?? 1;
