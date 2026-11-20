import {
  EXPLORATION_CLOUD_GLOW_LINEAR_PEAK,
  EXPLORATION_SUN
} from "../../../render-common/atmosphere/exploration-sky-constants";
import { EXPLORATION_SUN_DISC_RADIUS } from "./exploration-sky-disc-glsl";

/**
 * Henyey-Greenstein asymmetry of the aerosol aureole: a tight forward-scatter lobe around the sun.
 * The broad sky lobe stays in the shared sky model (render-common/atmosphere/sky-model.ts).
 */
export const SUN_AUREOLE_ASYMMETRY = EXPLORATION_SUN.aureoleAsymmetry;
/** Aureole radiance per unit disc radiance and HG phase (about 0.6 of display white at the rim). */
export const SUN_AUREOLE_GAIN = EXPLORATION_SUN.aureoleGain;
/** Forward-scatter glow of cloud lit from behind by the sun, strongest at mid transmittance. */
export const SUN_CLOUD_GLOW_ASYMMETRY = EXPLORATION_SUN.cloudGlowAsymmetry;
export const SUN_CLOUD_GLOW_GAIN = EXPLORATION_SUN.cloudGlowGain;
/**
 * Brightest display channel the cloud glow may lift a pixel to (owner captures/17.png, 2026-11-13):
 * at dusk behind cloud the rims went through the sun's shoulder to clipped white and bloomed into
 * a halo. Like the waterfall cap (WATERFALL_DISPLAY_PEAK) it stays below the bloom prefilter's
 * clipped-white boost and just over the daytime threshold: a soft silver lining, no white ring.
 */
export const SUN_CLOUD_GLOW_DISPLAY_PEAK = EXPLORATION_SUN.cloudGlowDisplayPeak;
/**
 * The cloud layers' transmittance is a display opacity: a bank at 0.07 already reads opaque. The
 * direct beam uses its fourth power, so such a bank hides the HDR disc (24 x 0.07 would still
 * saturate), thin cirrus (0.9) only dims it, and broken edges still flash through.
 */
export const SUN_CLOUD_DIRECT_POWER = EXPLORATION_SUN.cloudDirectPower;
/**
 * Two-term analytic glare (an eye/lens point-spread function in units of the disc radius): a tight
 * Gaussian core that saturates the rim to white and a long Lorentzian veil. It stands in for a
 * bloom pass, so the sun blooms through the shared tonemapper without any extra target or draw.
 */
export const SUN_GLARE_CORE = EXPLORATION_SUN.glareCore;
export const SUN_GLARE_CORE_WIDTH = EXPLORATION_SUN.glareCoreWidth;
export const SUN_GLARE_VEIL = EXPLORATION_SUN.glareVeil;
export const SUN_GLARE_VEIL_WIDTH = EXPLORATION_SUN.glareVeilWidth;
/**
 * Linear limb-darkening coefficient, I(mu) = 1 - u (1 - mu): the rim keeps 40 % of the centre. It is
 * achromatic on purpose: a per-channel law drops blue to zero at the very edge, which after the
 * tonemapper drew a thin warm ring between the clipped core and the glare.
 */
export const SUN_LIMB_DARKENING = EXPLORATION_SUN.limbDarkening;
/** Outer share of the disc radius over which the disc feathers into the glare (no hard outline). */
export const SUN_EDGE_FEATHER = EXPLORATION_SUN.edgeFeather;
/**
 * Knee of the sun's highlight shoulder over the tonemapped sky, as a share of the sky's headroom:
 * below 1 the glare saturates sooner (the blinding noon blob), and a faint glow stays additive.
 */
export const SUN_HIGHLIGHT_KNEE = EXPLORATION_SUN.highlightKnee;
/** Share of the aureole that thin cloud in front of it still forward-scatters toward the eye. */
const CLOUD_FORWARD_SCATTER = EXPLORATION_SUN.cloudForwardScatter;

const glslNumber = (value: number) => value.toFixed(4);

const SUN_DIRECT_BEAM_GLSL = `
float sunDirectBeam(float cloudTransmittance) {
  return pow(clamp(cloudTransmittance, 0.0, 1.0), ${glslNumber(SUN_CLOUD_DIRECT_POWER)});
}
`;

