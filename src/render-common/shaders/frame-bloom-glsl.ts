import { LUMA_REC709 } from "../luma";
import type { BloomQuality } from "../quality";
import { COLOR_TONE_MAP_INVERSE_GLSL, COLOR_TRANSFORM_GLSL } from "./color-output-glsl";

/**
 * GLSL of the R11b HDR bloom chain (renderers/three/frame-bloom.ts), GLSL ES 3.00. The prefilter
 * reads the frame's resolved scene colour, selects the bright part by its display brightness and
 * recovers its linear radiance with the R11a inverse tonemapper; the 13-tap downsamples build the
 * mip chain and the 9-tap tent upsamples add it back onto the half-resolution level. All passes
 * draw the compositor's fullscreen triangle with the same `vUv` (0..1 over the whole frame).
 *
 * Why the selection is display-referred: the scene target holds tonemapped 8-bit pixels, so the
 * radiance recovered from them spans very different ranges by day (Neutral, the sun clips near
 * white) and at night (Filmic, a lit window reads about 0.7 display, 0.5 linear). A fixed linear
 * threshold either missed every night light or bloomed the whole daylit map. The threshold is
 * therefore a display brightness that follows the time of day (BLOOM-REFINEMENT phases, blended on
 * the CPU by render-common/bloom-phases.ts): high while the sun lights the scene, so only the sun,
 * its glints and foam pass, low at night, so lit windows, lanterns and fires pass while the dark map
 * stays out. The selected texels keep their full linear radiance
 * (clamped), so the halo carries real energy onto the darker surroundings, where the tonemapper is
 * most sensitive and the glow reads.
 *
 * The prefilter point-samples the four full-resolution texels of its half-resolution footprint and
 * selects each before averaging, so an isolated glint keeps its energy. The first downsample
 * averages its 13 taps with Karis luma weights (firefly suppression); later levels use the plain
 * 13-tap.
 */

/**
 * Time-of-day phase of the bloom (BLOOM-REFINEMENT): night (no sun), golden (a low sun at dawn and
 * dusk) and day (a high sun). Frames blend the phases continuously (bloom-phases.ts).
 */
export type BloomPhase = "day" | "golden" | "night";

/** One phase's look. */
export interface BloomPhaseTuning {
  /**
   * Extra energy of clipped texels (display brightness near 1): the 8-bit scene cannot hold the
   * sun's real radiance, so a clipped sun disc is scaled up by (1 + clippedBoost) and carries a
   * halo proportional to a light source rather than to a white wall.
   */
  clippedBoost: number;
  /**
   * 0..1: how far the clipped boost is limited to near-white texels (stored luma, see
   * BloomTuning.clipWhiteLuma). A light source (the sun disc, a glint) clips white; a sunlit
   * orange trunk or a petal clips one channel only and would otherwise glow like a lamp at dusk.
   */
  clipWhiteOnly: number;
  /**
   * Share of the blurred highlight the linear output adds back, per choice. Soft is an obvious
   * but tasteful glow; Full is stronger and cinematic. Off stays 0 and runs no chain at all.
   */
  intensity: Readonly<Record<BloomQuality, number>>;
  /** Multiplies every upsample tent radius: a wider, softer halo. */
  radiusScale: number;
  /** Display brightness (max channel, before the grade) where the selection ramp starts. */
  threshold: number;
  /** Linear multiplier of the selected radiance: the halo's colour cast (1, 1, 1 keeps the source). */
  tint: readonly [number, number, number];
}

/** How the frame's light picks its phase weights (bloom-phases.ts bloomPhaseWeights). */
export interface BloomPhaseRamp {
  /**
   * `uDaylight` from which the sunlit phases apply in full; below it the frame eases towards night.
   * Dusk (daylight about 0.5) is still fully sunlit, so sunlit trunks and walls never glow like lamps.
   */
  daylightFull: number;
  /** Sun vector height where the golden phase is full (at or below) and gone (at or above). */
  goldenSunHeight: Readonly<{ full: number; none: number }>;
}

