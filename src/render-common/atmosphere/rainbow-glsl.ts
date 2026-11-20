import { glslLiteral } from "../shaders/glsl-literal";

/**
 * Rainbow radiance around the antisolar point (part of ATMOSPHERE_GLSL; needs uAtmosphereSun,
 * uAtmosphereSunTint and uAtmosphereRainbow). Seven spectral samples from violet (400 nm) to red
 * (700 nm) sit on the primary bow's water-drop radii, 40.6°–42.4° (red outside). Each sample is a
 * soft lobe, steep on the caustic's dark side and wider towards its bright side (the sun disc's
 * half degree and the Airy spread), so the samples overlap into one smooth gradient. Droplet light
 * slightly brightens the sky inside the bow. The owner wants a single bow by default (2026-11-11):
 * the secondary bow (53.6°–50.4°, reversed, 40 %) and the faint glow outside it, which together
 * make Alexander's dark band, stay behind RAINBOW_SECONDARY_BOW. Pure ALU, no texture; evaluated
 * only inside the bow's ring when the strength is above 0.
 */

/** Owner default: one bow. True adds the secondary bow and Alexander's band (code path kept). */
export const RAINBOW_SECONDARY_BOW = false;

/** Display-linear hues of the spectral samples, violet .. red, before normalisation. */
const SPECTRUM: readonly (readonly [number, number, number])[] = [
  [0.15, 0.0, 0.5],
  [0.0, 0.15, 0.7],
  [0.0, 0.5, 0.4],
  [0.15, 0.9, 0.1],
  [0.7, 0.7, 0.0],
  [0.8, 0.35, 0.0],
  [0.65, 0.0, 0.0]
];
/** Share of each hue pulled to its own grey: vivid, yet never a saturated print. */
const DESATURATION = 0.04;

/** Shape constants shared by the GLSL bows and the WebGPU TSL twin. */
export const RAINBOW = {
  peak: 0.72,
  /** Camera-air optical depth below which a surface's airlight skips the bow. */
  minTau: 0.06,
  secondary: 0.4,
  innerGlow: 0.16,
  outerGlow: 0.06,
  glowFalloff: 7,
  glowHue: [0.82, 0.95, 1],
  ringInnerCos: 0.9063,
  ringOuterCos: RAINBOW_SECONDARY_BOW ? 0.4695 : 0.6947,
  primaryViolet: 40.6,
  primarySpan: 1.8,
  secondaryViolet: 53.6,
  secondarySpan: -3.2
} as const;

export interface RainbowSample {
  readonly hue: readonly [number, number, number];
  /** Angle from the antisolar point in degrees. */
  readonly radius: number;
}

/** Hues normalised so all samples sum to white, then partly desaturated. */
const normalisedSpectrum = () => {
  const sums = [0, 1, 2].map(channel => SPECTRUM.reduce((sum, hue) => sum + hue[channel]!, 0));
  return SPECTRUM.map(hue => {
    const normal = hue.map((value, channel) => value / sums[channel]!);
    const grey = (normal[0]! + normal[1]! + normal[2]!) / 3;
    return normal.map(value => value + (grey - value) * DESATURATION);
  });
};

const bowSamples = (violet: number, span: number): readonly RainbowSample[] => {
  const spectrum = normalisedSpectrum();
  return spectrum.map((hue, index) => ({
    hue: hue as unknown as readonly [number, number, number],
    radius: violet + (span * index) / (spectrum.length - 1)
  }));
};

/** Primary-bow samples (radius and hue), shared by the GLSL sum and the TSL twin. */
export const RAINBOW_PRIMARY_SAMPLES = bowSamples(RAINBOW.primaryViolet, RAINBOW.primarySpan);
const RAINBOW_SECONDARY_SAMPLES = bowSamples(RAINBOW.secondaryViolet, RAINBOW.secondarySpan);

const vec3Of = (values: readonly number[]) => `vec3(${values.map(value => value.toFixed(4)).join(", ")})`;

/** One unrolled sum per bow: `offset` turns the sample's radius into its signed lobe distance. */
const bowSum = (name: string, samples: readonly RainbowSample[]) => {
  const lines = samples.map(({ hue, radius }) =>
    `  sum += atmosphereRainbowLobe(theta - ${radius.toFixed(3)}, outer, inner) * ${vec3Of(hue)};`);
  return `
vec3 ${name}(float theta, float outer, float inner) {
  vec3 sum = vec3(0.0);
${lines.join("\n")}
  return sum;
}`;
};

