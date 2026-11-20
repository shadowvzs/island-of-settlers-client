import {
  asin, atan, clamp, cos, dot, exp, float, fract, fwidth, If, length, max, min, smoothstep, sqrt,
  step, texture, vec2, vec3
} from "three/tsl";

import {
  EXPLORATION_MOON_DISC_RADIUS,
  EXPLORATION_MOON_EARTHSHINE,
  EXPLORATION_MOON_HALO_FALLOFF,
  EXPLORATION_MOON_HALO_GAIN,
  EXPLORATION_MOON_HALO_TINT
} from "../../../../render-common/atmosphere/exploration-sky-constants";
import {
  bindScalar,
  bindVector,
  type UniformBindings
} from "../uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type Texture = any;

const SKY_TAU = Math.PI * 2;
const SKY_DISC_PI = Math.PI;

/** Orthonormal basis continuous through the zenith (GLSL skyTangentFrame). */
export const skyTangentFrame = (axis: TslNode) => {
  const scale = float(1).div(max(float(1).add(axis.y), 0.00001));
  const xz = axis.x.negate().mul(axis.z).mul(scale);
  const right = vec3(float(1).sub(axis.x.mul(axis.x).mul(scale)), axis.x.negate(), xz);
  const up = vec3(xz, axis.z.negate(), float(1).sub(axis.z.mul(axis.z).mul(scale)));
  return { right, up };
};

/** Offset of a direction in the light's tangent plane, in chord units (GLSL helper). */
export const skyLightTangentOffset = (direction: TslNode, lightDirection: TslNode): TslNode => {
  const { right, up } = skyTangentFrame(lightDirection);
  return vec2(dot(direction, right), dot(direction, up));
};

const moonDisc = (tangentOffset: TslNode, litAxis: TslNode, edgeCoverage: TslNode,
  night: TslNode, phase: TslNode, illumination: TslNode, moonTexture: Texture,
  moonAvailable: TslNode, moonTint: TslNode): TslNode => {
  const radiance = vec3(0).toVar();
  If(moonAvailable.greaterThan(0.5).and(night.greaterThan(0.001))
    .and(edgeCoverage.greaterThan(0)), () => {
    const discPosition = tangentOffset.div(EXPLORATION_MOON_DISC_RADIUS);
    const radiusSquared = min(dot(discPosition, discPosition), 0.999999);
    const front = sqrt(float(1).sub(radiusSquared));
    const surfaceNormal = vec3(discPosition.x, discPosition.y, front);
    // Longitude/latitude only for this texture lookup; z (front) is positive over the disc.
    const longitude = atan(surfaceNormal.x.div(front));
    const latitude = asin(clamp(surfaceNormal.y, -1, 1));
    const moonUv = vec2(float(0.5).add(longitude.div(SKY_TAU)),
      float(0.5).sub(latitude.div(SKY_DISC_PI)));
    const albedo = texture(moonTexture, moonUv).rgb;
    const cosPhaseAngle = cos(phase.mul(SKY_TAU)).negate();
    const sinPhaseAngle = sqrt(max(float(1).sub(cosPhaseAngle.mul(cosPhaseAngle)), 0));
    const incidence = max(dot(surfaceNormal,
      vec3(litAxis.mul(sinPhaseAngle), cosPhaseAngle)), 0);
    const sunlit = float(2).mul(incidence).div(incidence.add(front).add(0.0001));
    const visible = smoothstep(0.002, 0.045, illumination);
    const nightShare = float(1).sub(illumination);
    const earthshine = float(EXPLORATION_MOON_EARTHSHINE).mul(nightShare).mul(nightShare);
    radiance.assign(albedo.mul(moonTint).mul(sunlit.add(earthshine))
      .mul(visible).mul(edgeCoverage).mul(night));
  });
  return radiance;
};

export interface MoonNodes {
  radiance: (direction: TslNode, lightDirection: TslNode) => TslNode;
}

/** TSL twin of EXPLORATION_SKY_DISC_GLSL explorationMoonRadiance (the sun is in sun.ts). */
export const createMoonNodes = (bindings: UniformBindings,
  moonTexture: Texture): MoonNodes => {
  const daylight = bindScalar(bindings, "uDaylight", 0) as TslNode;
  const moonAvailable = bindScalar(bindings, "uMoonAvailable", 0) as TslNode;
  const moonLitAxis = bindVector(bindings, "uMoonLitAxis", 2) as TslNode;
  const moonPhase = bindScalar(bindings, "uMoonPhase", 0.5) as TslNode;
  const moonTint = bindVector(bindings, "uMoonTint", 3) as TslNode;
  const haloRadiance = vec3(EXPLORATION_MOON_HALO_TINT[0], EXPLORATION_MOON_HALO_TINT[1],
    EXPLORATION_MOON_HALO_TINT[2]);

  /** EXPLORATION_SKY_DISC_GLSL explorationMoonRadiance. */
  const radiance = (direction: TslNode, lightDirection: TslNode): TslNode => {
    const result = vec3(0).toVar();
    const day = clamp(daylight, 0, 1);
    const sunPresence = smoothstep(0.02, 0.32, day);
    const night = float(1).sub(smoothstep(0.12, 0.52, day))
      .mul(float(1).sub(smoothstep(0, 0.05, sunPresence)));
    If(night.greaterThan(0.001), () => {
      const tangentOffset = skyLightTangentOffset(direction, lightDirection);
      const radial = length(tangentOffset);
      const edgeWidth = max(fwidth(radial), 0.000012);
      const forward = step(0, dot(direction, lightDirection));
      const moonEdge = forward.mul(float(1).sub(smoothstep(
        float(EXPLORATION_MOON_DISC_RADIUS).sub(edgeWidth),
        float(EXPLORATION_MOON_DISC_RADIUS).add(edgeWidth), radial)));
      const moonHalo = exp(max(radial.sub(EXPLORATION_MOON_DISC_RADIUS), 0)
        .mul(-EXPLORATION_MOON_HALO_FALLOFF)).mul(forward);
      const phase = fract(clamp(moonPhase, 0, 1));
      const illumination = float(0.5).mul(float(1).sub(cos(phase.mul(SKY_TAU))));
      const disc = moonDisc(tangentOffset, moonLitAxis, moonEdge, night, phase, illumination,
        moonTexture, moonAvailable, moonTint);
      // `uMoonTint * halo * night * gain * available * illumination`: the restrained halo.
      const halo = moonTint.mul(haloRadiance).mul(moonHalo).mul(night)
        .mul(EXPLORATION_MOON_HALO_GAIN).mul(moonAvailable).mul(illumination);
      result.assign(disc.add(halo));
    });
    return result;
  };

  return { radiance };
};
