import { ATMOSPHERE_GLSL, ATMOSPHERE_UNIFORMS_GLSL } from "../../../render-common/atmosphere/atmosphere-glsl";
import { CONCEALMENT_GLSL, CONCEALMENT_UNIFORMS_GLSL } from "../../../render-common/atmosphere/concealment-glsl";
import { EXPLORATION_SKY_CONCEALMENT_TOP } from "../../../render-common/atmosphere/exploration-sky-constants";
import { SKY_RADIANCE_GLSL } from "../../../render-common/atmosphere/sky-view-lut";
import { AIR_COLOR_OUTPUT_GLSL } from "../../../render-common/shaders/color-output-glsl";
import { glslLiteral } from "../../../render-common/shaders/glsl-literal";
import { EXPLORATION_CLOUD_GLSL } from "./exploration-sky-cloud-glsl";
import { EXPLORATION_SKY_DISC_GLSL } from "./exploration-sky-disc-glsl";
import { EXPLORATION_STARS_GLSL } from "./exploration-stars-glsl";
import { EXPLORATION_SUN_GLSL, EXPLORATION_SUN_VISIBILITY_GLSL } from "./exploration-sun-glsl";

/** Uniforms the cloud layers read; declared identically in every stage and pass. */
export const EXPLORATION_CLOUD_UNIFORMS_GLSL = `
uniform mat4 uCameraWorld;
uniform vec3 uAmbientSky;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec4 uCloudDrift;
uniform sampler2D uNoiseTexture;
uniform highp sampler3D uCloudNoise;
uniform float uCloudCover;
uniform float uCloudSamples;
uniform float uDaylight;
uniform float uRain;
`;

/** World-space view ray of a fullscreen-triangle position (needs uInverseProjection, uCameraWorld). */
export const EXPLORATION_VIEW_RAY_GLSL = `
vec3 explorationViewRay(vec2 screen, out vec3 rayOrigin) {
  vec4 nearPoint = uInverseProjection * vec4(screen, -1.0, 1.0);
  vec4 farPoint = uInverseProjection * vec4(screen, 1.0, 1.0);
  rayOrigin = (uCameraWorld * vec4(nearPoint.xyz / nearPoint.w, 1.0)).xyz;
  vec3 rayTarget = (uCameraWorld * vec4(farPoint.xyz / farPoint.w, 1.0)).xyz;
  return normalize(rayTarget - rayOrigin);
}
`;

/**
 * The fullscreen triangle's three vertices also evaluate the clouds once toward the sun: its
 * glare and aureole then fade as cloud covers the disc itself, without a second pass or target.
 */
export const EXPLORATION_SKY_VERTEX_GLSL = `
precision highp float;
in vec3 position;
out vec2 vScreen;
flat out float vSunDirectVisibility;
${EXPLORATION_CLOUD_UNIFORMS_GLSL}
${EXPLORATION_CLOUD_GLSL}
${EXPLORATION_SUN_VISIBILITY_GLSL}
void main() {
  vScreen = position.xy;
  vSunDirectVisibility = explorationSunCloudVisibility(
    normalize(uSunDirection), max(uCameraWorld[3].y, 0.0)
  );
  gl_Position = vec4(position, 1.0);
}
`;

/**
 * One fullscreen draw. The atmospheric gradient uses the shared environment colours and the
 * current light direction; clouds are a Cartesian shell field in the separate cloud GLSL helper.
 */
