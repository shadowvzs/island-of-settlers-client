import {
  EXPLORATION_MOON_DISC_RADIUS,
  EXPLORATION_MOON_EARTHSHINE,
  EXPLORATION_MOON_HALO_FALLOFF,
  EXPLORATION_MOON_HALO_GAIN,
  EXPLORATION_MOON_HALO_TINT,
  EXPLORATION_SUN_DISC_RADIUS
} from "../../../render-common/atmosphere/exploration-sky-constants";
import { glslLiteral } from "../../../render-common/shaders/glsl-literal";
import type { SunDirection } from "../../../shared/world/world-data";

export { EXPLORATION_MOON_DISC_RADIUS, EXPLORATION_SUN_DISC_RADIUS };
/**
 * Writes the moon's lit axis into `target` (x, y): the direction towards its sun (environment.ts
 * moonSunDirection) in the tangent frame of the light vector, the same frame as skyTangentFrame in
 * the GLSL below. It is constant over the disc, so it is computed once per frame on the CPU.
 */
export const writeMoonLitAxis = (
  light: ArrayLike<number>, sun: SunDirection, target: Float32Array
) => {
  const length = Math.hypot(light[0] ?? 0, light[1] ?? 0, light[2] ?? 0) || 1;
  const x = (light[0] ?? 0) / length, y = (light[1] ?? 0) / length, z = (light[2] ?? 0) / length;
  const scale = 1 / Math.max(1 + y, 0.00001);
  const xz = -x * z * scale;
  const horizontal = Math.cos(sun.elevation);
  const sunX = sun.azimuthX * horizontal, sunY = Math.sin(sun.elevation);
  const sunZ = sun.azimuthZ * horizontal;
  const right = sunX * (1 - x * x * scale) - sunY * x + sunZ * xz;
  const up = sunX * xz - sunY * z + sunZ * (1 - z * z * scale);
  const axisLength = Math.hypot(right, up);
  target[0] = axisLength > 1e-6 ? right / axisLength : 1;
  target[1] = axisLength > 1e-6 ? up / axisLength : 0;
  return target;
};

/**
 * Light discs. `uSunDirection` is the sun by day and the moon by night, so no second orbit or
 * phase simulation is introduced. Derivative-based edges keep both antialiased at any resolution.
 * The moon is here; the HDR sun (disc, aureole, glare) is in exploration-sun-glsl.ts.
 */
