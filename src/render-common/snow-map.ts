import {
  getThemeParameters,
  ISLAND_THEMES,
  THEME_COUNT
} from "../shared/world/generation/island-themes";
import { createThemeSampler } from "../shared/world/generation/theme-field";
import { sampleBilinear } from "../shared/world/grid-geometry";
import { clamp01 } from "../shared/world/noise";
import type { WorldData } from "../shared/world/world-data";
import { computeSnowKeep } from "./snow-distribution";

/**
 * Winter per area for the renderers: the theme's snow (0..1) per vertex, uploaded as a world
 * sized texture (uSnowMap, one texel per vertex, red channel). Trees carry snow and drop their
 * leaves, the rocks get a lower snow line, the precipitation turns to snow.
 */
export interface SnowMap {
  /** True when the G channel carries the snow keep field (winter areas or a forced winter look). */
  distribution: boolean;
  /** True when any area of the world has snow (the renderers skip the winter code otherwise). */
  hasSnow: boolean;
  height: number;
  pixels: Uint8Array;
  /** True while the global season can show snow (T1): the GPU snow cover ramp is compiled (SEASON_SNOW). */
  seasonSnow?: boolean;
  /** True under the cosmetic global winter: the whole shore reads frozen (no wet gloss). */
  visualWinter?: boolean;
  /** Snow 0..1 at a world position (bilinear). */
  sample: (x: number, z: number) => number;
  width: number;
}

/** True when any area of the world has a theme with snow (a scan of the theme weights). */
export const hasWinterAreas = ({ themeWeights }: WorldData) => {
  const slots = ISLAND_THEMES.flatMap((theme, slot) =>
    getThemeParameters(theme).snow > 0 ? [slot] : []
  );
  for (let index = 0; index < themeWeights.length; index += THEME_COUNT) {
    if (slots.some((slot) => themeWeights[index + slot]! > 0)) return true;
  }
  return false;
};

export const createSnowMap = (
  world: WorldData,
  options: { seasonSnow?: boolean; visualWinter?: boolean } = {}
): SnowMap => {
  const theme = createThemeSampler(world, world.themeWeights);
  const width = world.cellsX + 1;
  const height = world.cellsZ + 1;
  const values = new Float32Array(width * height);
  const pixels = new Uint8Array(width * height * 4);
  const hasSnow = hasWinterAreas(world);
  const distribution = hasSnow || options.visualWinter === true || options.seasonSnow === true;
  const keep = distribution ? computeSnowKeep(world) : null;
  for (let vertex = 0; vertex < values.length; vertex += 1) {
    const snow = theme.atVertex(vertex).snow;
    values[vertex] = snow;
    pixels[vertex * 4] = Math.round(snow * 255);
    pixels[vertex * 4 + 1] = keep ? Math.round(clamp01(keep[vertex]!) * 255) : 255;
    pixels[vertex * 4 + 3] = 255;
  }
  return {
    distribution,
    hasSnow,
    height,
    pixels,
    sample: (x, z) => sampleBilinear(world, values, x, z),
    seasonSnow: options.seasonSnow === true,
    visualWinter: options.visualWinter === true,
    width
  };
};


/**
 * GLSL (needs COMMON_UNIFORMS): the snow map at a world position. Texel centres sit on the
 * vertices; scenes without a map (uWorldSize 0) bind NO_SNOW_PIXELS.
 */
export const SNOW_MAP_GLSL = `
uniform sampler2D uSnowMap;

float getSnowMap(vec2 xz) {
  vec2 texels = vec2(textureSize(uSnowMap, 0));
  return texture(uSnowMap, (xz + 0.5) / texels).r;
}

float getSnowKeep(vec2 xz) {
  vec2 texels = vec2(textureSize(uSnowMap, 0));
  return texture(uSnowMap, (xz + 0.5) / texels).g;
}
`;