/** Every owner-tuned bloom value. Tune here; no other module carries a magic number. */
export interface BloomTuning {
  /** Stored luma range over which a clipped texel counts as white (BloomPhaseTuning.clipWhiteOnly). */
  clipWhiteLuma: readonly [number, number];
  /**
   * Luma at which the first downsample's Karis weight halves. A weight of 1 / (1 + luma) would
   * flatten every selected texel towards 1 and erase the sun's energy before the wide mips; this
   * scale keeps real highlights and still tames single-texel fireflies far above them.
   */
  karisLuma: number;
  /** Display-brightness width of the ramp above the threshold (smoothstep). */
  knee: number;
  /** Radiance cap of a selected texel: a clipped sun or glint cannot flood the chain. */
  maxRadiance: number;
  /** Mip levels of the chain per choice (Off draws nothing). More mips spread the glow wider. */
  mipCounts: Readonly<Record<BloomQuality, number>>;
  phaseRamp: BloomPhaseRamp;
  phases: Readonly<Record<BloomPhase, BloomPhaseTuning>>;
  /**
   * Radius of the 9-tap tent upsample per source mip level, in that level's texels. The coarse
   * (last) mips use a wider tent so the halo falls off slowly instead of hugging the highlight.
   */
  upsampleRadii: readonly number[];
  /**
   * Weight of each upsample contribution per source mip level. Each level is added onto the next
   * finer one, so a weight also scales every coarser level behind it.
   */
  upsampleWeights: readonly number[];
}

export const BLOOM_TUNING: BloomTuning = {
  clipWhiteLuma: [0.82, 0.9],
  karisLuma: 8,
  knee: 0.15,
  maxRadiance: 16,
  mipCounts: { low: 3, off: 0, on: 5 },
  phaseRamp: { daylightFull: 0.35, goldenSunHeight: { full: 0.14, none: 0.3 } },
  phases: {
    // A high sun: only near-clipped glints, foam and the sun pass (no hazy sky); a tasteful glow.
    day: {
      clipWhiteOnly: 1, clippedBoost: 8, intensity: { low: 0.22, off: 0, on: 0.32 }, radiusScale: 1,
      threshold: 0.82, tint: [1, 1, 1]
    },
    // A low sun at dawn and dusk: a stronger, wider, warm halo around the sun and its path on the water.
    // Only below sun height 0.3 (game 17:15 / 6:45): a still white, high sun would blow out (17:2 blob).
    golden: {
      clipWhiteOnly: 1, clippedBoost: 10, intensity: { low: 0.24, off: 0, on: 0.36 }, radiusScale: 1.5,
      threshold: 0.8, tint: [1, 0.78, 0.52]
    },
    // R11b's look, unchanged: lit windows, lanterns, fires and stars.
    night: {
      clipWhiteOnly: 0, clippedBoost: 8, intensity: { low: 0.14, off: 0, on: 0.18 }, radiusScale: 1,
      threshold: 0.55, tint: [1, 1, 1]
    }
  },
  upsampleRadii: [1, 1, 1.25, 1.5, 2],
  upsampleWeights: [1, 1, 1, 0.7, 0.5]
};

