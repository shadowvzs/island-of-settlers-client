import {
  AUTUMN_LEAF_LUMA,
  AUTUMN_LUMA_RANGE,
  AUTUMN_PALETTES,
  DORMANT_TONES,
  MONSOON_DEEPEN,
  MONSOON_SATURATION,
  SEASON_CLASS,
  SPRING_PALETTES
} from "./season-palettes";

type Rgb = readonly [number, number, number];

/** The season weights the GPU tint reads (uSeason): autumn, dormant, spring, monsoon. */
export interface LeafSeason {
  autumn: number;
  dormant: number;
  monsoon?: number;
  spring: number;
}

const mixRgb = (from: Rgb, to: Rgb, amount: number): Rgb =>
  [0, 1, 2].map(channel => from[channel]! + (to[channel]! - from[channel]!) * amount) as unknown as Rgb;

const scaleRgb = (colour: Rgb, factor: number): Rgb => colour.map(value => value * factor) as unknown as Rgb;

const lumaOf = (colour: Rgb) => colour[0] * 0.3 + colour[1] * 0.59 + colour[2] * 0.11;

/** season-glsl turnMonsoon: more saturation, then a deep wet green. */
const monsoonTone = (colour: Rgb): Rgb => {
  const grey = lumaOf(colour);
  return colour.map((value, channel) =>
    Math.max(0, grey + (value - grey) * (1 + MONSOON_SATURATION)) * MONSOON_DEEPEN[channel]!) as unknown as Rgb;
};

const leafLight = (colour: Rgb) => {
  const luma = lumaOf(colour);
  return Math.min(AUTUMN_LUMA_RANGE[1], Math.max(AUTUMN_LUMA_RANGE[0], luma / AUTUMN_LEAF_LUMA));
};

/**
 * CPU twin of the GPU season tint (season-glsl turnSeason, oak class) for the falling leaves of a felled
 * tree: shade i (fresh, mid, yellowing) takes the autumn base/hot/pale tone, the dormant dry tones and the
 * spring young leaves and the monsoon's deep green, keeping its own lightness. Three colours per frame, no shader
 * change.
 */
export const getSeasonLeafShades = (shades: readonly Rgb[], season: LeafSeason): Rgb[] => {
  const budMode = Math.min(1, season.spring / 0.3);
  const dry = season.dormant * (1 - budMode * budMode * (3 - 2 * budMode));
  return shades.map((shade, index) => {
    const light = leafLight(shade);
    const autumn = AUTUMN_PALETTES[SEASON_CLASS.oak][index % 3]!;
    const young = SPRING_PALETTES[SEASON_CLASS.oak][index % 2]!;
    const turned = mixRgb(shade, scaleRgb(autumn, light), season.autumn);
    const dried = mixRgb(turned, scaleRgb(DORMANT_TONES[index % 2]!, light), dry);
    const sprung = mixRgb(dried, scaleRgb(young, light), season.spring);
    return mixRgb(sprung, monsoonTone(sprung), season.monsoon ?? 0);
  });
};
