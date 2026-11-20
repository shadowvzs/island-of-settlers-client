import {
  ATMOSPHERE_MAX_OPTICAL_DEPTH,
  ATMOSPHERE_MIN_DIRECTION_SQUARED,
  ATMOSPHERE_PARALLEL_EPSILON,
  ATMOSPHERE_SMALL_Q
} from "./atmosphere-height";
import { RAINBOW_GLSL } from "./rainbow-glsl";

/** Insert before ATMOSPHERE_GLSL; all fields are renderer-owned. */
export const ATMOSPHERE_UNIFORMS_GLSL = `
uniform vec4 uAtmosphereProfile;
uniform vec3 uAtmosphereBoundsMin;
uniform vec3 uAtmosphereBoundsMax;
uniform vec3 uAtmosphereEye;
uniform float uAtmosphereFar;
uniform float uAtmosphereOrthoDepth;
uniform vec3 uAtmosphereForward;
uniform vec3 uAtmosphereAirlightLinear;
uniform vec4 uAtmosphereSun;
uniform vec4 uAtmosphereSunTint;
uniform float uAtmospherePass;
uniform vec4 uAtmosphereBankA;
uniform vec4 uAtmosphereBankB;
uniform vec4 uAtmosphereBankParams;
uniform float uAtmosphereRainbow;
`;

/**
 * Shared weather geometry and exact height integration. The code is GLSL ES 1.00 compatible so
 * Three ShaderMaterial aliases can compile it, and contains no texture/engine dependencies.
 */
