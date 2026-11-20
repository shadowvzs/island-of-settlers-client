import {
  abs, Break, clamp, Continue, cross, dot, exp, float, Fn, If, length, Loop, max, min,
  mix, normalize, pow, smoothstep, sqrt, texture, texture3D, vec2, vec3, vec4
} from "three/tsl";
import type { Texture } from "three/webgpu";

import {
  EXPLORATION_CLOUD,
  EXPLORATION_SUN_DISC_RADIUS
} from "../../../../render-common/atmosphere/exploration-sky-constants";
import { bindScalar, bindTexture, bindVector,
  type UniformBindings } from "../uniform-bindings";
import { sunDirectBeam } from "./sun";
import { SKY_FALLBACK_VOLUME } from "./textures";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

const CLOUD = EXPLORATION_CLOUD;

/** GLSL skyShellDistance: stable positive shell intersection, even at grazing rays. */
export const skyShellDistance = Fn(([direction, cameraAltitude, altitude]:
[TslNode, TslNode, TslNode]) => {
  const originRadius = float(CLOUD.planetRadius).add(cameraAltitude);
  const shellRadius = float(CLOUD.planetRadius).add(altitude);
  const projected = originRadius.mul(direction.y);
  const radiusDifference = shellRadius.sub(originRadius).mul(shellRadius.add(originRadius));
  return radiusDifference.div(sqrt(projected.mul(projected).add(radiusDifference)).add(projected));
});

/** GLSL skyHeightFraction: 0 at the cloud base, 1 at the top. */
export const skyHeightFraction = Fn(([point]: [TslNode]) => {
  const altitude = length(point.add(vec3(0, CLOUD.planetRadius, 0))).sub(CLOUD.planetRadius);
  return altitude.sub(CLOUD.bottom).div(CLOUD.top - CLOUD.bottom);
});

export const skyRemap = Fn(([value, low, high]: [TslNode, TslNode, TslNode]) =>
  clamp(value.sub(low).div(max(high.sub(low), 0.0001)), 0, 1));

/** GLSL skyPhase: unnormalized Henyey-Greenstein phase. */
export const skyCloudPhase = Fn(([cosine, asymmetry]: [TslNode, TslNode]) => {
  const denominator = float(1).add(asymmetry.mul(asymmetry))
    .sub(asymmetry.mul(2).mul(cosine));
  return float(1).sub(asymmetry.mul(asymmetry))
    .div(denominator.mul(sqrt(denominator)));
});

/** GLSL explorationLowCloudOpacity: the lower layer faded out just below the horizon. */
export const explorationLowCloudOpacity = Fn(([transmittance, direction]: [TslNode, TslNode]) =>
  float(1).sub(transmittance).mul(smoothstep(-0.01, 0.035, direction.y)));

/** The WebGL cloud pass's display-space shoulder: caps sunlit tops below clipped white. */
export const capCloudDisplay = (cloud: TslNode): TslNode => {
  const opacity = max(cloud.a, 1e-4);
  const display = pow(max(cloud.rgb.div(opacity), vec3(0)), vec3(1 / 2.2));
  const start = float(EXPLORATION_CLOUD.shoulderStart);
  const range = float(EXPLORATION_CLOUD.shoulderRange);
  const over = max(display.sub(start), vec3(0));
  const capped = min(display, vec3(start)).add(over.div(float(1).add(over.div(range))));
  // The sky composites clouds in display space (the WebGL pass stores premultiplied display too).
  return vec4(capped.mul(cloud.a), cloud.a);
};

interface CloudLight { ambientBottom: TslNode; ambientTop: TslNode; haze: TslNode; sun: TslNode }

/** The march's light colours as variables before its loop (P33: the loop may skip every step). */
const pinCloudLight = (light: CloudLight): CloudLight => ({
  ambientBottom: light.ambientBottom.toVar(),
  ambientTop: light.ambientTop.toVar(),
  haze: light.haze.toVar(),
  sun: light.sun.toVar()
});

export interface CloudLayerSample {
  color: TslNode;
  transmittance: TslNode;
}

