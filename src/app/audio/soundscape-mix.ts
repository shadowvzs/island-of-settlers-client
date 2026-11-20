import { clamp, smoothstep } from "../../shared/world/noise";
import type { SoundLayer } from "../settings/sound-settings";
import type { CreatureSoundKind, LoopLayer } from "./synth/sound-bank";

/** Features the listener hears around the camera target, each 0..1 (see world-sound-field). */
export interface SoundSample {
  broadleaf: number;
  /** Open grassland (crickets at night). */
  meadow: number;
  /** Stereo position of each feature, -1 left .. 1 right. */
  pan: Record<SoundFeature, number>;
  palm: number;
  pine: number;
  river: number;
  /** Mean flow speed of the heard river water, 0 still .. 1 fast (rapids, falls). */
  riverSpeed: number;
  /** Open sea share. */
  sea: number;
  /** Surf zone (shallow sea along the land) share: breaking waves. */
  shore: number;
}

export type SoundFeature = "broadleaf" | "meadow" | "palm" | "pine" | "river" | "sea" | "shore";

export const SOUND_FEATURES: readonly SoundFeature[] = [
  "broadleaf",
  "meadow",
  "palm",
  "pine",
  "river",
  "sea",
  "shore"
];

export interface SoundConditions {
  /** 0 night .. 1 day (EnvironmentState.daylight). */
  daylight: number;
  /** Clock hour 0..24 (dawn chorus vs. evening). */
  hour: number;
  /** 0 dry .. 1 heavy rain. */
  rain: number;
  /** 0 none .. 1 heavy snowfall (never together with rain). */
  snow: number;
  /** Wind strength (length of the environment wind vector, about 0.9 calm .. 2.1 storm). */
  wind: number;
  zoom: number;
}

export interface LayerMix {
  gains: Record<LoopLayer, number>;
  pans: Record<LoopLayer, number>;
  /** 0..1 rate and level of the forest birdsong bed (one-shot songbird phrases). */
  forestBirdsong: number;
  /** Overall level of the environment bus from the zoom (zoomed out: softer). */
  level: number;
  /** Master low pass in Hz from the zoom (zoomed out: duller, broader). */
  lowpass: number;
}

/** Zoomed out the mix is softer; close up it is at full level. */
export const getZoomLevel = (zoom: number) => 0.5 + 0.5 * smoothstep(0.2, 1.4, zoom);

/** Zoomed out, distant detail (leaf ticks, drops) blurs: the mix gets duller. */
const getZoomLowpass = (zoom: number) => 5500 + 12500 * smoothstep(0.2, 1.6, zoom);

/** Leaves move more in stronger wind (calm still rustles a little). */
const getWindFactor = (wind: number) => clamp(0.35 + 0.45 * wind, 0.4, 1.3);

/**
 * Gust envelope 0..1 at `time` seconds: incommensurate slow waves, so gusts never repeat; a
 * stronger wind gusts deeper.
 */
export const getGust = (time: number, wind: number) => {
  const wave =
    Math.sin(time * 0.31) * 0.5 +
    Math.sin(time * 0.173 + 1.7) * 0.3 +
    Math.sin(time * 0.77 + 4) * 0.2;
  const depth = clamp(0.35 + 0.25 * wind, 0.3, 0.9);
  return clamp(0.5 + 0.5 * wave * depth * 1.6, 0, 1);
};

/**
 * Songbird activity over the day: silent at night, the dawn chorus is the peak, quieter at
 * midday, a short evening song, fading out at dusk.
 */
export const getDawnChorus = (hour: number) => {
  const h = ((hour % 24) + 24) % 24;
  if (h < 4.5 || h > 20) return 0;
  if (h < 6) return smoothstep(4.5, 6, h);
  if (h < 9) return 1;
  if (h < 11) return 1 - 0.5 * smoothstep(9, 11, h);
  if (h < 16.5) return 0.5;
  if (h < 17.8) return 0.5 + 0.1 * smoothstep(16.5, 17.8, h);
  return 0.6 * (1 - smoothstep(17.8, 20, h));
};

/** Heavy snowfall quiets the wildlife a little less than heavy rain. */
const SNOW_HUSH = 0.7;

/**
 * Rain (and snowfall) hush birds: little change in drizzle, almost silent in heavy rain.
 */
const getRainHush = ({ rain, snow }: SoundConditions) =>
  1 - 0.85 * smoothstep(0.15, 0.8, Math.max(rain, snow * SNOW_HUSH));

/**
 * Feature share at which a layer plays at full level. Rivers and the surf zone are thin lines,
 * so a small share of the heard area is already loud; palms grow in loose groves.
 */
const FULL_PRESENCE: Record<SoundFeature, number> = {
  broadleaf: 0.35,
  meadow: 0.5,
  palm: 0.12,
  pine: 0.3,
  river: 0.1,
  sea: 0.7,
  shore: 0.15
};

/** 0..1 how strongly a feature is heard (share relative to its full level, slightly eased). */
const getPresence = (sample: SoundSample, feature: SoundFeature) =>
  Math.pow(clamp(sample[feature] / FULL_PRESENCE[feature], 0, 1), 0.8);

/** Canopy density for songbirds and rain on leaves (palm groves count less). */
const getForestDensity = (sample: SoundSample) =>
  clamp(
    getPresence(sample, "broadleaf") +
      getPresence(sample, "pine") * 0.8 +
      getPresence(sample, "palm") * 0.4,
    0,
    1
  );