export const EXPLORATION_SKY_FRAGMENT_GLSL = `
precision highp float;
const float EXPLORATION_SKY_CONCEALMENT_TOP = ${glslLiteral(EXPLORATION_SKY_CONCEALMENT_TOP)};
in vec2 vScreen;
flat in float vSunDirectVisibility;
out vec4 fragColor;
uniform mat4 uInverseProjection;
uniform vec3 uBackground;
uniform sampler2D uCloudTexture;
uniform float uCloudTextureReady;
uniform sampler2D uMoonTexture;
uniform float uLightning;
uniform float uMoonAvailable;
${EXPLORATION_CLOUD_UNIFORMS_GLSL}
${ATMOSPHERE_UNIFORMS_GLSL}
${CONCEALMENT_UNIFORMS_GLSL}
${EXPLORATION_VIEW_RAY_GLSL}
${ATMOSPHERE_GLSL}
${CONCEALMENT_GLSL}
${AIR_COLOR_OUTPUT_GLSL}
${SKY_RADIANCE_GLSL}
${EXPLORATION_CLOUD_GLSL}
${EXPLORATION_SKY_DISC_GLSL}
${EXPLORATION_STARS_GLSL}
${EXPLORATION_SUN_GLSL}

/**
 * The shared sky (render-common/atmosphere/sky-model.ts, R06b): the sky-view LUT on Medium+, the
 * same analytic model on Minimal. SH light, water reflection and this sky share that source.
 */
vec3 explorationAtmosphere(vec3 direction, vec3 lightDirection) {
  return skyBackdrop(direction, lightDirection, clamp(uDaylight, 0.0, 1.0), uBackground);
}

/** Camera-air transmittance of a sky ray, matching composeAtmosphereLinearToward's blend. */
float explorationAirTransmittance(float opticalDepth) {
  if (uAtmospherePass < 0.5 || !(opticalDepth > 0.0)) return 1.0;
  return exp(-min(opticalDepth, ATMOSPHERE_MAX_TAU));
}

/**
 * The concealment veil only along the horizon band, where the sky meets veiled sea and terrain.
 * Higher rays crossed its blocky visibility cells near the eye and drew hard vertical light bands
 * (one per cell edge in azimuth) into the dawn and dusk sky; they now skip the march.
 */
float explorationSkyConcealment(AtmosphereRay airRay, vec3 direction) {
  float horizonBand = 1.0 - smoothstep(0.0, EXPLORATION_SKY_CONCEALMENT_TOP, direction.y);
  if (horizonBand <= 0.0) return 0.0;
  return concealmentOpticalDepth(airRay) * horizonBand;
}

/** The lower clouds: the resolved volumetric pass (Medium/High) or the flat layer (Low/Minimal). */
void explorationLowerClouds(vec3 direction, float cameraAltitude, out float transmittance, out vec3 color) {
  transmittance = 1.0;
  color = vec3(0.0);
  if (direction.y <= 0.0 || uCloudCover <= 0.025) return;
  if (uCloudSamples < 1.5) {
    explorationSimpleCloudLayer(direction, cameraAltitude, transmittance, color);
    return;
  }
  if (uCloudTextureReady < 0.5) return;
  vec4 clouds = texture(uCloudTexture, vScreen * 0.5 + 0.5);
  transmittance = 1.0 - clouds.a;
  color = clouds.rgb / max(clouds.a, 0.0001);
}

/**
 * The bow in front of the sky and its clouds (the lit rain curtain is nearer than the cloud deck),
 * only while the sun lights it through the clouds. The airlight already adds the bow by the camera
 * air's opacity, so this adds its transmitted share: the horizon gets it once.
 */
vec3 explorationRainbow(vec3 direction, float opticalDepth) {
  if (!(uAtmosphereRainbow > 0.0)) return vec3(0.0);
  return atmosphereRainbowRadiance(direction) * vSunDirectVisibility *
    explorationAirTransmittance(opticalDepth);
}

void main() {
  vec3 rayOrigin;
  vec3 direction = explorationViewRay(vScreen, rayOrigin);
  vec3 lightDirection = normalize(uSunDirection);
  vec3 color = explorationAtmosphere(direction, lightDirection);

  // The moon is part of the display-authored sky behind both cloud layers, so opaque cloud
  // covers it. The HDR sun is added in linear light below, behind the same local transmittance.
  // Stars too: behind the moon disc, the clouds and the camera air (horizon veil, extinction).
  color += explorationStarRadiance(direction, lightDirection, color);
  color += explorationMoonRadiance(direction, lightDirection);

  float highOpacity;
  vec3 highColor;
  explorationHighCloudLayer(direction, max(rayOrigin.y, 0.0), highOpacity, highColor);
  color = mix(color, highColor, highOpacity);

  float cloudTransmittance;
  vec3 cloudColor;
  explorationLowerClouds(direction, max(rayOrigin.y, 0.0), cloudTransmittance, cloudColor);
  float cloudOpacity = explorationLowCloudOpacity(cloudTransmittance, direction);
  color = mix(color, cloudColor, cloudOpacity);
  color += vec3(0.5, 0.64, 1.0) * uLightning * (0.08 + cloudOpacity * 0.42);
  AtmosphereRay airRay = atmosphereSkyRay(direction);
  float opticalDepth = atmosphereOpticalDepth(airRay) + explorationSkyConcealment(airRay, direction);
  vec3 radiance = composeAtmosphereLinearToward(colorSrgbDecode(color), opticalDepth, direction);
  radiance += explorationRainbow(direction, opticalDepth);
  float localTransmittance = (1.0 - highOpacity) * (1.0 - cloudOpacity);
  float airTransmittance = explorationAirTransmittance(opticalDepth);
  vec3 sun = explorationSunRadiance(direction, lightDirection, localTransmittance, vSunDirectVisibility);
  vec3 glow = explorationCloudGlowRadiance(direction, lightDirection, 1.0 - cloudOpacity, highOpacity);
  fragColor = vec4(explorationSunOutput(radiance, sun * airTransmittance, glow * airTransmittance), 1.0);
}
`;