export interface CloudNodes {
  density: (point: TslNode, heightFraction: TslNode, detailLevel: TslNode,
    viewDistance: TslNode) => TslNode;
  highLayer: (direction: TslNode, cameraAltitude: TslNode) => {
    color: TslNode;
    opacity: TslNode;
  };
  /**
   * GLSL explorationLowerClouds: premultiplied display cloud of the lower layer and its opacity.
   * `volumetric` reads the resolved half-resolution march (Medium/High).
   */
  lowerLayer: (direction: TslNode, cameraAltitude: TslNode, volumetric: () => TslNode) => TslNode;
  lowOpacity: (transmittance: TslNode, direction: TslNode) => TslNode;
  march: (direction: TslNode, cameraAltitude: TslNode, jitter: TslNode) => TslNode;
  simpleLayer: (direction: TslNode, cameraAltitude: TslNode) => CloudLayerSample;
  sunCloudVisibility: (lightDirection: TslNode, cameraAltitude: TslNode) => TslNode;
  transmittance: (direction: TslNode, cameraAltitude: TslNode) => TslNode;
  visibility: (direction: TslNode, cameraAltitude: TslNode) => TslNode;
}

/** TSL twin of EXPLORATION_CLOUD_GLSL: shell, density, scattering, march and layers. */
export const createCloudNodes = (bindings: UniformBindings): CloudNodes => {
  // `Texture3DNode.sample()` clones into a 2D TextureNode (its uv then builds as vec2), so every
  // sample constructs a 3D node from the shared volume instead. The volume is created before the
  // material and never replaced while it lives.
  const cloudNoise = (bindings.source.uCloudNoise?.value as Texture | undefined)
    ?? SKY_FALLBACK_VOLUME;
  // Explicit level 0: the march samples inside non-uniform control flow, where WGSL's implicit
  // derivative lookup (textureSample) is undefined. The GLSL original also uses the base level.
  const sampleCloudNoise = (uv: TslNode): TslNode =>
    texture3D(cloudNoise, uv).level(float(0)) as TslNode;
  const noiseTexture = bindTexture(bindings, "uNoiseTexture");
  const drift = bindVector(bindings, "uCloudDrift", 4) as TslNode;
  const cloudCover = bindScalar(bindings, "uCloudCover", 0) as TslNode;
  const cloudSamples = bindScalar(bindings, "uCloudSamples", 1) as TslNode;
  const daylight = bindScalar(bindings, "uDaylight", 0) as TslNode;
  const rain = bindScalar(bindings, "uRain", 0) as TslNode;
  const sunDirection = bindVector(bindings, "uSunDirection", 3) as TslNode;
  const sunColor = bindVector(bindings, "uSunColor", 3) as TslNode;
  const ambientSky = bindVector(bindings, "uAmbientSky", 3) as TslNode;
  const fogColor = bindVector(bindings, "uFogColor", 3) as TslNode;

  const cloudCoverage = (point: TslNode): TslNode => {
    const weatherPoint = point.xz.add(drift.xy.mul(0.6)).div(CLOUD.weatherTile);
    const weather = sampleCloudNoise(vec3(weatherPoint, 0.37)).r;
    const cover = clamp(cloudCover, 0, 1);
    const contrast = mix(0.75, 0.3, smoothstep(0.7, 1, cover));
    return clamp(cover.mul(1.05).add(weather.sub(0.5).mul(contrast)), 0, 1);
  };

  /** GLSL skyCloudDensity: coverage profile, cauliflower erosion, optional fine octave. */
  const density = (point: TslNode, heightFraction: TslNode, detailLevel: TslNode,
    viewDistance: TslNode): TslNode => {
    const result = float(0).toVar();
    const coverage = cloudCoverage(point);
    If(coverage.greaterThanEqual(0.02), () => {
      const precipitation = clamp(rain, 0, 1);
      const top = mix(0.35, 1, coverage).mul(mix(1, 0.85, precipitation));
      const profile = smoothstep(0, mix(0.07, 0.03, precipitation), heightFraction)
        .mul(float(1).sub(smoothstep(top.mul(mix(0.35, 0.75, precipitation)), top,
          heightFraction)));
      // Wind shear: the upper part of every cloud runs slightly ahead of its base.
      const shear = vec3(drift.x, 0, drift.y).mul(float(1).add(heightFraction.mul(0.25)));
      const base = sampleCloudNoise(point.add(shear).div(CLOUD.shapeTile)).r;
      const densityScale = mix(3, 4, precipitation);
      const shape: TslNode = skyRemap(base.mul(profile), float(1).sub(coverage), 1)
        .mul(coverage);
      If(shape.lessThanEqual(0).or(detailLevel.lessThan(0.5)), () => {
        result.assign(shape.mul(densityScale));
      }).Else(() => {
        const detailPoint = point.add(shear.mul(1.15)).div(CLOUD.detailTile)
          .add(vec3(0, drift.z.mul(0.0004), 0));
        const detail = sampleCloudNoise(detailPoint).g.toVar();
        // Near clouds (under about 3 km) add a finer octave so their edges stay crisp.
        const nearDetail = float(1).sub(smoothstep(1800, 3500, viewDistance));
        If(nearDetail.greaterThan(0), () => {
          const fine = sampleCloudNoise(detailPoint.mul(3.7)
            .add(vec3(0.31, 0.17, 0.53))).g;
          detail.assign(mix(detail, detail.mul(0.7).add(fine.mul(0.3)), nearDetail));
        });
        const erosion = mix(float(1).sub(detail), detail,
          smoothstep(0.02, 0.18, heightFraction)).mul(0.55);
        result.assign(skyRemap(shape, erosion, 1).mul(densityScale));
      });
    });
    return result;
  };

  /** GLSL skySunScattering: multiple-scattering octaves of Beer-Lambert under a dual lobe. */
  const sunScattering = (lightDepth: TslNode, cosine: TslNode): TslNode => {
    let scattering: TslNode = float(0);
    let amplitude = 1;
    let attenuation = 1;
    let eccentricity = 1;
    for (let octave = 0; octave < 3; octave++) {
      const phase = mix(
        skyCloudPhase(cosine, -0.2 * eccentricity),
        skyCloudPhase(cosine, 0.5 * eccentricity), 0.4);
      scattering = scattering.add(exp(lightDepth.mul(-attenuation))
        .mul(amplitude).mul(phase));
      amplitude *= 0.5;
      attenuation *= 0.4;
      eccentricity *= 0.6;
    }
    return scattering;
  };

  /** GLSL skyCloudLight: the current hour's and weather's light colours, linear. */
  const cloudLight = () => {
    const day = clamp(daylight, 0, 1);
    const storm = clamp(rain, 0, 1);
    const horizonSun = smoothstep(-0.08, 0.06, normalize(sunDirection).y);
    const skyTint = pow(max(ambientSky, 0), vec3(2.2));
    const fog = pow(max(fogColor, 0), vec3(2.2));
    const sunLinear: TslNode = max(sunColor, 0);
    const luminance = dot(sunLinear, vec3(0.2126, 0.7152, 0.0722));
    const sun = mix(vec3(luminance), sunLinear, 0.7)
      .mul(mix(0.05, 0.85, day)).mul(horizonSun).mul(float(1).sub(storm.mul(0.7)));
    const ambientTop = mix(skyTint.mul(0.1), skyTint.mul(0.9).add(fog.mul(0.35)), day)
      .mul(float(1).sub(storm.mul(0.3)));
    // Shaded undersides: a cool grey-blue mix of the sky dome and the horizon haze.
    const ambientBottom = mix(fog.mul(0.02),
      fog.mul(0.5).add(skyTint.mul(0.5)).mul(0.3), day).mul(float(1).sub(storm.mul(0.6)));
    return { ambientBottom, ambientTop, haze: fog.mul(mix(0.12, 1, day)), sun };
  };

  /** GLSL skyLightOpticalDepth: growing taps without erosion toward the light. */
  const lightOpticalDepth = (point: TslNode, lightDirection: TslNode,
    lightSteps: TslNode): TslNode => {
    const depth = float(0).toVar();
    const travelled = float(0).toVar();
    const firstSegment = lightSteps.greaterThan(3.5).select(float(110), float(220)).toVar();
    for (let tap = 0; tap < 4; tap++) {
      If(float(tap).lessThan(lightSteps), () => {
        const segment = firstSegment.mul(2.2 ** tap);
        const probe = point.add(lightDirection.mul(travelled.add(segment.mul(0.5))));
        travelled.assign(travelled.add(segment));
        const fraction = skyHeightFraction(probe);
        If(fraction.greaterThanEqual(0).and(fraction.lessThanEqual(1)), () => {
          depth.assign(depth.add(density(probe, fraction, float(0), float(0)).mul(segment)));
        });
      });
    }
    return depth.mul(CLOUD.lightExtinction);
  };

  const scatteredLight = (light: ReturnType<typeof cloudLight>, extinction: TslNode,
    lightDepth: TslNode, cosine: TslNode, fraction: TslNode): TslNode => {
    // Powder: thin outer shells scatter little toward the eye; the dark crevices between lobes.
    const powder = float(1).sub(exp(extinction.mul(-320)));
    const sun = light.sun.mul(sunScattering(lightDepth, cosine)).mul(mix(0.5, 0.9, powder));
    const ambient = mix(light.ambientBottom, light.ambientTop, sqrt(fraction))
      .mul(mix(0.35, 1, exp(lightDepth.mul(-0.1))));
    return sun.add(ambient);
  };

  /** GLSL explorationCloudMarch: one view ray, premultiplied linear radiance and opacity. */
  const march = (direction: TslNode, cameraAltitude: TslNode, jitter: TslNode): TslNode => {
    const result = vec4(0).toVar();
    const bottomDistance = skyShellDistance(direction, cameraAltitude, CLOUD.bottom);
    const inShell = direction.y.greaterThan(0).and(bottomDistance.greaterThan(0))
      .and(bottomDistance.lessThanEqual(CLOUD.marchLimit));
    If(inShell, () => {
      const endDistance = min(skyShellDistance(direction, cameraAltitude, CLOUD.top),
        CLOUD.marchLimit);
      const stepCount = max(cloudSamples, 2);
      const stepLength = endDistance.sub(bottomDistance).div(stepCount);
      // Pinned before the loop: its Continue/Break branches would leave values first built
      // inside the loop body unset for the distant-bank blend after it (pitfall P1).
      const sunDir = normalize(sunDirection).toVar();
      const cosine = dot(direction, sunDir).toVar();
      // Overcast light arrives from above: shadow the deck from overhead in rain.
      const overcastShare: TslNode = clamp(rain as TslNode, 0, 1).mul(0.75);
      const lightDirection = normalize((sunDir as TslNode)
        .mul(float(1).sub(overcastShare))
        .add(vec3(0, 1, 0).mul(overcastShare)) as TslNode).toVar();
      const lightSteps = cloudSamples.greaterThan(24).select(float(4), float(3)).toVar();
      const light = pinCloudLight(cloudLight());
      const origin = vec3(0, cameraAltitude, 0);
      const radiance = vec3(0).toVar();
      const transmittance = float(1).toVar();
      const horizonFade = smoothstep(0, 0.05, direction.y).toVar();
      Loop(CLOUD.sampleLimit, ({ i }) => {
        If(float(i).greaterThanEqual(stepCount), () => Break());
        const distanceAlongRay = bottomDistance.add(float(i).add(jitter).mul(stepLength));
        const point = origin.add(direction.mul(distanceAlongRay));
        const fraction = clamp(skyHeightFraction(point), 0, 1);
        const sampleDensity = density(point, fraction, float(1), distanceAlongRay)
          .mul(horizonFade);
        If(sampleDensity.lessThan(0.003), () => Continue());
        const extinction = sampleDensity.mul(CLOUD.extinction);
        const lightDepth = lightOpticalDepth(point, lightDirection, lightSteps);
        const scattered = scatteredLight(light, extinction, lightDepth, cosine, fraction);
        // Aerial perspective: far banks melt into the horizon haze.
        const hazeMix = mix(scattered, light.haze,
          float(1).sub(exp(distanceAlongRay.div(-14000))));
        const stepTransmittance = exp(extinction.mul(stepLength).negate());
        radiance.assign(radiance.add(transmittance.mul(hazeMix)
          .mul(float(1).sub(stepTransmittance))));
        transmittance.assign(transmittance.mul(stepTransmittance));
        If(transmittance.lessThan(0.01), () => Break());
      });
      // Banks too far to march converge to the overall cover.
      const distant = smoothstep(CLOUD.marchLimit * 0.55, CLOUD.marchLimit, bottomDistance);
      const distantOpacity = smoothstep(0.2, 0.95, clamp(cloudCover, 0, 1))
        .mul(0.85).mul(horizonFade);
      const faded = mix(radiance, light.haze.mul(distantOpacity), distant);
      const opacity = mix(float(1).sub(transmittance), distantOpacity, distant);
      result.assign(vec4(faded as TslNode, opacity as TslNode));
    });
    return result;
  };

  /** GLSL explorationCloudTransmittance: transmittance only, no lighting or erosion. */
  const transmittance = (direction: TslNode, cameraAltitude: TslNode): TslNode => {
    const result = float(1).toVar();
    const bottomDistance = skyShellDistance(direction, cameraAltitude, CLOUD.bottom);
    If(direction.y.greaterThan(0).and(bottomDistance.greaterThan(0)), () => {
      const endDistance = min(skyShellDistance(direction, cameraAltitude, CLOUD.top),
        CLOUD.marchLimit);
      If(endDistance.greaterThan(bottomDistance), () => {
        const stepLength = endDistance.sub(bottomDistance).div(CLOUD.visibilitySteps);
        const depth = float(0).toVar();
        for (let step = 0; step < CLOUD.visibilitySteps; step++) {
          const distanceAlongRay = bottomDistance.add(float(step + 0.5).mul(stepLength));
          const point = vec3(0, cameraAltitude, 0).add(direction.mul(distanceAlongRay));
          depth.assign(depth.add(density(point, clamp(skyHeightFraction(point), 0, 1),
            float(0), float(0)).mul(stepLength)));
        }
        result.assign(exp(depth.mul(-CLOUD.extinction)));
      });
    });
    return result;
  };

  /** GLSL explorationSimpleCloudLayer: Minimal's flat textured layer (no volume). */
  const simpleLayer = (direction: TslNode, cameraAltitude: TslNode): CloudLayerSample => {
    const distanceAlongRay = skyShellDistance(direction, cameraAltitude, 1550);
    const point = direction.xz.mul(distanceAlongRay).mul(0.0022).add(drift.xy.mul(0.0022));
    const base = texture(noiseTexture, point.div(32));
    // The finer octave at 3.3x carries the fringe detail as well as the lobes.
    const fine = texture(noiseTexture, point.mul(3.3).add(17.1).div(32));
    const shape = base.r.mul(0.7).add(fine.g.mul(0.3));
    // A slow weather mask groups the blobs into banks with clear gaps; it fades into overcast.
    const cover = clamp(cloudCover, 0, 1);
    const weather = texture(noiseTexture, point.mul(0.5).add(vec2(0.37, 0.61)).div(32)).b;
    const threshold = mix(0.68, 0.29, cover).add(float(0.5).sub(weather).mul(0.6)
      .mul(float(1).sub(smoothstep(0.7, 1, cover))));
    // Soft, frayed edges (owner 2026-11-17): a wide falloff eroded at the fringe by the fetched
    // channels' independent detail, so edges break into uneven wisps while cores stay solid.
    const density = smoothstep(threshold.sub(0.04), threshold.add(0.3), shape);
    const fray = fine.b.mul(0.6).add(base.a.mul(0.4));
    const body = clamp(density.mul(1.35).sub(float(1).sub(density).mul(float(1).sub(fray)).mul(0.9))
      .sub(0.12), 0, 1);
    const transmittanceValue = float(1).sub(body.mul(0.86));
    const day = clamp(daylight, 0, 1);
    const silver = pow(max(dot(direction, normalize(sunDirection)), 0), 8);
    let color = mix(vec3(0.045, 0.065, 0.105), vec3(0.85, 0.88, 0.92), day);
    // Dense cores read lighter, thin fringes greyer (same peak brightness as before).
    color = color.mul(float(0.78).add(smoothstep(0.35, 1, body).mul(0.14)).add(silver.mul(0.12)));
    color = color.mul(float(1).sub(clamp(rain, 0, 1).mul(0.52)));
    color = mix(color, mix(vec3(0.025, 0.04, 0.075), fogColor, day),
      smoothstep(6000, 19000, distanceAlongRay).mul(0.85));
    return { color, transmittance: transmittanceValue };
  };

  /** GLSL explorationHighCloudLayer: thin cirrus behind the lower volume. */
  const highLayer = (direction: TslNode, cameraAltitude: TslNode) => {
    const opacity = float(0).toVar();
    const color = vec3(0).toVar();
    If(direction.y.greaterThan(0).and(cloudSamples.greaterThanEqual(1.5))
      .and(cloudCover.greaterThanEqual(0.025)), () => {
      const distanceAlongRay = skyShellDistance(direction, cameraAltitude, 6500);
      const point = direction.xz.mul(distanceAlongRay);
      // Stretched along the upper wind into fibrous streaks: about 2 : 1 (4.5 : 1 drew a comb of
      // parallel strokes converging on the horizon in the look-up perspective).
      const stretched = vec3(point.x.mul(0.0011).add(point.y.mul(0.00025)),
        0, point.y.mul(0.0019).sub(point.x.mul(0.0003)))
        .add(vec3(drift.z.mul(0.004), 0, drift.w.mul(0.004)));
      const weather = sampleCloudNoise(vec3(point.mul(0.0000027)
        .add(vec2(drift.z, drift.w).mul(0.000016)), 0.61)).r;
      const warped = vec3(stretched.x, 0.21, stretched.z).div(16)
        .add(vec3(weather.sub(0.5), 0, 0.2).mul(0.05));
      const broad = sampleCloudNoise(warped).r;
      // The fibres bend and hook with the broad field (no extra fetch), never dead straight.
      const bend = vec3(broad.sub(0.5), 0, broad.sub(0.5).mul(0.6)).mul(0.3);
      const fibres = sampleCloudNoise(warped.mul(vec3(1.4, 1, 1.7))
        .add(vec3(0.17, 0.4, -0.29)).add(bend)).g;
      const wisps = smoothstep(0.45, 0.8, broad)
        .mul(smoothstep(0.3, 0.8, fibres)).mul(smoothstep(0.45, 0.7, weather));
      opacity.assign(wisps.mul(0.08).mul(smoothstep(0.025, 0.2, direction.y))
        .mul(smoothstep(0.025, 0.32, cloudCover)).mul(float(1).sub(rain.mul(0.5))));
      color.assign(mix(vec3(0.06, 0.08, 0.13), vec3(0.9, 0.93, 0.97),
        clamp(daylight, 0, 1)));
    });
    return { color, opacity };
  };

  /**
   * GLSL explorationLowerClouds: none below the horizon or under a clear sky, the flat textured
   * layer on Low/Minimal and the resolved volumetric pass on Medium/High.
   */
  const lowerLayer = (direction: TslNode, cameraAltitude: TslNode,
    volumetric: () => TslNode): TslNode => {
    const result = vec4(0).toVar();
    If(direction.y.greaterThan(0).and(cloudCover.greaterThan(0.025)), () => {
      If(cloudSamples.lessThan(1.5), () => {
        const flat = simpleLayer(direction, cameraAltitude);
        const opacity = float(1).sub(flat.transmittance);
        result.assign(vec4(flat.color.mul(opacity), opacity));
      }).Else(() => {
        result.assign(volumetric());
      });
    });
    return result;
  };

  /** GLSL explorationCloudVisibility: both layers' combined transmittance. */
  const visibility = (direction: TslNode, cameraAltitude: TslNode): TslNode => {
    const result = float(1).toVar();
    If(direction.y.greaterThan(0), () => {
      const high = highLayer(direction, cameraAltitude);
      If(cloudCover.lessThanEqual(0.025), () => {
        result.assign(float(1).sub(high.opacity));
      }).Else(() => {
        const lowTransmittance = float(0).toVar();
        If(cloudSamples.lessThan(1.5), () => {
          lowTransmittance.assign(simpleLayer(direction, cameraAltitude).transmittance);
        }).Else(() => {
          lowTransmittance.assign(transmittance(direction, cameraAltitude));
        });
        result.assign(float(1).sub(high.opacity)
          .mul(float(1).sub(explorationLowCloudOpacity(lowTransmittance, direction))));
      });
    });
    return result;
  };

  /** GLSL explorationSunCloudVisibility: averaged direct-beam share over the disc and rim. */
  const sunCloudVisibility = Fn(([lightDirection, cameraAltitude]:
  [TslNode, TslNode]) => {
    const side = abs(lightDirection.y).lessThan(0.99)
      .select(vec3(0, 1, 0), vec3(1, 0, 0));
    const right = normalize(cross(lightDirection, side));
    const up = cross(right, lightDirection);
    const rim = EXPLORATION_SUN_DISC_RADIUS * 0.7;
    const visible = sunDirectBeam(visibility(lightDirection, cameraAltitude)).mul(0.4).toVar();
    for (let point = 0; point < 3; point++) {
      const angle = point * 2.0943951;
      const rimDirection = normalize(lightDirection
        .add(right.mul(Math.cos(angle)).add(up.mul(Math.sin(angle))).mul(rim)));
      visible.assign(visible.add(
        sunDirectBeam(visibility(rimDirection, cameraAltitude)).mul(0.2)));
    }
    return visible;
  }) as (lightDirection: TslNode, cameraAltitude: TslNode) => TslNode;

  return {
    density,
    highLayer,
    lowerLayer,
    lowOpacity: explorationLowCloudOpacity as (transmittance: TslNode,
      direction: TslNode) => TslNode,
    march,
    simpleLayer,
    sunCloudVisibility,
    transmittance,
    visibility
  };
};
