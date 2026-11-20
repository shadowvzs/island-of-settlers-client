import {
  EXPLORATION_CLOUD,
  explorationCloudSampleCount
} from "../../../render-common/atmosphere/exploration-sky-constants";
import { glslLiteral } from "../../../render-common/shaders/glsl-literal";

/** Ray-march steps through the cloud shell: High 32, Medium 16; Low/Minimal draw the flat layer. */
export const EXPLORATION_CLOUD_SAMPLE_LIMIT = EXPLORATION_CLOUD.sampleLimit;

export { explorationCloudSampleCount };

/** Steps of the transmittance-only march the vertex stage uses toward the sun disc. */
const VISIBILITY_STEPS = EXPLORATION_CLOUD.visibilitySteps;

/** Farthest march distance; beyond it the banks converge to the overall cover. */
export const EXPLORATION_CLOUD_MARCH_LIMIT = EXPLORATION_CLOUD.marchLimit;

/** The curved sky shells around the eye; the cloud pass resolve reprojects along them too. */
export const EXPLORATION_SKY_SHELL_GLSL = `
const float SKY_PLANET_RADIUS = ${glslLiteral(EXPLORATION_CLOUD.planetRadius)};

/** Stable positive intersection: no division by elevation, including grazing horizon rays. */
float skyShellDistance(vec3 direction, float cameraAltitude, float altitude) {
  float originRadius = SKY_PLANET_RADIUS + cameraAltitude;
  float shellRadius = SKY_PLANET_RADIUS + altitude;
  float projected = originRadius * direction.y;
  float radiusDifference = (shellRadius - originRadius) * (shellRadius + originRadius);
  return radiusDifference / (sqrt(projected * projected + radiusDifference) + projected);
}
`;

/**
 * Volumetric cumulus in a curved shell (1.0–2.5 km): a Perlin-Worley base shape eroded by Worley
 * detail, a weather mask with a cumulus height profile (flat bases, rounded towers), Beer-Lambert
 * extinction with a short light march toward the sun (self-shadow), the powder term (dark
 * crevices), multiple-scattering octaves and a dual Henyey-Greenstein phase (silver lining). The
 * march runs in the half-resolution cloud pass with a per-pixel jitter that the temporal resolve
 * averages out (exploration-cloud-pass.ts); Low/Minimal keep the flat textured layer.
 */