/**
 * Vertex-stage helper (after EXPLORATION_CLOUD_GLSL): the share of the sun's direct beam that the
 * clouds pass, averaged over the centre and three rim points so a streak crossing the disc centre
 * does not switch the glare off. The fullscreen triangle evaluates it on its three vertices only.
 */
export const EXPLORATION_SUN_VISIBILITY_GLSL = `
${SUN_DIRECT_BEAM_GLSL}
float explorationSunCloudVisibility(vec3 lightDirection, float cameraAltitude) {
  vec3 side = abs(lightDirection.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 right = normalize(cross(lightDirection, side));
  vec3 up = cross(right, lightDirection);
  const float rim = ${(EXPLORATION_SUN_DISC_RADIUS * 0.7).toFixed(6)};
  float visible = sunDirectBeam(explorationCloudVisibility(lightDirection, cameraAltitude)) * 0.4;
  for (int point = 0; point < 3; point++) {
    float angle = float(point) * 2.0943951;
    vec3 rimDirection = normalize(lightDirection + (right * cos(angle) + up * sin(angle)) * rim);
    visible += sunDirectBeam(explorationCloudVisibility(rimDirection, cameraAltitude)) * 0.2;
  }
  return visible;
}
`;

/**
 * The possessed sun in linear HDR light (needs EXPLORATION_SKY_DISC_GLSL first). `uSunDisc` is the
 * disc-centre radiance after air extinction and `uSunAureole` the slant-path aureole source
 * (sun-radiance.ts; both 0 at night); `uSunVisibility` is the terrain-visible share of the disc.
 * Callers pass the result, after the camera-air blend, to explorationSunOutput with the sky.
 */