/** The secondary bow's lobes and the faint glow outside it (Alexander's band between). */
const SECONDARY_TERMS_GLSL = `
  if (theta > 48.0 && theta < 57.5) bows = atmosphereRainbowSecondary(theta, 0.75, 0.45) * RAINBOW_SECONDARY;
  float outside = exp(-max(theta - ${RAINBOW.secondaryViolet.toFixed(1)}, 0.0) / RAINBOW_GLOW_FALLOFF) *
    smoothstep(52.0, ${RAINBOW.secondaryViolet.toFixed(1)}, theta);
  glow += outside * RAINBOW_OUTER_GLOW * (1.0 - smoothstep(56.0, 62.0, theta));`;

export const RAINBOW_GLSL = `
const float RAINBOW_PEAK = ${glslLiteral(RAINBOW.peak)};
/** Camera-air optical depth below which a surface's airlight skips the bow (blend under 6 %). */
const float RAINBOW_MIN_TAU = ${glslLiteral(RAINBOW.minTau)};
const float RAINBOW_SECONDARY = ${glslLiteral(RAINBOW.secondary)};
const float RAINBOW_INNER_GLOW = ${glslLiteral(RAINBOW.innerGlow)};
const float RAINBOW_OUTER_GLOW = ${glslLiteral(RAINBOW.outerGlow)};
const float RAINBOW_GLOW_FALLOFF = ${glslLiteral(RAINBOW.glowFalloff)};
const vec3 RAINBOW_GLOW_HUE = vec3(${RAINBOW.glowHue.map(glslLiteral).join(", ")});
const float RAINBOW_RING_INNER_COS = ${glslLiteral(RAINBOW.ringInnerCos)};
const float RAINBOW_RING_OUTER_COS = ${RAINBOW.ringOuterCos.toFixed(4)};

/** Signed offset x in degrees (positive: outside the sample radius); widths of both sides. */
float atmosphereRainbowLobe(float x, float outer, float inner) {
  float width = x > 0.0 ? outer : inner;
  float scaled = x / width;
  return exp(-0.5 * scaled * scaled);
}
${bowSum("atmosphereRainbowPrimary", RAINBOW_PRIMARY_SAMPLES)}
${RAINBOW_SECONDARY_BOW ? bowSum("atmosphereRainbowSecondary", RAINBOW_SECONDARY_SAMPLES) : ""}

/** Additive linear radiance of the bow(s) along a view ray (0 when uAtmosphereRainbow is 0). */
vec3 atmosphereRainbowRadiance(vec3 direction) {
  if (!(uAtmosphereRainbow > 0.0)) return vec3(0.0);
  float cosine = dot(normalize(direction), -uAtmosphereSun.xyz);
  if (cosine > RAINBOW_RING_INNER_COS || cosine < RAINBOW_RING_OUTER_COS) return vec3(0.0);
  float theta = degrees(acos(cosine));
  // The seven lobes only near the bow's radii (coherent branches: whole screen regions).
  vec3 bows = vec3(0.0);
  if (theta > 37.0 && theta < 44.5) bows = atmosphereRainbowPrimary(theta, 0.26, 0.44);
  float inside = exp(min(theta - ${RAINBOW.primaryViolet.toFixed(1)}, 0.0) / RAINBOW_GLOW_FALLOFF) *
    (1.0 - smoothstep(${RAINBOW.primaryViolet.toFixed(1)}, 42.0, theta));
  // The glow eases out before the ring's inner edge, so the skipped pixels never draw a seam.
  float glow = inside * RAINBOW_INNER_GLOW * smoothstep(25.0, 34.0, theta);
${RAINBOW_SECONDARY_BOW ? SECONDARY_TERMS_GLSL : ""}
  // A third of the sun's hue: a low sun warms the bow without washing its green and blue out.
  float tintLuminance = dot(uAtmosphereSunTint.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 tint = mix(vec3(tintLuminance), uAtmosphereSunTint.rgb, 0.35);
  // The white droplet glow added to a blue sky lifts its weak red most after encoding (a pink
  // cast); a slightly cool glow reads as the brighter, paler sky of real photographs instead.
  return tint * (uAtmosphereRainbow * RAINBOW_PEAK) * (bows + RAINBOW_GLOW_HUE * glow);
}
`;