export const EXPLORATION_CLOUD_GLSL = `
${EXPLORATION_SKY_SHELL_GLSL}
const float SKY_CLOUD_BOTTOM = ${glslLiteral(EXPLORATION_CLOUD.bottom)};
const float SKY_CLOUD_TOP = ${glslLiteral(EXPLORATION_CLOUD.top)};
const float SKY_CLOUD_MARCH_LIMIT = ${glslLiteral(EXPLORATION_CLOUD.marchLimit)};
/** Extinction per metre at density 1. */
const float SKY_CLOUD_EXTINCTION = ${glslLiteral(EXPLORATION_CLOUD.extinction)};
/** Extinction toward the light: lower than the view's so shaded sides keep multiple scattering. */
const float SKY_LIGHT_EXTINCTION = ${glslLiteral(EXPLORATION_CLOUD.lightExtinction)};
const float SKY_SHAPE_TILE = ${glslLiteral(EXPLORATION_CLOUD.shapeTile)};
const float SKY_DETAIL_TILE = ${glslLiteral(EXPLORATION_CLOUD.detailTile)};
const float SKY_WEATHER_TILE = ${glslLiteral(EXPLORATION_CLOUD.weatherTile)};

/** Height above the curved ground of a point relative to the eye at the origin. */
float skyAltitude(vec3 point) {
  return length(point + vec3(0.0, SKY_PLANET_RADIUS, 0.0)) - SKY_PLANET_RADIUS;
}

float skyHeightFraction(vec3 point) {
  return (skyAltitude(point) - SKY_CLOUD_BOTTOM) / (SKY_CLOUD_TOP - SKY_CLOUD_BOTTOM);
}

float skyRemap(float value, float low, float high) {
  return clamp((value - low) / max(high - low, 0.0001), 0.0, 1.0);
}

/** Local coverage 0..1: the weather-driven cover, broken into banks by a slow weather mask. */
float skyCloudCoverage(vec3 point) {
  vec2 weatherPoint = (point.xz + uCloudDrift.xy * 0.6) / SKY_WEATHER_TILE;
  float weather = texture(uCloudNoise, vec3(weatherPoint, 0.37)).r;
  float cover = clamp(uCloudCover, 0.0, 1.0);
  float contrast = mix(0.75, 0.3, smoothstep(0.7, 1.0, cover));
  return clamp(cover * 1.05 + (weather - 0.5) * contrast, 0.0, 1.0);
}

/**
 * Cloud density at a point: towers grow taller where the cover is higher, bases stay flat; rain
 * lowers and thickens the deck. detailLevel 0 skips the erosion (light march, sun visibility).
 */
float skyCloudDensity(vec3 point, float heightFraction, float detailLevel, float viewDistance) {
  float coverage = skyCloudCoverage(point);
  if (coverage < 0.02) return 0.0;
  float rain = clamp(uRain, 0.0, 1.0);
  float top = mix(0.35, 1.0, coverage) * mix(1.0, 0.85, rain);
  float profile = smoothstep(0.0, mix(0.07, 0.03, rain), heightFraction) *
    (1.0 - smoothstep(top * mix(0.35, 0.75, rain), top, heightFraction));
  // Wind shear: the upper part of every cloud runs slightly ahead of its base.
  vec3 drift = vec3(uCloudDrift.x, 0.0, uCloudDrift.y) * (1.0 + heightFraction * 0.25);
  float base = texture(uCloudNoise, (point + drift) / SKY_SHAPE_TILE).r;
  // A steep density ramp: crisp cauliflower edges instead of a slow fade over hundreds of metres.
  float densityScale = mix(3.0, 4.0, rain);
  float shape = skyRemap(base * profile, 1.0 - coverage, 1.0) * coverage;
  if (shape <= 0.0 || detailLevel < 0.5) return shape * densityScale;
  vec3 detailPoint = (point + drift * 1.15) / SKY_DETAIL_TILE + vec3(0.0, uCloudDrift.z * 0.0004, 0.0);
  float detail = texture(uCloudNoise, detailPoint).g;
  // Billowy lobes on the tops, wispy torn edges near the base.
  // Near clouds (under ~3 km) add a finer octave so their edges stay crisp at eye level.
  float nearDetail = 1.0 - smoothstep(1800.0, 3500.0, viewDistance);
  if (nearDetail > 0.0) {
    float fine = texture(uCloudNoise, detailPoint * 3.7 + vec3(0.31, 0.17, 0.53)).g;
    detail = mix(detail, detail * 0.7 + fine * 0.3, nearDetail);
  }
  float erosion = mix(1.0 - detail, detail, smoothstep(0.02, 0.18, heightFraction)) * 0.55;
  return skyRemap(shape, erosion, 1.0) * densityScale;
}

float skyPhase(float cosine, float asymmetry) {
  float denominator = 1.0 + asymmetry * asymmetry - 2.0 * asymmetry * cosine;
  return (1.0 - asymmetry * asymmetry) / (denominator * sqrt(denominator));
}

/**
 * Optical depth toward the light through ~2 km (a whole tower, so bases fall into shadow):
 * growing taps without erosion; High four, Medium three.
 */
float skyLightOpticalDepth(vec3 point, vec3 lightDirection, float lightSteps) {
  float depth = 0.0;
  float travelled = 0.0;
  float firstSegment = lightSteps > 3.5 ? 110.0 : 220.0;
  for (int tap = 0; tap < 4; tap++) {
    if (float(tap) >= lightSteps) break;
    float segment = firstSegment * pow(2.2, float(tap));
    vec3 probe = point + lightDirection * (travelled + segment * 0.5);
    travelled += segment;
    float fraction = skyHeightFraction(probe);
    if (fraction < 0.0 || fraction > 1.0) continue;
    depth += skyCloudDensity(probe, fraction, 0.0, 0.0) * segment;
  }
  return depth * SKY_LIGHT_EXTINCTION;
}

/** Sun scattering: multiple-scattering octaves of Beer-Lambert under a dual-lobe phase. */
float skySunScattering(float lightDepth, float cosine) {
  float scattering = 0.0;
  float amplitude = 1.0;
  float attenuation = 1.0;
  float eccentricity = 1.0;
  for (int octave = 0; octave < 3; octave++) {
    float phase = mix(skyPhase(cosine, -0.2 * eccentricity), skyPhase(cosine, 0.5 * eccentricity), 0.4);
    scattering += amplitude * exp(-lightDepth * attenuation) * phase;
    amplitude *= 0.5;
    attenuation *= 0.4;
    eccentricity *= 0.6;
  }
  return scattering;
}

/** Light colours of the current hour and weather, linear. */
struct SkyCloudLight {
  vec3 ambientBottom;
  vec3 ambientTop;
  vec3 haze;
  vec3 sun;
};

SkyCloudLight skyCloudLight() {
  float daylight = clamp(uDaylight, 0.0, 1.0);
  float storm = clamp(uRain, 0.0, 1.0);
  float horizonSun = smoothstep(-0.08, 0.06, normalize(uSunDirection).y);
  vec3 skyTint = pow(max(uAmbientSky, vec3(0.0)), vec3(2.2));
  vec3 fog = pow(max(uFogColor, vec3(0.0)), vec3(2.2));
  SkyCloudLight light;
  // Sunlight a little whiter than the terrain's warm key light: noon cumulus read white, dusk stays warm.
  vec3 sunColor = max(uSunColor, vec3(0.0));
  sunColor = mix(vec3(dot(sunColor, vec3(0.2126, 0.7152, 0.0722))), sunColor, 0.7);
  light.sun = sunColor * mix(0.05, 0.85, daylight) * horizonSun *
    (1.0 - storm * 0.7);
  light.ambientTop = mix(skyTint * 0.1, skyTint * 0.9 + fog * 0.35, daylight) * (1.0 - storm * 0.3);
  // Shaded undersides: a cool grey-blue mix of the sky dome and the horizon haze.
  light.ambientBottom = mix(fog * 0.02, (fog * 0.5 + skyTint * 0.5) * 0.3, daylight) * (1.0 - storm * 0.6);
  light.haze = fog * mix(0.12, 1.0, daylight);
  return light;
}

/** Light scattered toward the eye at one sample, before extinction (linear). */
vec3 skyScatteredLight(SkyCloudLight light, float extinction, float lightDepth, float cosine, float fraction) {
  // Powder: thin outer shells scatter little toward the eye; the dark crevices between lobes.
  float powder = 1.0 - exp(-extinction * 320.0);
  vec3 sun = light.sun * skySunScattering(lightDepth, cosine) * mix(0.5, 0.9, powder);
  // Sky light reaching the inside falls off under a thick column: heavy towers get darker bases.
  vec3 ambient = mix(light.ambientBottom, light.ambientTop, sqrt(fraction)) * mix(0.35, 1.0, exp(-lightDepth * 0.1));
  return sun + ambient;
}

/**
 * Volumetric march of one view ray. jitter 0..1 offsets the first step (the temporal resolve
 * averages it); returns premultiplied linear radiance in rgb and opacity in a.
 */
vec4 explorationCloudMarch(vec3 direction, float cameraAltitude, float jitter) {
  float bottomDistance = skyShellDistance(direction, cameraAltitude, SKY_CLOUD_BOTTOM);
  if (direction.y <= 0.0 || bottomDistance <= 0.0 || bottomDistance > SKY_CLOUD_MARCH_LIMIT) return vec4(0.0);
  float endDistance = min(skyShellDistance(direction, cameraAltitude, SKY_CLOUD_TOP), SKY_CLOUD_MARCH_LIMIT);
  float stepCount = max(uCloudSamples, 2.0);
  float stepLength = (endDistance - bottomDistance) / stepCount;
  vec3 sunDirection = normalize(uSunDirection);
  float cosine = dot(direction, sunDirection);
  // Overcast light arrives from the whole sky above: shadow the deck from overhead in rain.
  vec3 lightDirection = normalize(mix(sunDirection, vec3(0.0, 1.0, 0.0), clamp(uRain, 0.0, 1.0) * 0.75));
  float lightSteps = uCloudSamples > 24.0 ? 4.0 : 3.0;
  SkyCloudLight light = skyCloudLight();
  vec3 origin = vec3(0.0, cameraAltitude, 0.0);
  vec3 radiance = vec3(0.0);
  float transmittance = 1.0;
  float horizonFade = smoothstep(0.0, 0.05, direction.y);
  for (int stepIndex = 0; stepIndex < ${EXPLORATION_CLOUD_SAMPLE_LIMIT}; stepIndex++) {
    if (float(stepIndex) >= stepCount) break;
    float distanceAlongRay = bottomDistance + (float(stepIndex) + jitter) * stepLength;
    vec3 point = origin + direction * distanceAlongRay;
    float fraction = clamp(skyHeightFraction(point), 0.0, 1.0);
    float density = skyCloudDensity(point, fraction, 1.0, distanceAlongRay) * horizonFade;
    if (density < 0.003) continue;
    float extinction = density * SKY_CLOUD_EXTINCTION;
    float lightDepth = skyLightOpticalDepth(point, lightDirection, lightSteps);
    vec3 scattered = skyScatteredLight(light, extinction, lightDepth, cosine, fraction);
    // Aerial perspective: far banks melt into the horizon haze.
    scattered = mix(scattered, light.haze, 1.0 - exp(-distanceAlongRay / 14000.0));
    float stepTransmittance = exp(-extinction * stepLength);
    radiance += transmittance * scattered * (1.0 - stepTransmittance);
    transmittance *= stepTransmittance;
    if (transmittance < 0.01) break;
  }
  // Banks too far to march converge to the overall cover.
  float distant = smoothstep(SKY_CLOUD_MARCH_LIMIT * 0.55, SKY_CLOUD_MARCH_LIMIT, bottomDistance);
  float distantOpacity = smoothstep(0.2, 0.95, clamp(uCloudCover, 0.0, 1.0)) * 0.85 * horizonFade;
  radiance = mix(radiance, light.haze * distantOpacity, distant);
  return vec4(radiance, mix(1.0 - transmittance, distantOpacity, distant));
}

/** Transmittance only, without lighting or erosion: the vertex stage's sun-disc visibility. */
float explorationCloudTransmittance(vec3 direction, float cameraAltitude) {
  float bottomDistance = skyShellDistance(direction, cameraAltitude, SKY_CLOUD_BOTTOM);
  if (direction.y <= 0.0 || bottomDistance <= 0.0) return 1.0;
  float endDistance = min(skyShellDistance(direction, cameraAltitude, SKY_CLOUD_TOP), SKY_CLOUD_MARCH_LIMIT);
  if (endDistance <= bottomDistance) return 1.0;
  float stepLength = (endDistance - bottomDistance) / ${VISIBILITY_STEPS}.0;
  float depth = 0.0;
  for (int stepIndex = 0; stepIndex < ${VISIBILITY_STEPS}; stepIndex++) {
    float distanceAlongRay = bottomDistance + (float(stepIndex) + 0.5) * stepLength;
    vec3 point = vec3(0.0, cameraAltitude, 0.0) + direction * distanceAlongRay;
    depth += skyCloudDensity(point, clamp(skyHeightFraction(point), 0.0, 1.0), 0.0, 0.0) * stepLength;
  }
  return exp(-depth * SKY_CLOUD_EXTINCTION);
}

/** Minimal borrows the ordinary renderer's noise atlas: no owned 3D texture or volume marching. */
void explorationSimpleCloudLayer(
  vec3 direction, float cameraAltitude, out float transmittance, out vec3 cloudColor
) {
  float distanceAlongRay = skyShellDistance(direction, cameraAltitude, 1550.0);
  vec2 point = direction.xz * distanceAlongRay * 0.0022 + uCloudDrift.xy * 0.0022;
  vec4 base = texture(uNoiseTexture, point / 32.0);
  // The finer octave at 3.3x (was 2.03x) carries the fringe detail as well as the lobes.
  vec4 fine = texture(uNoiseTexture, (point * 3.3 + 17.1) / 32.0);
  float shape = base.r * 0.7 + fine.g * 0.3;
  // A slow weather mask (one fetch) groups the blobs into banks with wide clear gaps, instead of an
  // even leopard pattern; it fades as the cover closes into overcast.
  float cover = clamp(uCloudCover, 0.0, 1.0);
  float weather = texture(uNoiseTexture, (point * 0.5 + vec2(0.37, 0.61)) / 32.0).b;
  float threshold = mix(0.68, 0.29, cover) + (0.5 - weather) * 0.6 * (1.0 - smoothstep(0.7, 1.0, cover));
  // Soft, frayed edges (owner 2026-11-17): a wide density falloff, eroded at the fringe by the fetched
  // channels' independent detail (fine.b, base.a), so edges break into uneven wisps of varied size
  // while dense cores stay solid. No extra fetch.
  float density = smoothstep(threshold - 0.04, threshold + 0.3, shape);
  float fray = fine.b * 0.6 + base.a * 0.4;
  float body = clamp(density * 1.35 - (1.0 - density) * (1.0 - fray) * 0.9 - 0.12, 0.0, 1.0);
  transmittance = 1.0 - body * 0.86;
  float daylight = clamp(uDaylight, 0.0, 1.0);
  float silver = pow(max(dot(direction, normalize(uSunDirection)), 0.0), 8.0);
  cloudColor = mix(vec3(0.045, 0.065, 0.105), vec3(0.85, 0.88, 0.92), daylight);
  // Dense cores read lighter, thin fringes greyer (same peak brightness as before).
  cloudColor *= 0.78 + smoothstep(0.35, 1.0, body) * 0.14 + silver * 0.12;
  cloudColor *= 1.0 - clamp(uRain, 0.0, 1.0) * 0.52;
  cloudColor = mix(cloudColor, mix(vec3(0.025, 0.04, 0.075), uFogColor, daylight),
    smoothstep(6000.0, 19000.0, distanceAlongRay) * 0.85);
}

/** Thin high-altitude cirrus behind the lower cloud volume, with independent wind and scale. */
void explorationHighCloudLayer(vec3 direction, float cameraAltitude, out float opacity, out vec3 color) {
  opacity = 0.0;
  color = vec3(0.0);
  if (direction.y <= 0.0 || uCloudSamples < 1.5 || uCloudCover < 0.025) return;
  float distanceAlongRay = skyShellDistance(direction, cameraAltitude, 6500.0);
  vec2 point = direction.xz * distanceAlongRay;
  // Stretched along the upper wind into fibrous streaks: about 2 : 1 (it was 4.5 : 1, which in the
  // look-up perspective drew a comb of parallel strokes converging on the horizon).
  vec2 stretched = vec2(point.x * 0.0011 + point.y * 0.00025, point.y * 0.0019 - point.x * 0.0003);
  stretched += uCloudDrift.zw * 0.004;
  float weather = texture(uCloudNoise, vec3(point * 0.0000027 + uCloudDrift.zw * 0.000016, 0.61)).r;
  vec3 warped = vec3(stretched.x, 0.21, stretched.y) / 16.0 + vec3(weather - 0.5, 0.0, 0.2) * 0.05;
  float broad = texture(uCloudNoise, warped).r;
  // The fibres bend and hook with the broad field (no extra fetch), so they never run dead straight.
  vec3 bend = vec3(broad - 0.5, 0.0, (broad - 0.5) * 0.6) * 0.3;
  float fibres = texture(uCloudNoise, warped * vec3(1.4, 1.0, 1.7) + vec3(0.17, 0.4, -0.29) + bend).g;
  float wisps = smoothstep(0.45, 0.8, broad) * smoothstep(0.3, 0.8, fibres) * smoothstep(0.45, 0.7, weather);
  opacity = wisps * 0.08 * smoothstep(0.025, 0.2, direction.y) *
    smoothstep(0.025, 0.32, uCloudCover) * (1.0 - uRain * 0.5);
  color = mix(vec3(0.06, 0.08, 0.13), vec3(0.9, 0.93, 0.97), clamp(uDaylight, 0.0, 1.0));
}

/** Opacity of the lower layer as the sky composites it (faded out just below the horizon). */
float explorationLowCloudOpacity(float transmittance, vec3 direction) {
  return (1.0 - transmittance) * smoothstep(-0.01, 0.035, direction.y);
}

/** Combined transmittance of both cloud layers toward one direction (the sun's visibility). */
float explorationCloudVisibility(vec3 direction, float cameraAltitude) {
  if (direction.y <= 0.0) return 1.0;
  float highOpacity;
  vec3 highColor;
  explorationHighCloudLayer(direction, cameraAltitude, highOpacity, highColor);
  float transmittance = 1.0;
  vec3 cloudColor;
  if (uCloudCover <= 0.025) return 1.0 - highOpacity;
  if (uCloudSamples < 1.5) explorationSimpleCloudLayer(direction, cameraAltitude, transmittance, cloudColor);
  else transmittance = explorationCloudTransmittance(direction, cameraAltitude);
  return (1.0 - highOpacity) * (1.0 - explorationLowCloudOpacity(transmittance, direction));
}
`;