/** Forest birdsong bed 0..1: forest density x time of day x rain. Independent of bird entities. */
export const getForestBirdsongGain = (sample: SoundSample, conditions: SoundConditions) =>
  smoothstep(0.1, 0.8, getForestDensity(sample)) *
  getDawnChorus(conditions.hour) *
  getRainHush(conditions);

/** Crickets in meadows (and lighter at forest edges) at night; rain or snow stops them. */
export const getCricketGain = (sample: SoundSample, conditions: SoundConditions) => {
  const night = 1 - smoothstep(0.1, 0.6, conditions.daylight);
  const ground = clamp(getPresence(sample, "meadow") + getForestDensity(sample) * 0.25, 0, 1);
  const cold = Math.max(conditions.rain, conditions.snow);
  return smoothstep(0.1, 0.7, ground) * night * (1 - smoothstep(0.1, 0.6, cold));
};

const getWaterGains = (sample: SoundSample, conditions: SoundConditions) => {
  const surf = 0.75 + 0.25 * clamp(conditions.wind - 0.9, 0, 1);
  const shore = getPresence(sample, "shore");
  return {
    river: getPresence(sample, "river") * (0.6 + 0.4 * sample.riverSpeed),
    seaBreakers: shore * surf,
    seaSwell: clamp(getPresence(sample, "sea") * 0.8 + shore * 0.4, 0, 1)
  };
};

const getTreeGains = (sample: SoundSample, conditions: SoundConditions) => {
  const wind = getWindFactor(conditions.wind);
  return {
    broadleaf: getPresence(sample, "broadleaf") * wind,
    palm: getPresence(sample, "palm") * wind,
    pine: getPresence(sample, "pine") * wind * 0.9
  };
};

/** Rain hiss and rain on leaves, or the quiet snowfall bed (muffled wind, creaks, settling). */
const getWeatherGains = (sample: SoundSample, conditions: SoundConditions) => {
  const rain = clamp(conditions.rain, 0, 1);
  const forest = getForestDensity(sample);
  return {
    rain: Math.pow(rain, 0.8) * (0.85 - 0.25 * forest),
    rainLeaves: rain * smoothstep(0.05, 0.7, forest),
    snowfall: Math.pow(clamp(conditions.snow, 0, 1), 0.8)
  };
};

const getPans = (sample: SoundSample): Record<LoopLayer, number> => ({
  broadleaf: sample.pan.broadleaf,
  crickets: sample.pan.meadow,
  palm: sample.pan.palm,
  pine: sample.pan.pine,
  rain: 0,
  rainLeaves: 0,
  river: sample.pan.river,
  seaBreakers: sample.pan.shore,
  seaSwell: sample.pan.sea,
  snowfall: 0
});

const gate = (enabled: boolean, gains: Record<string, number>) => {
  if (enabled) return gains;
  return Object.fromEntries(Object.keys(gains).map((key) => [key, 0]));
};

/** Every layer's target gain and pan for one world sample (pure; applied with smoothing). */
export const computeLayerMix = (
  sample: SoundSample,
  conditions: SoundConditions,
  layersOff: ReadonlySet<SoundLayer>
): LayerMix => {
  const on = (layer: SoundLayer) => !layersOff.has(layer);
  const wildlife = gate(on("wildlife"), {
    crickets: getCricketGain(sample, conditions),
    forestBirdsong: getForestBirdsongGain(sample, conditions)
  });
  const gains = {
    ...gate(on("water"), getWaterGains(sample, conditions)),
    ...gate(on("trees"), getTreeGains(sample, conditions)),
    ...gate(on("rain"), getWeatherGains(sample, conditions)),
    crickets: wildlife.crickets!
  } as Record<LoopLayer, number>;
  return {
    forestBirdsong: wildlife.forestBirdsong!,
    gains,
    level: getZoomLevel(conditions.zoom),
    lowpass: getZoomLowpass(conditions.zoom),
    pans: getPans(sample)
  };
};

interface CallHabit {
  /** Daytime species fall silent at night; nocturnal ones get louder. */
  activeAtNight: boolean;
  /** Calls per second per creature in view, and the crowd size that saturates it. */
  perCreature: number;
  saturation: number;
}

/** Mammals call rarely (a deer bark, an elk far off, a rabbit rustling); birds more often. */
const CALL_HABITS: Record<CreatureSoundKind, CallHabit> = {
  crow: { activeAtNight: false, perCreature: 0.08, saturation: 4 },
  deer: { activeAtNight: true, perCreature: 0.012, saturation: 3 },
  elk: { activeAtNight: true, perCreature: 0.006, saturation: 2 },
  gull: { activeAtNight: false, perCreature: 0.12, saturation: 5 },
  rabbit: { activeAtNight: true, perCreature: 0.03, saturation: 4 },
  songbird: { activeAtNight: false, perCreature: 0.18, saturation: 6 },
  swift: { activeAtNight: false, perCreature: 0.1, saturation: 6 }
};

/** Calls per second of the `count` creatures of a kind in view (quieter at night, in rain). */
export const getCreatureCallRate = (
  kind: CreatureSoundKind,
  count: number,
  conditions: SoundConditions
) => {
  if (count <= 0) return 0;
  const habit = CALL_HABITS[kind];
  const crowd = Math.min(count, habit.saturation);
  const time = habit.activeAtNight ? 0.6 + 0.4 * (1 - conditions.daylight) : conditions.daylight;
  return habit.perCreature * crowd * time * getRainHush(conditions);
};