export const ATMOSPHERE_GLSL = `
const float ATMOSPHERE_MAX_TAU = ${ATMOSPHERE_MAX_OPTICAL_DEPTH.toFixed(1)};
const float ATMOSPHERE_SMALL_Q = ${ATMOSPHERE_SMALL_Q.toFixed(3)};
const float ATMOSPHERE_MIN_DIRECTION_SQUARED = ${ATMOSPHERE_MIN_DIRECTION_SQUARED.toFixed(12)};
const float ATMOSPHERE_PARALLEL_EPSILON = ${ATMOSPHERE_PARALLEL_EPSILON.toFixed(8)};

struct AtmosphereRay {
  vec3 origin;
  vec3 direction;
  float length;
};

AtmosphereRay atmosphereEmptyRay(vec3 origin) {
  return AtmosphereRay(origin, vec3(0.0, 1.0, 0.0), 0.0);
}

float atmosphereBoundsDiagonal() {
  vec3 lower = min(uAtmosphereBoundsMin, uAtmosphereBoundsMax);
  vec3 upper = max(uAtmosphereBoundsMin, uAtmosphereBoundsMax);
  return length(upper - lower);
}

bool atmosphereClipSlab(
  float origin,
  float direction,
  float slabMin,
  float slabMax,
  inout float nearT,
  inout float farT
) {
  if (abs(direction) < ATMOSPHERE_PARALLEL_EPSILON) {
    return origin >= slabMin && origin <= slabMax;
  }
  float first = (slabMin - origin) / direction;
  float second = (slabMax - origin) / direction;
  nearT = max(nearT, min(first, second));
  farT = min(farT, max(first, second));
  return nearT <= farT;
}

AtmosphereRay atmosphereClipRayToBounds(AtmosphereRay ray) {
  vec3 lower = min(uAtmosphereBoundsMin, uAtmosphereBoundsMax);
  vec3 upper = max(uAtmosphereBoundsMin, uAtmosphereBoundsMax);
  vec3 extent = upper - lower;
  if (!(extent.x > 0.0 && extent.y > 0.0 && extent.z > 0.0)) {
    return atmosphereEmptyRay(ray.origin);
  }
  float directionLengthSquared = dot(ray.direction, ray.direction);
  if (!(directionLengthSquared > ATMOSPHERE_MIN_DIRECTION_SQUARED) ||
      !(ray.length > 0.0)) {
    return atmosphereEmptyRay(ray.origin);
  }
  vec3 direction = ray.direction * inversesqrt(directionLengthSquared);
  float nearT = 0.0;
  float farT = ray.length;
  if (!atmosphereClipSlab(
    ray.origin.x, direction.x, lower.x, upper.x, nearT, farT
  )) return atmosphereEmptyRay(ray.origin);
  if (!atmosphereClipSlab(
    ray.origin.y, direction.y, lower.y, upper.y, nearT, farT
  )) return atmosphereEmptyRay(ray.origin);
  if (!atmosphereClipSlab(
    ray.origin.z, direction.z, lower.z, upper.z, nearT, farT
  )) return atmosphereEmptyRay(ray.origin);
  float clippedLength = farT - nearT;
  if (!(clippedLength > 0.0)) return atmosphereEmptyRay(ray.origin);
  return AtmosphereRay(clamp(ray.origin + direction * nearT, lower, upper), direction, clippedLength);
}

// Constructors retain the perspective eye/surface path or the bounded orthographic view path;
// only optical-depth integration clips it to the finite volume.
AtmosphereRay atmosphereSurfaceRay(vec3 worldPosition) {
  float diagonal = atmosphereBoundsDiagonal();
  if (!(diagonal > 0.0)) return atmosphereEmptyRay(worldPosition);
  if (uAtmosphereProfile.w > 0.5) {
    float forwardLengthSquared = dot(uAtmosphereForward, uAtmosphereForward);
    if (!(forwardLengthSquared > ATMOSPHERE_MIN_DIRECTION_SQUARED)) {
      return atmosphereEmptyRay(worldPosition);
    }
    vec3 direction = uAtmosphereForward * inversesqrt(forwardLengthSquared);
    // Parallel rays keep their direction, but their depth follows the current orthographic
    // view span (zoom). A fixed volume-diagonal path kept nearby buildings hazy after zooming
    // into clear air; this bound shrinks with the visible extent and grows again when zoomed out.
    float pathLength = 2.0 * diagonal;
    if (uAtmosphereOrthoDepth > 0.0) {
      pathLength = min(pathLength, uAtmosphereOrthoDepth);
      // Never trace past the actual camera plane; a low/clipped orthographic camera cannot
      // invent fog behind itself.
      pathLength = min(pathLength, max(dot(worldPosition - uAtmosphereEye, direction), 0.0));
      if (!(pathLength > 0.0)) return atmosphereEmptyRay(worldPosition);
    }
    vec3 origin = worldPosition - direction * pathLength;
    return AtmosphereRay(origin, direction, pathLength);
  }
  vec3 offset = worldPosition - uAtmosphereEye;
  float distanceSquared = dot(offset, offset);
  if (!(distanceSquared > ATMOSPHERE_MIN_DIRECTION_SQUARED)) {
    return atmosphereEmptyRay(uAtmosphereEye);
  }
  float distanceAlongRay = sqrt(distanceSquared);
  vec3 direction = offset / distanceAlongRay;
  return AtmosphereRay(uAtmosphereEye, direction, distanceAlongRay);
}

AtmosphereRay atmosphereSkyRay(vec3 direction) {
  float directionLengthSquared = dot(direction, direction);
  if (!(directionLengthSquared > ATMOSPHERE_MIN_DIRECTION_SQUARED)) {
    return atmosphereEmptyRay(uAtmosphereEye);
  }
  vec3 normalizedDirection = direction * inversesqrt(directionLengthSquared);
  float pathLength = 2.0 * atmosphereBoundsDiagonal();
  if (!(pathLength > 0.0)) return atmosphereEmptyRay(uAtmosphereEye);
  return AtmosphereRay(uAtmosphereEye, normalizedDirection, pathLength);
}

float atmosphereSmallQIntegral(float q) {
  return 1.0 - q * (0.5 - q * (1.0 / 6.0 - q * (1.0 / 24.0 - q / 120.0)));
}

float atmosphereIntegratedAboveDensity(
  float startHeight,
  float endHeight,
  float length,
  float falloff
) {
  if (!(length > 0.0)) return 0.0;
  float startDensity = exp(-falloff * startHeight);
  if (!(falloff > 0.0)) return startDensity * length;
  float q = falloff * (endHeight - startHeight);
  float integrated;
  if (abs(q) < ATMOSPHERE_SMALL_Q) {
    integrated = startDensity * length * atmosphereSmallQIntegral(q);
  } else {
    float endDensity = exp(-falloff * endHeight);
    integrated = (startDensity - endDensity) * length / q;
  }
  return integrated > 0.0 ? integrated : 0.0;
}

float atmosphereBelowReferenceLength(
  float startHeight,
  float endHeight,
  float directionY,
  float length,
  float referenceHeight
) {
  float belowLength = 0.0;
  if (directionY > 0.0) {
    if (startHeight >= referenceHeight) return 0.0;
    if (endHeight <= referenceHeight) return length;
    belowLength = (referenceHeight - startHeight) / directionY;
  } else if (directionY < 0.0) {
    if (startHeight <= referenceHeight) return length;
    if (endHeight >= referenceHeight) return 0.0;
    belowLength = (referenceHeight - endHeight) / -directionY;
  } else if (startHeight <= referenceHeight) {
    return length;
  }
  return clamp(belowLength, 0.0, length);
}

/**
 * Camera occupancy of a bank's soft shell. A bank is local weather the camera must be inside
 * to see: a camera in clear air above a bank keeps nearby buildings clear instead of tinting
 * every fragment along a parallel or long orthographic path.
 */
float atmosphereBankEyeVisibility(vec4 bank, vec3 eye) {
  float density = uAtmosphereBankParams.x;
  if (!(bank.w > 0.0) || !(density > 0.0)) return 0.0;
  float verticalScale = clamp(uAtmosphereBankParams.y, 0.05, 1.0);
  float softness = clamp(uAtmosphereBankParams.z, 0.05, 0.95);
  float inverseRadius = 1.0 / bank.w;
  float inverseVertical = inverseRadius / verticalScale;
  vec3 offset = vec3(
    (eye.x - bank.x) * inverseRadius,
    (eye.y - bank.y) * inverseVertical,
    (eye.z - bank.z) * inverseRadius
  );
  return 1.0 - smoothstep(1.0 - softness, 1.0, length(offset));
}

/**
 * Soft, vertically flattened ellipsoid sampled three times along its chord. Two world-anchored
 * banks are enough for a mist accent and keep the per-pixel cost bounded; no texture or pass.
 * The camera must be inside a bank for that bank to contribute, so clear camera air stays clear
 * even when the parallel/orthographic path crosses a bank further along the view.
 */
float atmosphereBankSegmentDensity(vec4 bank, AtmosphereRay ray) {
  float density = uAtmosphereBankParams.x;
  if (!(bank.w > 0.0) || !(density > 0.0) || !(ray.length > 0.0)) return 0.0;
  float eyeVisibility = atmosphereBankEyeVisibility(bank, uAtmosphereEye);
  if (!(eyeVisibility > 0.0)) return 0.0;
  float verticalScale = clamp(uAtmosphereBankParams.y, 0.05, 1.0);
  float softness = clamp(uAtmosphereBankParams.z, 0.05, 0.95);
  float inverseRadius = 1.0 / bank.w;
  float inverseVertical = inverseRadius / verticalScale;
  vec3 origin = vec3(
    (ray.origin.x - bank.x) * inverseRadius,
    (ray.origin.y - bank.y) * inverseVertical,
    (ray.origin.z - bank.z) * inverseRadius
  );
  vec3 direction = vec3(
    ray.direction.x * inverseRadius,
    ray.direction.y * inverseVertical,
    ray.direction.z * inverseRadius
  );
  float a = dot(direction, direction);
  if (!(a > 0.0)) return 0.0;
  float b = dot(origin, direction);
  float c = dot(origin, origin) - 1.0;
  float discriminant = b * b - a * c;
  if (!(discriminant > 0.0)) return 0.0;
  float root = sqrt(discriminant);
  float start = max((-b - root) / a, 0.0);
  float end = min((-b + root) / a, ray.length);
  float chord = end - start;
  if (!(chord > 0.0)) return 0.0;
  float sampled = 0.0;
  for (int sampleIndex = 1; sampleIndex <= 3; sampleIndex++) {
    float fraction = float(sampleIndex) / 4.0;
    vec3 offset = origin + direction * (start + chord * fraction);
    sampled += 1.0 - smoothstep(1.0 - softness, 1.0, length(offset));
  }
  return density * chord * sampled / 3.0 * eyeVisibility;
}

float atmosphereBanksOpticalDepth(AtmosphereRay ray) {
  if (uAtmosphereBankParams.w < 0.5) return 0.0;
  float opticalDepth = atmosphereBankSegmentDensity(uAtmosphereBankA, ray);
  if (uAtmosphereBankParams.w > 1.5) {
    opticalDepth += atmosphereBankSegmentDensity(uAtmosphereBankB, ray);
  }
  return opticalDepth;
}

float atmosphereOpticalDepth(AtmosphereRay ray) {
  if (uAtmospherePass < 0.5) return 0.0;
  float extinction = max(uAtmosphereProfile.x, 0.0);
  float falloff = max(uAtmosphereProfile.y, 0.0);
  if (!(ray.length > 0.0)) return 0.0;
  AtmosphereRay clipped = atmosphereClipRayToBounds(ray);
  if (!(clipped.length > 0.0)) return 0.0;
  float referenceHeight = uAtmosphereProfile.z;
  float startHeight = clipped.origin.y;
  float endHeight = startHeight + clipped.direction.y * clipped.length;
  float belowLength = atmosphereBelowReferenceLength(
    startHeight,
    endHeight,
    clipped.direction.y,
    clipped.length,
    referenceHeight
  );
  float aboveLength = max(clipped.length - belowLength, 0.0);
  float opticalDepth = extinction * belowLength;
  if (aboveLength > 0.0) {
    float aboveStart = max(startHeight - referenceHeight, 0.0);
    float aboveEnd = max(endHeight - referenceHeight, 0.0);
    opticalDepth += extinction * atmosphereIntegratedAboveDensity(
      aboveStart,
      aboveEnd,
      aboveLength,
      falloff
    );
  }
  opticalDepth += atmosphereBanksOpticalDepth(clipped);
  if (!(opticalDepth > 0.0)) return 0.0;
  return min(opticalDepth, ATMOSPHERE_MAX_TAU);
}

${RAINBOW_GLSL}
/** Thin air reads slightly bluer (Rayleigh); thick haze turns neutral. Luminance-neutral. */
const vec3 ATMOSPHERE_THIN_TINT = vec3(0.93, 0.99, 1.1);

/** Henyey-Greenstein phase × 4π: mean 1 over the sphere, so the lobe only redistributes light. */
float atmospherePhase(float cosTheta, float g) {
  float g2 = g * g;
  float denominator = max(1.0 + g2 - 2.0 * g * cosTheta, 0.0001);
  return (1.0 - g2) / (denominator * sqrt(denominator));
}

/**
 * Direction-dependent airlight (R06a) of a view ray: a share of the haze is in-scattered sunlight
 * with a forward lobe (warm haze against the light, cooler with the sun behind the viewer); thin
 * haze leans blue. uAtmosphereSun.w = 0 (unbound) keeps the constant airlight.
 */
vec3 atmosphereAirlight(vec3 direction, float tau) {
  vec3 air = uAtmosphereAirlightLinear;
  float share = uAtmosphereSun.w;
  if (share > 0.0) {
    float phase = atmospherePhase(dot(direction, uAtmosphereSun.xyz), uAtmosphereSunTint.w);
    air = air * (1.0 - share) + uAtmosphereSunTint.rgb * (share * phase);
  }
  air *= mix(vec3(1.0), ATMOSPHERE_THIN_TINT, exp(-2.0 * tau));
  // Distant air in front of hills and sea carries the bow. Near surfaces (blend below about 6 %,
  // invisible) skip it, so the eye's grass, trees and buildings pay one comparison.
  if (tau < RAINBOW_MIN_TAU) return air;
  return air + atmosphereRainbowRadiance(direction);
}

/** The view ray direction towards a surface: parallel in the isometric view. */
vec3 atmosphereViewDirection(vec3 worldPosition) {
  if (uAtmosphereProfile.w > 0.5) return normalize(uAtmosphereForward);
  vec3 toSurface = worldPosition - uAtmosphereEye;
  float lengthSquared = dot(toSurface, toSurface);
  if (!(lengthSquared > ATMOSPHERE_MIN_DIRECTION_SQUARED)) return normalize(uAtmosphereForward);
  return toSurface * inversesqrt(lengthSquared);
}

/** The one airlight blend of every material, in linear light before the colour output. */
vec3 composeAtmosphereLinearToward(vec3 radiance, float tau, vec3 direction) {
  if (uAtmospherePass < 0.5 || !(tau > 0.0)) return radiance;
  float opacity = 1.0 - exp(-min(tau, ATMOSPHERE_MAX_TAU));
  return mix(radiance, atmosphereAirlight(direction, tau), clamp(opacity, 0.0, 1.0));
}

/** The blend along the camera's forward ray (layers without a world position). */
vec3 composeAtmosphereLinear(vec3 radiance, float tau) {
  return composeAtmosphereLinearToward(radiance, tau, normalize(uAtmosphereForward));
}
`;