export const EXPLORATION_SUN_GLSL = `
uniform vec3 uSunAureole;
uniform vec3 uSunDisc;
uniform float uSunVisibility;
const float SUN_AUREOLE_G = ${glslNumber(SUN_AUREOLE_ASYMMETRY)};
const float SUN_AUREOLE_GAIN = ${glslNumber(SUN_AUREOLE_GAIN)};
const float SUN_CLOUD_GLOW_G = ${glslNumber(SUN_CLOUD_GLOW_ASYMMETRY)};
const float SUN_CLOUD_GLOW_GAIN = ${glslNumber(SUN_CLOUD_GLOW_GAIN)};
const float SUN_CLOUD_GLOW_PEAK = ${glslNumber(EXPLORATION_CLOUD_GLOW_LINEAR_PEAK)};
${SUN_DIRECT_BEAM_GLSL}
/** Henyey-Greenstein phase (unnormalised: 1 - g^2 over the denominator). */
float sunPhase(float cosTheta, float g) {
  float denominator = max(1.0 + g * g - 2.0 * g * cosTheta, 0.0001);
  return (1.0 - g * g) / (denominator * sqrt(denominator));
}

/** Glare in disc radii: Gaussian core plus Lorentzian veil. */
float sunGlare(float discRadii) {
  float core = exp(-discRadii * discRadii / ${glslNumber(SUN_GLARE_CORE_WIDTH)});
  float veil = 1.0 / (1.0 + discRadii * discRadii / ${glslNumber(SUN_GLARE_VEIL_WIDTH)});
  return core * ${glslNumber(SUN_GLARE_CORE)} + veil * ${glslNumber(SUN_GLARE_VEIL)};
}

/** Limb-darkened disc: hot centre, dimmer rim, feathered edge that blends into the glare. */
float sunDiscProfile(float radial, float forward) {
  float edgeWidth = max(fwidth(radial), 0.000012);
  float feather = max(edgeWidth, SKY_SUN_CHORD_RADIUS * ${glslNumber(SUN_EDGE_FEATHER)});
  float edge = forward * (1.0 - smoothstep(
    SKY_SUN_CHORD_RADIUS - feather, SKY_SUN_CHORD_RADIUS + edgeWidth, radial
  ));
  float discRadii = min(radial / SKY_SUN_CHORD_RADIUS, 1.0);
  float mu = sqrt(max(1.0 - discRadii * discRadii, 0.0));
  return (1.0 - ${glslNumber(SUN_LIMB_DARKENING)} * (1.0 - mu)) * edge;
}

/**
 * Disc behind the local cloud transmittance; glare and aureole scaled by the direct-beam share
 * of the sun itself (sunDirectVisibility), so a hidden sun leaves no halo on clear sky beside it.
 * Cloud in front still glows where the sun lights it from behind (explorationCloudGlowRadiance).
 */
vec3 explorationSunRadiance(
  vec3 direction, vec3 lightDirection, float localTransmittance, float sunDirectVisibility
) {
  if (max(uSunAureole.r, max(uSunAureole.g, uSunAureole.b)) <= 0.0) return vec3(0.0);
  float cosTheta = dot(direction, lightDirection);
  float forward = step(0.0, cosTheta);
  float radial = length(skyLightTangentOffset(direction, lightDirection));
  float disc = sunDiscProfile(radial, forward) * sunDirectBeam(localTransmittance);
  float glare = sunGlare(radial / SKY_SUN_CHORD_RADIUS) * forward * uSunVisibility * sunDirectVisibility;
  float aureole = SUN_AUREOLE_GAIN * sunPhase(cosTheta, SUN_AUREOLE_G) * sunDirectVisibility *
    mix(localTransmittance, 1.0, ${glslNumber(CLOUD_FORWARD_SCATTER)});
  return uSunDisc * (disc + glare) + uSunAureole * aureole;
}

/**
 * Forward-scatter glow of cloud lit from behind: the lower clouds strongest at mid transmittance
 * (cloud rims); the thin high cirrus by its own opacity only (single scattering, behind the lower
 * layer). Feeding the cirrus through the rim curve (4 T (1 - T), slope 4 at T = 1) amplified its
 * fibres fourfold around the sun into bright radial strokes (lane/ref-tuner, 2026-11-17).
 */
vec3 explorationCloudGlowRadiance(
  vec3 direction, vec3 lightDirection, float lowerTransmittance, float highOpacity
) {
  float cosTheta = dot(direction, lightDirection);
  float rims = 4.0 * lowerTransmittance * (1.0 - lowerTransmittance);
  return uSunAureole * SUN_CLOUD_GLOW_GAIN * sunPhase(cosTheta, SUN_CLOUD_GLOW_G) *
    (rims + highOpacity * lowerTransmittance);
}

/**
 * Final pixel of sky radiance plus the sun and the cloud glow. The sky goes through the shared
 * tonemapper unchanged; the sun is added after it with a per-channel highlight shoulder (additive while faint, easing
 * towards white per channel), like a photograph of a light source. Through the scene's tonemapper
 * (AgX at dusk) a red sun was pulled to a cream disc; here noon still clips to white while the
 * setting sun keeps its red. The refraction capture keeps plain linear radiance; the HDR scene
 * target (R10) keeps this tonemapped pixel before the grade, which its output pass applies. The
 * cloud glow has its own shoulder capped at SUN_CLOUD_GLOW_PEAK.
 */
vec3 explorationSunOutput(vec3 skyRadiance, vec3 sunRadiance, vec3 glowRadiance) {
  if (colorIsLinearCapture()) return max(skyRadiance + sunRadiance + glowRadiance, vec3(0.0));
  vec3 sky = colorToneMap(skyRadiance);
  vec3 headroom = max(1.0 - sky, vec3(0.02));
  vec3 sun = max(sunRadiance, vec3(0.0)) * toneMappingExposure;
  vec3 knee = headroom * ${glslNumber(SUN_HIGHLIGHT_KNEE)};
  vec3 lit = sky + headroom * sun / (sun + knee);
  // The cloud glow eases toward its own peak (hue kept): faint rims as before, never clipped white.
  vec3 glow = max(glowRadiance, vec3(0.0)) * toneMappingExposure;
  float glowRoom = max(SUN_CLOUD_GLOW_PEAK - max(lit.r, max(lit.g, lit.b)), 0.0);
  float glowPeak = max(glow.r, max(glow.g, glow.b));
  lit += glow * glowRoom / max(glowPeak + glowRoom * ${glslNumber(SUN_HIGHLIGHT_KNEE)}, 0.0001);
  return colorFinishOutput(colorSrgbEncode(lit));
}
`;
