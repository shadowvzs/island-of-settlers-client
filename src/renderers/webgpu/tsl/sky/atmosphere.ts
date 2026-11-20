import {
  abs, acos, clamp, degrees, dot, exp, float, If, inversesqrt, length, log, max, min, mix,
  normalize, smoothstep, sqrt, texture, vec3
} from "three/tsl";

import {
  ATMOSPHERE_MAX_OPTICAL_DEPTH,
  ATMOSPHERE_MIN_DIRECTION_SQUARED,
  ATMOSPHERE_PARALLEL_EPSILON,
  ATMOSPHERE_SMALL_Q
} from "../../../../render-common/atmosphere/atmosphere-height";
import { RAINBOW, RAINBOW_PRIMARY_SAMPLES } from "../../../../render-common/atmosphere/rainbow-glsl";
import {
  bindScalar,
  bindTexture,
  bindVector,
  type UniformBindings
} from "../uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/** A view ray as the GLSL AtmosphereRay: origin, normalized direction and (clipped) length. */
export interface TslAtmosphereRay {
  direction: TslNode;
  length: TslNode;
  origin: TslNode;
}

const ATMOSPHERE_BELOW_HORIZON_BAND = 1;

interface SlabClip {
  far: TslNode;
  near: TslNode;
  ok: TslNode;
}

/** One axis of the AABB clip (GLSL atmosphereClipSlab), as values instead of inout parameters. */
const clipSlab = (origin: TslNode, direction: TslNode, slabMin: TslNode, slabMax: TslNode,
  nearIn: TslNode, farIn: TslNode): SlabClip => {
  const parallel = abs(direction).lessThan(ATMOSPHERE_PARALLEL_EPSILON);
  const inside = origin.greaterThanEqual(slabMin).and(origin.lessThanEqual(slabMax));
  const first = slabMin.sub(origin).div(direction);
  const second = slabMax.sub(origin).div(direction);
  const clippedNear = max(nearIn, min(first, second));
  const clippedFar = min(farIn, max(first, second));
  const ok = parallel.select(inside, clippedNear.lessThanEqual(clippedFar));
  return {
    far: ok.select(clippedFar, farIn),
    near: ok.select(clippedNear, nearIn),
    ok: ok.select(float(1), float(0))
  };
};

/**
 * TSL twin of ATMOSPHERE_GLSL and CONCEALMENT_GLSL for the sky materials: the bounded ray clip,
 * exact height integration, direction-dependent airlight, the shared colour tail and the
 * concealment veil. Surfaces keep their GLSL path until their own port card.
 */