export const BLOOM_TRIANGLE_VERTEX_GLSL = `precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * The 13-tap pattern in source texels; every tap reads a 2x2 block through the linear filter.
 * Shared with the TSL chain so the two downsample kernels cannot drift.
 */
export const BLOOM_TAP_OFFSETS: readonly (readonly [number, number])[] = [
  [-2, -2], [0, -2], [2, -2],
  [-1, -1], [1, -1],
  [-2, 0], [0, 0], [2, 0],
  [-1, 1], [1, 1],
  [-2, 2], [0, 2], [2, 2]
];

/** Weights of the 9-tap tent upsample: centre, four edges, four corners, divided by 16. */
export const BLOOM_TENT_WEIGHTS = [4, 2, 2, 2, 2, 1, 1, 1, 1] as const;
export const BLOOM_TENT_DIVISOR = 16;

/** Stored (graded display) brightness where a clipped texel starts and is fully clipped. */
export const BLOOM_CLIPPED_DISPLAY = { max: 1, min: 0.97 } as const;

const glslFloat = (value: number) => value.toFixed(1);

const BLOOM_TAPS_GLSL = `const vec2 BLOOM_TAPS[13] = vec2[13](
  ${BLOOM_TAP_OFFSETS.slice(0, 3).map(([x, y]) => `vec2(${glslFloat(x)}, ${glslFloat(y)})`).join(", ")},
  ${BLOOM_TAP_OFFSETS.slice(3, 5).map(([x, y]) => `vec2(${glslFloat(x)}, ${glslFloat(y)})`).join(", ")},
  ${BLOOM_TAP_OFFSETS.slice(5, 8).map(([x, y]) => `vec2(${glslFloat(x)}, ${glslFloat(y)})`).join(", ")},
  ${BLOOM_TAP_OFFSETS.slice(8, 10).map(([x, y]) => `vec2(${glslFloat(x)}, ${glslFloat(y)})`).join(", ")},
  ${BLOOM_TAP_OFFSETS.slice(10).map(([x, y]) => `vec2(${glslFloat(x)}, ${glslFloat(y)})`).join(", ")}
);`;

/**
 * First level (half resolution): each of the four full-resolution texels under the footprint is
 * selected by its display brightness (after the grade inverse on rgba8, COLOR_SCENE_GRADED)
 * against the frame's phase-blended threshold; only selected texels pay for the inverse tonemapper.
 * `uBloomRamp` is (threshold, knee, clip white-only share); `uBloomTint` colours the selected
 * radiance (golden hour).
 */
export const BLOOM_PREFILTER_FRAGMENT_GLSL = `precision highp float;
uniform sampler2D uScene;
uniform float uBloomClippedBoost;
uniform vec3 uBloomRamp;
uniform vec3 uBloomTint;
uniform float uColorGradeRain;
uniform float uColorToneMapper;
uniform float uColorVividBoost;
uniform float toneMappingExposure;
in vec2 vUv;
out vec4 fragColor;
${COLOR_TRANSFORM_GLSL}
${COLOR_TONE_MAP_INVERSE_GLSL}
const float BLOOM_MAX_RADIANCE = ${BLOOM_TUNING.maxRadiance.toFixed(1)};
const vec2 BLOOM_CLIP_WHITE_LUMA = vec2(${BLOOM_TUNING.clipWhiteLuma.map(value => value.toFixed(3)).join(", ")});

/** Clipped-sun weight of a stored texel: near 1 only where the 8-bit pixel clipped (and is white). */
float bloomClipped(vec3 scene) {
  float clipped = smoothstep(${BLOOM_CLIPPED_DISPLAY.min.toFixed(2)}, ${BLOOM_CLIPPED_DISPLAY.max.toFixed(1)}, max(scene.r, max(scene.g, scene.b)));
  float white = smoothstep(BLOOM_CLIP_WHITE_LUMA.x, BLOOM_CLIP_WHITE_LUMA.y, dot(scene, vec3(${LUMA_REC709.map(value => value.toFixed(4)).join(", ")})));
  return clipped * mix(1.0, white, uBloomRamp.z);
}

/** The bright part of one scene texel as linear radiance; dark texels return 0 early. */
vec3 bloomSource(vec3 scene, float threshold) {
#ifdef COLOR_SCENE_GRADED
  vec3 display = colorGradeInverse(scene);
#else
  vec3 display = scene;
#endif
  float brightness = max(display.r, max(display.g, display.b));
  float selected = smoothstep(threshold, threshold + uBloomRamp.y, brightness);
  if (selected <= 0.0) return vec3(0.0);
  vec3 radiance = colorToneMapInverse(colorSrgbDecode(clamp(display, 0.0, 1.0)));
  // Clipping is a property of the stored 8-bit pixel, before the grade inverse rescales it.
  float clipped = 1.0 + uBloomClippedBoost * bloomClipped(scene);
  return min(max(radiance, vec3(0.0)), vec3(BLOOM_MAX_RADIANCE)) * (selected * clipped);
}

