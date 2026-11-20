import {
  acos, asin, clamp, dot, float, max, min, mix, pow, smoothstep, sqrt, texture, vec2, vec3
} from "three/tsl";

import { SKY_MODEL } from "../../../../render-common/atmosphere/sky-model";
import { SKY_VIEW_LUT } from "../../../../render-common/atmosphere/sky-view-lut";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

export interface SkyModelNodes {
  /** The sky-view LUT sample (Medium+) or the analytic model (Minimal). */
  radiance: (direction: TslNode, lightDirection: TslNode, daylight: TslNode) => TslNode;
  /** The sky behind the world: radiance fading below the horizon into the backdrop. */
  backdrop: (direction: TslNode, lightDirection: TslNode, daylight: TslNode,
    background: TslNode) => TslNode;
}

export interface SkyModelOptions {
  ambientSky: TslNode;
  fogColor: TslNode;
  /** The sky-view LUT texture on Medium+; null builds the analytic Minimal path. */
  lutTexture?: TslNode;
  sunColor: TslNode;
}

/** TSL twin of SKY_MODEL_GLSL, SKY_VIEW_LUT_GLSL and SKY_RADIANCE_GLSL. */
export const createSkyModelNodes = (options: SkyModelOptions): SkyModelNodes => {
  const { ambientSky, fogColor, lutTexture, sunColor } = options;
  const model = SKY_MODEL;

  /** SKY_MODEL_GLSL skyModelRadiance: display-authored gradient in linear light. */
  const analyticRadiance = (direction: TslNode, lightDirection: TslNode,
    daylight: TslNode): TslNode => {
    const zenithBlend = pow(smoothstep(0, 1, direction.y), model.zenithPower);
    const facing = max(dot(direction, lightDirection), 0);
    const lowSun = daylight.mul(float(1).sub(
      smoothstep(model.lowSunStart, model.lowSunEnd, lightDirection.y)));
    const band = lowSun.mul(float(model.lowSunBandBase)
      .add(facing.mul(facing).mul(facing).mul(model.lowSunBandFacing)));
    const facing2 = facing.mul(facing);
    const facing4 = facing2.mul(facing2);
    const lobe = facing4.mul(facing4).mul(daylight).mul(float(model.forwardScatterBase)
      .add(lowSun.mul(model.forwardScatterLowSun)));
    const dayZenith = mix(vec3(model.dayZenith[0], model.dayZenith[1], model.dayZenith[2]),
      ambientSky.mul(model.dayZenithAmbientGain), model.dayZenithAmbient);
    const dayHorizon = mix(vec3(model.dayHorizon[0], model.dayHorizon[1], model.dayHorizon[2]),
      fogColor, model.dayHorizonFog);
    const zenith = mix(vec3(model.nightZenith[0], model.nightZenith[1], model.nightZenith[2]),
      dayZenith, daylight);
    const horizon = mix(mix(vec3(model.nightHorizon[0], model.nightHorizon[1],
      model.nightHorizon[2]), dayHorizon, daylight),
      vec3(model.lowSunBand[0], model.lowSunBand[1], model.lowSunBand[2]), band);
    return mix(horizon, zenith, zenithBlend).add(sunColor.mul(lobe));
  };

  /** SKY_VIEW_LUT_GLSL skyViewLutRadiance: the tabulated sky model on (azimuth, elevation). */
  const lutRadiance = (direction: TslNode, lightDirection: TslNode): TslNode => {
    const { belowHorizon, halfPi, horizonV } = SKY_VIEW_LUT;
    const elevation = asin(clamp(direction.y, -1, 1));
    const skyV = elevation.greaterThanEqual(0).select(
      float(horizonV).add(float(1 - horizonV).mul(
        sqrt(min(elevation, halfPi).div(halfPi)))),
      float(horizonV).mul(float(1).sub(min(elevation.negate(), belowHorizon).div(belowHorizon))));
    const sunLength = sqrt(dot(lightDirection.xz, lightDirection.xz));
    const sunAzimuth = sunLength.greaterThan(1e-4)
      .select(lightDirection.xz.div(sunLength), vec2(1, 0));
    const horizontal = sqrt(dot(direction.xz, direction.xz));
    const cosAzimuth = horizontal.greaterThan(1e-4)
      .select(dot(direction.xz, sunAzimuth).div(horizontal), float(1));
    const skyU = acos(clamp(cosAzimuth, -1, 1)).mul(1 / Math.PI);
    return texture(lutTexture, vec2(skyU, skyV)).rgb;
  };

  const radiance = (direction: TslNode, lightDirection: TslNode, daylight: TslNode): TslNode =>
    lutTexture === null || lutTexture === undefined
      ? analyticRadiance(direction, lightDirection, daylight)
      : lutRadiance(direction, lightDirection);

  const backdrop = (direction: TslNode, lightDirection: TslNode, daylight: TslNode,
    background: TslNode): TslNode => {
    const upward = smoothstep(-0.08, 0.025, direction.y);
    const belowHorizon = mix(background, fogColor.mul(0.28), 0.3);
    return mix(belowHorizon, radiance(direction, lightDirection, daylight), upward);
  };

  return { backdrop, radiance };
};