export const EXPLORATION_SKY_DISC_GLSL = `
const float SKY_MOON_CHORD_RADIUS = ${EXPLORATION_MOON_DISC_RADIUS.toFixed(7)};
/** Earthshine on the night side of a thin crescent, relative to the sunlit full disc. */
const float SKY_MOON_EARTHSHINE = ${glslLiteral(EXPLORATION_MOON_EARTHSHINE)};
uniform float uMoonPhase;
/** Unit direction towards the moon's sun in the light's tangent frame (writeMoonLitAxis). */
uniform vec2 uMoonLitAxis;
/** Moon colour through the air (sun-radiance.ts writeMoonTint). */
uniform vec3 uMoonTint;
const float SKY_SUN_CHORD_RADIUS = ${EXPLORATION_SUN_DISC_RADIUS.toFixed(7)};
const float SKY_TAU = 6.28318530718;
const float SKY_DISC_PI = 3.14159265359;

/**
 * Orthonormal basis whose only singularity is below the visible sky at the south pole. Unlike a
 * world-up cross product, it remains continuous through the zenith, including the moon's texture.
 */
void skyTangentFrame(vec3 axis, out vec3 tangentRight, out vec3 tangentUp) {
  float scale = 1.0 / max(1.0 + axis.y, 0.00001);
  float xz = -axis.x * axis.z * scale;
  tangentRight = vec3(1.0 - axis.x * axis.x * scale, -axis.x, xz);
  tangentUp = vec3(xz, -axis.z, 1.0 - axis.z * axis.z * scale);
}

/**
 * The direction's tangent-plane offset is normalised by the angular disc radius. A front-facing
 * hemisphere normal is reconstructed for the lunar sphere, and its centre is exactly map UV
 * (0.5, 0.5): longitude/latitude are used only for this texture lookup, never for clouds.
 * The sun lights that sphere from the phase angle (0 full .. pi new) along litAxis (towards
 * the sun in the same tangent plane), so the terminator is the true ellipse of every phase and
 * the bright limb faces the sun. Lommel-Seeliger reflectance keeps the full moon flat and darkens
 * only towards the terminator; earthshine faintly lights the night side of a crescent.
 */
void skyMoonDisc(
  vec2 tangentOffset,
  vec2 litAxis,
  float edgeCoverage,
  float night,
  float phase,
  float illumination,
  out vec3 moonRadiance
) {
  moonRadiance = vec3(0.0);
  if (uMoonAvailable < 0.5 || night <= 0.001 || edgeCoverage <= 0.0) return;
  vec2 discPosition = tangentOffset / SKY_MOON_CHORD_RADIUS;
  float radiusSquared = min(dot(discPosition, discPosition), 0.999999);
  float front = sqrt(1.0 - radiusSquared);
  vec3 surfaceNormal = vec3(discPosition.x, discPosition.y, front);
  float longitude = atan(surfaceNormal.x, surfaceNormal.z);
  float latitude = asin(clamp(surfaceNormal.y, -1.0, 1.0));
  vec2 moonUv = vec2(
    0.5 + longitude / SKY_TAU,
    0.5 - latitude / SKY_DISC_PI
  );
  vec3 albedo = texture(uMoonTexture, moonUv).rgb;
  float cosPhaseAngle = -cos(phase * SKY_TAU);
  float sinPhaseAngle = sqrt(max(1.0 - cosPhaseAngle * cosPhaseAngle, 0.0));
  float incidence = max(dot(surfaceNormal, vec3(litAxis * sinPhaseAngle, cosPhaseAngle)), 0.0);
  float sunlit = 2.0 * incidence / (incidence + front + 0.0001);
  float visible = smoothstep(0.002, 0.045, illumination);
  float earthshine = SKY_MOON_EARTHSHINE * (1.0 - illumination) * (1.0 - illumination);
  moonRadiance = albedo * uMoonTint * (sunlit + earthshine) * visible * edgeCoverage * night;
}

/**
 * Offset of the direction in the light's tangent plane (chord units). It is zero on both the light and
 * its antipode: callers must gate it with a forward test or they draw a second sun/moon.
 */
vec2 skyLightTangentOffset(vec3 direction, vec3 lightDirection) {
  vec3 tangentRight;
  vec3 tangentUp;
  skyTangentFrame(lightDirection, tangentRight, tangentUp);
  return vec2(dot(direction, tangentRight), dot(direction, tangentUp));
}

/** The textured moon disc and its restrained halo (display-authored); the sun is separate. */
vec3 explorationMoonRadiance(vec3 direction, vec3 lightDirection) {
  // The moon shares the light vector with the sun: it fades in only once the sun disc is all but
  // gone (sun-radiance.ts sunPresence below 5 %), so a dim setting sun never shows it inside.
  float daylight = clamp(uDaylight, 0.0, 1.0);
  float sunPresence = smoothstep(0.02, 0.32, daylight);
  float night = (1.0 - smoothstep(0.12, 0.52, daylight)) * (1.0 - smoothstep(0.0, 0.05, sunPresence));
  if (night <= 0.001) return vec3(0.0);
  vec2 tangentOffset = skyLightTangentOffset(direction, lightDirection);
  float radial = length(tangentOffset);
  float edgeWidth = max(fwidth(radial), 0.000012);
  float forward = step(0.0, dot(direction, lightDirection));
  float moonEdge = forward * (1.0 - smoothstep(
    SKY_MOON_CHORD_RADIUS - edgeWidth,
    SKY_MOON_CHORD_RADIUS + edgeWidth,
    radial
  ));
  float moonHalo = exp(-max(radial - SKY_MOON_CHORD_RADIUS, 0.0) * ${glslLiteral(EXPLORATION_MOON_HALO_FALLOFF)}) * forward;
  float phase = fract(clamp(uMoonPhase, 0.0, 1.0));
  float illumination = 0.5 * (1.0 - cos(phase * SKY_TAU));
  vec3 moonRadiance;
  skyMoonDisc(tangentOffset, uMoonLitAxis, moonEdge, night, phase, illumination, moonRadiance);
  return moonRadiance + uMoonTint * vec3(${EXPLORATION_MOON_HALO_TINT.map(glslLiteral).join(", ")}) * moonHalo * night * ${glslLiteral(EXPLORATION_MOON_HALO_GAIN)} *
    uMoonAvailable * illumination;
}
`;