void main() {
  float threshold = uBloomRamp.x;
  ivec2 base = min(ivec2(gl_FragCoord.xy) * 2, ivec2(textureSize(uScene, 0)) - 2);
  vec3 sum = bloomSource(texelFetch(uScene, base, 0).rgb, threshold);
  sum += bloomSource(texelFetch(uScene, base + ivec2(1, 0), 0).rgb, threshold);
  sum += bloomSource(texelFetch(uScene, base + ivec2(0, 1), 0).rgb, threshold);
  sum += bloomSource(texelFetch(uScene, base + ivec2(1, 1), 0).rgb, threshold);
  fragColor = vec4(sum * (0.25 * uBloomTint), 1.0);
}`;

/**
 * Levels 1..n: 13-tap downsample of the previous (already linear) level. The first level defines
 * BLOOM_KARIS: its taps are weighted by inverse luma so one bright texel cannot dominate the
 * coarser mips (firefly suppression); the later levels keep the plain average.
 */
export const BLOOM_DOWNSAMPLE_FRAGMENT_GLSL = `precision highp float;
uniform sampler2D uScene;
in vec2 vUv;
out vec4 fragColor;
${BLOOM_TAPS_GLSL}
#ifdef BLOOM_KARIS
/** Luma that a Karis weight halves: only taps far above the selected highlights are tamed. */
uniform float uBloomKarisLuma;
/** Karis luma weight: brighter taps count less. */
float bloomKarisWeight(vec3 color) {
  return 1.0 / (1.0 + dot(color, vec3(${LUMA_REC709.map(value => value.toFixed(4)).join(", ")})) / uBloomKarisLuma);
}
#endif
void main() {
  vec2 texel = 1.0 / vec2(textureSize(uScene, 0));
  vec3 sum = vec3(0.0);
#ifdef BLOOM_KARIS
  float weight = 0.0;
  for (int index = 0; index < 13; index++) {
    vec3 tap = texture(uScene, vUv + BLOOM_TAPS[index] * texel).rgb;
    float tapWeight = bloomKarisWeight(tap);
    sum += tap * tapWeight;
    weight += tapWeight;
  }
  sum /= max(weight, 1e-5);
#else
  for (int index = 0; index < 13; index++)
    sum += texture(uScene, vUv + BLOOM_TAPS[index] * texel).rgb;
  sum *= 1.0 / 13.0;
#endif
  fragColor = vec4(sum, 1.0);
}`;

const tentWeight = (index: number) => BLOOM_TENT_WEIGHTS[index]!.toFixed(1);

/** The 9-tap tent body, generated from BLOOM_TENT_WEIGHTS (centre, edges, corners). */
const BLOOM_TENT_GLSL = `  vec3 sum = texture(uScene, vUv).rgb * ${tentWeight(0)};
  sum += texture(uScene, vUv + vec2(-texel.x, 0.0)).rgb * ${tentWeight(1)};
  sum += texture(uScene, vUv + vec2(texel.x, 0.0)).rgb * ${tentWeight(2)};
  sum += texture(uScene, vUv + vec2(0.0, -texel.y)).rgb * ${tentWeight(3)};
  sum += texture(uScene, vUv + vec2(0.0, texel.y)).rgb * ${tentWeight(4)};
  sum += texture(uScene, vUv + vec2(-texel.x, -texel.y)).rgb;
  sum += texture(uScene, vUv + vec2(texel.x, -texel.y)).rgb;
  sum += texture(uScene, vUv + vec2(-texel.x, texel.y)).rgb;
  sum += texture(uScene, vUv + vec2(texel.x, texel.y)).rgb;`;

/**
 * 9-tap tent upsample, drawn additively onto the next larger level. `uRadius` widens the tent in
 * source texels (coarse mips use a larger radius, see BLOOM_TUNING.upsampleRadii) and `uWeight`
 * dims the wide coarse halos (BLOOM_TUNING.upsampleWeights).
 */
export const BLOOM_UPSAMPLE_FRAGMENT_GLSL = `precision highp float;
uniform sampler2D uScene;
uniform float uRadius;
uniform float uWeight;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 texel = uRadius / vec2(textureSize(uScene, 0));
${BLOOM_TENT_GLSL}
  fragColor = vec4(sum * (uWeight / ${BLOOM_TENT_DIVISOR.toFixed(1)}), 1.0);
}`;