export const createAtmosphereNodes = (bindings: UniformBindings) => {
  const profile = bindVector(bindings, "uAtmosphereProfile", 4) as TslNode;
  const boundsMin = bindVector(bindings, "uAtmosphereBoundsMin", 3) as TslNode;
  const boundsMax = bindVector(bindings, "uAtmosphereBoundsMax", 3) as TslNode;
  const eye = bindVector(bindings, "uAtmosphereEye", 3) as TslNode;
  const forward = bindVector(bindings, "uAtmosphereForward", 3) as TslNode;
  const airlightLinear = bindVector(bindings, "uAtmosphereAirlightLinear", 3) as TslNode;
  const atmosphereSun = bindVector(bindings, "uAtmosphereSun", 4) as TslNode;
  const atmosphereSunTint = bindVector(bindings, "uAtmosphereSunTint", 4) as TslNode;
  const bankA = bindVector(bindings, "uAtmosphereBankA", 4) as TslNode;
  const bankB = bindVector(bindings, "uAtmosphereBankB", 4) as TslNode;
  const bankParams = bindVector(bindings, "uAtmosphereBankParams", 4) as TslNode;
  const atmospherePass = bindScalar(bindings, "uAtmospherePass", 0) as TslNode;
  const rainbowStrength = bindScalar(bindings, "uAtmosphereRainbow", 0) as TslNode;
  const explorationFog = bindScalar(bindings, "uExplorationFog", 0) as TslNode;
  const liveFog = bindScalar(bindings, "uLiveFog", 0) as TslNode;
  const worldSize = bindVector(bindings, "uWorldSize", 2) as TslNode;
  const fogMap = bindings.source.uFogMap ? bindTexture(bindings, "uFogMap") : null;

  const lower = min(boundsMin, boundsMax) as TslNode;
  const upper = max(boundsMin, boundsMax) as TslNode;
  const diagonal = length(upper.sub(lower)) as TslNode;
  const validVolume = upper.sub(lower).x.greaterThan(0)
    .and(upper.sub(lower).y.greaterThan(0)).and(upper.sub(lower).z.greaterThan(0));

  /** GLSL atmosphereSkyRay: the eye and normalized direction, two volume diagonals long. */
  const skyRay = (direction: TslNode): TslAtmosphereRay => {
    const lengthSquared = dot(direction, direction) as TslNode;
    const valid = lengthSquared.greaterThan(ATMOSPHERE_MIN_DIRECTION_SQUARED)
      .and(diagonal.greaterThan(0)).and(validVolume);
    return {
      direction: direction.mul(inversesqrt(max(lengthSquared, ATMOSPHERE_MIN_DIRECTION_SQUARED))),
      length: valid.select(diagonal.mul(2), float(0)),
      origin: eye
    };
  };

  /** The ray's fields as variables of the current statement stack (shared by several Ifs, P1). */
  const pinRay = (ray: TslAtmosphereRay): TslAtmosphereRay => ({
    direction: ray.direction.toVar(),
    length: ray.length.toVar(),
    origin: ray.origin.toVar()
  });

  /** GLSL atmosphereClipRayToBounds; an invalid ray keeps the eye and a zero length. */
  const clipRay = (ray: TslAtmosphereRay): TslAtmosphereRay => {
    const directionLengthSquared = dot(ray.direction, ray.direction) as TslNode;
    const validDirection = directionLengthSquared.greaterThan(ATMOSPHERE_MIN_DIRECTION_SQUARED);
    const direction = ray.direction.mul(inversesqrt(max(directionLengthSquared, 1e-30)));
    const first = clipSlab(ray.origin.x, direction.x, lower.x, upper.x, float(0), ray.length);
    const second = clipSlab(ray.origin.y, direction.y, lower.y, upper.y, first.near, first.far);
    const third = clipSlab(ray.origin.z, direction.z, lower.z, upper.z, second.near, second.far);
    const positiveChord = third.far.sub(third.near).greaterThan(0);
    const valid = validVolume.and(validDirection).and(ray.length.greaterThan(0))
      .and(first.ok.mul(second.ok).mul(third.ok).greaterThan(0.5)).and(positiveChord);
    const clippedLength = valid.select(third.far.sub(third.near), float(0));
    return {
      direction,
      length: clippedLength,
      origin: clamp(ray.origin.add(direction.mul(third.near)), lower, upper) as TslNode
    };
  };

  /** GLSL atmosphereBelowReferenceLength: share of the segment under the reference height. */
  const belowReferenceLength = (startHeight: TslNode, endHeight: TslNode, directionY: TslNode,
    rayLength: TslNode, referenceHeight: TslNode): TslNode => {
    const rising = directionY.greaterThan(0);
    const falling = directionY.lessThan(0);
    const risingLength = startHeight.greaterThanEqual(referenceHeight).select(float(0),
      endHeight.lessThanEqual(referenceHeight).select(rayLength,
        referenceHeight.sub(startHeight).div(directionY)));
    const fallingLength = startHeight.lessThanEqual(referenceHeight).select(rayLength,
      endHeight.greaterThanEqual(referenceHeight).select(float(0),
        referenceHeight.sub(endHeight).div(directionY.negate())));
    const flatLength = startHeight.lessThanEqual(referenceHeight).select(rayLength, float(0));
    const below = rising.select(risingLength, falling.select(fallingLength, flatLength));
    return clamp(below, 0, rayLength);
  };

  /** GLSL atmosphereSmallQIntegral: (1 - exp(-q)) / q by its Taylor series near zero. */
  const smallQIntegral = (q: TslNode): TslNode =>
    float(1).sub(q.mul(float(0.5).sub(q.mul(float(1 / 6).sub(q.mul(
      float(1 / 24).sub(q.div(120))))))));

  /** GLSL atmosphereIntegratedAboveDensity: integrated density above the reference height. */
  const integratedAboveDensity = (startHeight: TslNode, endHeight: TslNode, rayLength: TslNode,
    falloff: TslNode): TslNode => {
    const startDensity = exp(falloff.mul(startHeight).negate());
    const endDensity = exp(falloff.mul(endHeight).negate());
    const q = falloff.mul(endHeight.sub(startHeight));
    const series = startDensity.mul(rayLength).mul(smallQIntegral(q));
    const quotient = startDensity.sub(endDensity).mul(rayLength).div(q);
    const small = abs(q).lessThan(ATMOSPHERE_SMALL_Q);
    const positiveFalloff = small.select(series, quotient);
    const integrated = falloff.greaterThan(0).select(positiveFalloff, startDensity.mul(rayLength));
    const positive = max(integrated, 0);
    return positive.mul(rayLength.greaterThan(0).select(float(1), float(0)));
  };

  /** GLSL atmosphereBankEyeVisibility: soft shell occupancy of one world-anchored bank. */
  const bankEyeVisibility = (bank: TslNode): TslNode => {
    const density = bankParams.x;
    const verticalScale = clamp(bankParams.y, 0.05, ATMOSPHERE_BELOW_HORIZON_BAND);
    const softness = clamp(bankParams.z, 0.05, 0.95);
    const inverseRadius = float(1).div(bank.w);
    const offset = vec3(eye.x.sub(bank.x).mul(inverseRadius),
      eye.y.sub(bank.y).mul(inverseRadius.div(verticalScale)),
      eye.z.sub(bank.z).mul(inverseRadius));
    const occupied = float(1).sub(smoothstep(float(1).sub(softness), 1, length(offset)));
    return bank.w.greaterThan(0).and(density.greaterThan(0)).select(occupied, float(0));
  };

  /** GLSL atmosphereBankSegmentDensity: three soft ellipsoid samples along the chord. */
  const bankSegmentDensity = (bank: TslNode, ray: TslAtmosphereRay): TslNode => {
    const density = bankParams.x;
    const verticalScale = clamp(bankParams.y, 0.05, ATMOSPHERE_BELOW_HORIZON_BAND);
    const softness = clamp(bankParams.z, 0.05, 0.95);
    const inverseRadius = float(1).div(bank.w);
    const inverseVertical = inverseRadius.div(verticalScale);
    const origin = vec3(ray.origin.x.sub(bank.x).mul(inverseRadius),
      ray.origin.y.sub(bank.y).mul(inverseVertical),
      ray.origin.z.sub(bank.z).mul(inverseRadius));
    const direction = vec3(ray.direction.x.mul(inverseRadius),
      ray.direction.y.mul(inverseVertical), ray.direction.z.mul(inverseRadius));
    const a = dot(direction, direction);
    const b = dot(origin, direction);
    const c = dot(origin, origin).sub(1);
    const discriminant = b.mul(b).sub(a.mul(c));
    const root = sqrt(max(discriminant, 0));
    const start = max(b.negate().sub(root).div(a), 0);
    const end = min(b.negate().add(root).div(a), ray.length);
    const chord = max(end.sub(start), 0);
    let sampled: TslNode = float(0);
    for (let sample = 1; sample <= 3; sample++) {
      const offset = origin.add(direction.mul(start.add(chord.mul(sample / 4))));
      sampled = sampled.add(float(1).sub(smoothstep(float(1).sub(softness), 1, length(offset))));
    }
    const segment = density.mul(chord).mul(sampled.div(3)).mul(bankEyeVisibility(bank));
    const gated = bank.w.greaterThan(0).and(density.greaterThan(0)).and(ray.length.greaterThan(0))
      .and(discriminant.greaterThan(0)).and(chord.greaterThan(0));
    return gated.select(segment, float(0));
  };

  const banksOpticalDepth = (ray: TslAtmosphereRay): TslNode =>
    bankParams.w.lessThan(0.5).select(float(0), bankSegmentDensity(bankA, ray)
      .add(bankParams.w.greaterThan(1.5).select(bankSegmentDensity(bankB, ray), float(0))));

  /** GLSL atmosphereOpticalDepth: extinction through the clipped volume plus both banks. */
  const opticalDepth = (ray: TslAtmosphereRay): TslNode => {
    const clipped = clipRay(ray);
    const extinction = max(profile.x, 0);
    const falloff = max(profile.y, 0);
    const referenceHeight = profile.z;
    const startHeight = clipped.origin.y;
    const endHeight = startHeight.add(clipped.direction.y.mul(clipped.length));
    const belowLength = belowReferenceLength(startHeight, endHeight, clipped.direction.y,
      clipped.length, referenceHeight);
    const aboveLength = max(clipped.length.sub(belowLength), 0);
    const aboveDensity = integratedAboveDensity(max(startHeight.sub(referenceHeight), 0),
      max(endHeight.sub(referenceHeight), 0), aboveLength, falloff);
    const depth = extinction.mul(belowLength.add(aboveDensity))
      .add(banksOpticalDepth(clipped));
    const bounded = min(max(depth, 0), ATMOSPHERE_MAX_OPTICAL_DEPTH);
    return atmospherePass.greaterThan(0.5).select(bounded, float(0));
  };

  const rainbowLobe = (offset: TslNode, outer: TslNode, inner: TslNode): TslNode => {
    const width = offset.greaterThan(0).select(outer, inner);
    const scaled = offset.div(width);
    return exp(scaled.mul(scaled).mul(-0.5));
  };

  const rainbowPrimary = (theta: TslNode, outer: TslNode, inner: TslNode): TslNode =>
    RAINBOW_PRIMARY_SAMPLES.reduce((sum: TslNode, sample) => sum.add(
      rainbowLobe(theta.sub(sample.radius), outer, inner)
        .mul(vec3(sample.hue[0], sample.hue[1], sample.hue[2]))), vec3(0));

  /** GLSL atmosphereRainbowRadiance (owner default: the primary bow only). */
  const rainbow = (direction: TslNode): TslNode => {
    const radiance = vec3(0).toVar();
    If(rainbowStrength.greaterThan(0), () => {
      const cosine = dot(normalize(direction), atmosphereSun.xyz.negate()) as TslNode;
      const inRing = cosine.lessThanEqual(RAINBOW.ringInnerCos)
        .and(cosine.greaterThanEqual(RAINBOW.ringOuterCos));
      If(inRing, () => {
        const theta = degrees(acos(cosine)) as TslNode;
        const bows = vec3(0).toVar();
        If(theta.greaterThan(37).and(theta.lessThan(44.5)),
          () => bows.assign(rainbowPrimary(theta, 0.26, 0.44)));
        const inside = exp(min(theta.sub(RAINBOW.primaryViolet), 0).div(RAINBOW.glowFalloff))
          .mul(float(1).sub(smoothstep(RAINBOW.primaryViolet, 42, theta)));
        const glow = inside.mul(RAINBOW.innerGlow).mul(smoothstep(25, 34, theta));
        const tintLuminance = dot(atmosphereSunTint.xyz, vec3(0.2126, 0.7152, 0.0722));
        const tint = mix(vec3(tintLuminance), atmosphereSunTint.xyz, 0.35);
        radiance.assign(tint.mul(rainbowStrength.mul(RAINBOW.peak))
          .mul(bows.add(vec3(RAINBOW.glowHue[0], RAINBOW.glowHue[1], RAINBOW.glowHue[2])
            .mul(glow))));
      });
    });
    return radiance;
  };

  const atmospherePhase = (cosTheta: TslNode, g: TslNode): TslNode => {
    const denominator = max(float(1).add(g.mul(g)).sub(g.mul(2).mul(cosTheta)), 0.0001);
    return float(1).sub(g.mul(g)).div(denominator.mul(denominator.sqrt()));
  };

  const airlight = (direction: TslNode, tau: TslNode): TslNode => {
    const share = atmosphereSun.w;
    const phase = atmospherePhase(dot(normalize(direction), atmosphereSun.xyz) as TslNode,
      atmosphereSunTint.w);
    const lobe = airlightLinear.mul(float(1).sub(share))
      .add(atmosphereSunTint.xyz.mul(share.mul(phase)));
    const thinTint = mix(vec3(1), vec3(0.93, 0.99, 1.1), exp(tau.mul(-2)));
    // P33/P40: the select emits an if/else, and both arms share this subtree; pin it first at the
    // current statement stack (the callers build the air inside an Fn) so the else arm reads it.
    const air = lobe.mul(thinTint).toVar();
    const bowed = air.add(rainbow(direction));
    return tau.lessThan(RAINBOW.minTau).select(air, bowed);
  };

  /** GLSL composeAtmosphereLinearToward: the one airlight blend, in linear light. */
  const compose = (radiance: TslNode, tau: TslNode, direction: TslNode): TslNode => {
    const result = radiance.toVar();
    If(atmospherePass.greaterThan(0.5).and(tau.greaterThan(0)), () => {
      const opacity = float(1).sub(exp(min(tau, ATMOSPHERE_MAX_OPTICAL_DEPTH).negate()));
      result.assign(mix(result, airlight(direction, tau), clamp(opacity, 0, 1)));
    });
    return result;
  };

  /** GLSL concealmentOpticalDepth: six fog-map samples under a soft height falloff. */
  const concealment = (ray: TslAtmosphereRay): TslNode => {
    const depth = float(0).toVar();
    const gated = fogMap !== null && explorationFog.greaterThan(0)
      .and(liveFog.greaterThanEqual(0.5)).and(atmospherePass.greaterThan(0.5))
      .and(worldSize.x.greaterThan(0)).and(worldSize.y.greaterThan(0))
      .and(ray.length.greaterThan(3));
    If(gated, () => {
      const span = min(ray.length, 128).sub(3);
      const stepLength = span.div(6);
      for (let sample = 0; sample < 6; sample++) {
        const along = float(3).add(float(sample + 0.5).mul(stepLength));
        const point = ray.origin.add(ray.direction.mul(along));
        const edge: TslNode = min(point.xz, worldSize.sub(point.xz));
        const interior = smoothstep(0, 12, min(edge.x, edge.y));
        const visibility = texture(fogMap, point.xz.div(worldSize)).r as TslNode;
        const hidden = float(1).sub(smoothstep(0.12, 0.48, visibility));
        const height = exp(max(point.y.sub(profile.z).sub(2), 0).mul(-0.12));
        depth.assign(depth.add(hidden.mul(interior).mul(height).mul(stepLength).mul(0.12)));
      }
    });
    return min(depth.mul(explorationFog), 32);
  };

  const orthoDepth = bindScalar(bindings, "uAtmosphereOrthoDepth", 0) as TslNode;
  const viewFar = bindScalar(bindings, "uAtmosphereFar", 0) as TslNode;

  /**
   * GLSL atmosphereSurfaceRay: the bounded parallel ray of the orthographic view (its depth follows
   * the view span, never behind the camera plane), else the eye to the surface.
   */
  const surfaceRay = (world: TslNode): TslAtmosphereRay => {
    const forwardSquared = dot(forward, forward) as TslNode;
    const parallel = forward.mul(inversesqrt(max(forwardSquared, ATMOSPHERE_MIN_DIRECTION_SQUARED)));
    const spanLength = min(min(diagonal.mul(2), orthoDepth), max(dot(world.sub(eye), parallel), 0));
    const parallelLength = orthoDepth.greaterThan(0).select(spanLength, diagonal.mul(2)) as TslNode;
    const parallelValid = forwardSquared.greaterThan(ATMOSPHERE_MIN_DIRECTION_SQUARED);
    const offset = world.sub(eye) as TslNode;
    const distanceSquared = dot(offset, offset) as TslNode;
    const distance = sqrt(max(distanceSquared, ATMOSPHERE_MIN_DIRECTION_SQUARED)) as TslNode;
    const perspectiveValid = distanceSquared.greaterThan(ATMOSPHERE_MIN_DIRECTION_SQUARED);
    const isParallel = profile.w.greaterThan(0.5);
    const rayLength = isParallel.select(parallelValid.select(parallelLength, float(0)),
      perspectiveValid.select(distance, float(0)));
    const direction = isParallel.select(parallel, offset.div(distance));
    return {
      direction,
      length: diagonal.greaterThan(0).select(rayLength, float(0)),
      origin: isParallel.select(world.sub(parallel.mul(rayLength)), eye)
    };
  };

  /** GLSL atmosphereViewDirection: the view ray towards a surface (parallel in the isometric view). */
  const viewDirection = (world: TslNode): TslNode => {
    const offset = world.sub(eye) as TslNode;
    const lengthSquared = dot(offset, offset) as TslNode;
    const toSurface = offset.mul(inversesqrt(max(lengthSquared, ATMOSPHERE_MIN_DIRECTION_SQUARED)));
    const parallel = profile.w.greaterThan(0.5).or(lengthSquared.greaterThan(ATMOSPHERE_MIN_DIRECTION_SQUARED).not());
    return parallel.select(normalize(forward), toSurface);
  };

  /** GLSL atmosphereViewLimitOpticalDepth: the possessed view's veil before the far plane. */
  const viewLimit = (world: TslNode): TslNode => {
    const viewDepth = dot(world.sub(eye), forward) as TslNode;
    const veil = smoothstep(viewFar.mul(0.6), viewFar.mul(0.98), viewDepth).mul(explorationFog);
    const active = atmospherePass.greaterThan(0.5).and(explorationFog.greaterThan(0))
      .and(viewFar.greaterThan(0)).and(viewDepth.greaterThan(viewFar.mul(0.6)));
    return active.select(log(max(float(1).sub(veil), 0.000001)).negate(), float(0));
  };

  /**
   * GLSL atmosphereSurfaceTau (common-glsl.ts): the camera air between the eye and a surface, its
   * concealment veil and the view limit. Call inside an `Fn` (the gate is an `If`).
   */
  const surfaceTau = (world: TslNode): TslNode => {
    const tau = float(0).toVar();
    const active = atmospherePass.greaterThan(0.5).and(profile.x.greaterThan(0)
      .or(explorationFog.greaterThan(0)).or(bankParams.w.greaterThanEqual(0.5)));
    If(active, () => {
      const ray = pinRay(surfaceRay(world));
      tau.assign(opticalDepth(ray).add(concealment(ray)).add(viewLimit(world)));
    });
    return tau;
  };

  /**
   * Camera-air transmittance along a sky ray, matching compose's blend. GLSL
   * explorationAirTransmittance: no pass or a depth that is not positive (also NaN) passes 1.
   */
  const airTransmittance = (tau: TslNode): TslNode =>
    atmospherePass.lessThan(0.5).or(tau.greaterThan(0).not()).select(float(1),
      exp(min(tau, ATMOSPHERE_MAX_OPTICAL_DEPTH).negate()));

  return {
    airlight,
    airTransmittance,
    compose,
    concealment,
    forward,
    opticalDepth,
    pinRay,
    rainbow,
    skyRay,
    surfaceRay,
    surfaceTau,
    viewDirection
  };
};

export type AtmosphereNodes = ReturnType<typeof createAtmosphereNodes>;
