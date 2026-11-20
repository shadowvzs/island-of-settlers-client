import {
  ROCK_PALETTES,
  type RockPaletteId,
  SAND_PALETTES,
  type SandPaletteId,
  SOIL_PALETTES,
  type SoilPaletteId
} from "@shared/catalog";

/**
 * Island ground palette (GROUND-PALETTE, owner 2026-11-17): the colour family of the beach sand and the
 * bare soil. Render only: the sand and dirt layers keep their gameplay, only their tint changes. An
 * absent palette (or an absent field) is automatic: the island theme and nation choose it
 * (render-common/ground-palette.ts, from the nation data's terrain affinity). The map editor stores an
 * explicit choice in the map header.
 */
export { ROCK_PALETTES, SAND_PALETTES, SOIL_PALETTES };
export type { RockPaletteId, SandPaletteId, SoilPaletteId };

/** An island's explicit palette choice; each absent field stays automatic. */
export interface GroundPalette {
  rock?: RockPaletteId;
  sand?: SandPaletteId;
  soil?: SoilPaletteId;
}

const isMember = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && list.includes(value as T);

export const isSandPalette = (value: unknown): value is SandPaletteId => isMember(SAND_PALETTES, value);
export const isSoilPalette = (value: unknown): value is SoilPaletteId => isMember(SOIL_PALETTES, value);
export const isRockPalette = (value: unknown): value is RockPaletteId => isMember(ROCK_PALETTES, value);

const PALETTE_FIELDS: Record<keyof GroundPalette, (value: unknown) => boolean> = {
  rock: isRockPalette,
  sand: isSandPalette,
  soil: isSoilPalette
};

/** A saved palette: an object with only known, valid fields. */
export const validGroundPalette = (value: unknown): value is GroundPalette => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, field]) =>
    Object.hasOwn(PALETTE_FIELDS, key) && (field === undefined || PALETTE_FIELDS[key as keyof GroundPalette](field)));
};
