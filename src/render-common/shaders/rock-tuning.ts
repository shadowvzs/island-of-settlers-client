/**
 * Cliff material constants shared by `rock-glsl.ts`, `rock-form-glsl.ts`, `rock-snow-glsl.ts`,
 * `mine-glsl.ts` and the TSL rock port (single source, G-W6). The values are unchanged from the
 * former GLSL literals; the GLSL templates interpolate them byte-identically with `glslLiteral`.
 */

/** World units of one packed rock texture tile. */
export const ROCK_TILE = 0.19;

/** Finer tile of the close-up stone detail octave (relative to ROCK_TILE). */
export const ROCK_STONE_DETAIL_SCALE = 2.7;

/** Strength of the broad plane snapping on mountain rock (standalone stones stay smooth). */
export const ROCK_PLANE_STRENGTH = 0.7;

/** How far the skin's form normal leans to the landform (broad faces over relief bumps). */
export const ROCK_MACRO_FORM_PULL = 0.5;

/** Azimuth sectors and tilt steps (radians) of the broad rock planes. */
export const ROCK_PLANE_SECTORS = 7;
export const ROCK_PLANE_SECTOR = 6.2831853 / ROCK_PLANE_SECTORS;
export const ROCK_PLANE_TILT = 0.3926991;
export const ROCK_PLANE_SOFTNESS = 0.24;

/** Snow line (world height): the top of the snow ground band (7 .. 7.8). */
export const ROCK_SNOW_LINE = 7.55;

/** How far the snow line comes down in a fully snowy (winter theme) area: to the lowland. */
export const ROCK_WINTER_SNOW_LINE_DROP = 7.5;

/** Ore codes of a surveyed mine field (`mine-glsl.ts` and `rock-glsl.ts`). */
export const ORE_CODES = {
  coal: 1,
  granite: 4,
  gold: 3,
  iron: 2
} as const;
