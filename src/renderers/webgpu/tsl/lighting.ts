import { clamp, dot, float, Fn, max, mix, normalize, smoothstep, vec3 } from "three/tsl";

import { SURFACE_LIGHT } from "../../../render-common/lighting/surface-light";
import { CLOUD_FIELD, CLOUD_HEIGHT } from "../../../render-common/shaders/cloud-glsl";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/**
 * TSL twin of LIGHTING_GLSL (common-glsl): the SH9 sky irradiance (R05, Three's
 * SphericalHarmonics3 order over P = [1, y, z, x, xy, yz, 3z² − 1, xz, x² − y²]), the projected
 * cloud shadow and the shared `lightSurface`. Inputs are nodes, so materials bind the existing
 * shared uniforms and the parity bench binds plain uniforms.
 */
export interface LightingNodeOptions {
  ambientSky: TslNode;
  cloudCover: TslNode;
  cloudDrift: TslNode;
  fbm3: (point: TslNode) => TslNode;
  highlight: TslNode;
  /** SKY_IRRADIANCE_L1 (Minimal's lite ground): only the quadratic band's vertical part. */
  lowOrderSky?: boolean;
  rain: TslNode;
  /** The nine `uSkyIrradiance` coefficients as vec3 nodes. */
  skyIrradiance: readonly TslNode[];
  sunColor: TslNode;
  sunDirection: TslNode;
  viewDirection: TslNode;
}

const skyLinearBand = (coefficients: readonly TslNode[], normal: TslNode): TslNode =>
  coefficients[1].mul(normal.y)
    .add(coefficients[2].mul(normal.z))
    .add(coefficients[3].mul(normal.x));

const skyQuadraticBand = (coefficients: readonly TslNode[], normal: TslNode): TslNode =>
  coefficients[4].mul(normal.x.mul(normal.y))
    .add(coefficients[5].mul(normal.y.mul(normal.z)))
    .add(coefficients[6].mul(normal.z.mul(normal.z).mul(3).sub(1)))
    .add(coefficients[7].mul(normal.x.mul(normal.z)))
    .add(coefficients[8].mul(normal.x.mul(normal.x).sub(normal.y.mul(normal.y))));

const skyIrradianceBands = (coefficients: readonly TslNode[], normal: TslNode,
  lowOrder: boolean): TslNode => {
  const linear = coefficients[0].add(skyLinearBand(coefficients, normal));
  if (!lowOrder) return linear.add(skyQuadraticBand(coefficients, normal));
  return linear.sub(coefficients[6].add(coefficients[8]).mul(normal.y.mul(normal.y)));
};

export const createLightingNodes = (options: LightingNodeOptions) => {
  const { ambientSky, cloudCover, cloudDrift, fbm3, highlight, lowOrderSky = false, rain,
    skyIrradiance: coefficients, sunColor, sunDirection, viewDirection } = options;

  const skyIrradiance = Fn(([normal]: [TslNode]) =>
    max(skyIrradianceBands(coefficients, normal, lowOrderSky), vec3(0)));

  const cloudDensity = Fn(([xz]: [TslNode]) => {
    const noise = fbm3(xz.mul(CLOUD_FIELD.noiseScale).add(cloudDrift.mul(CLOUD_FIELD.driftScale)));
    const edge = float(1).sub(cloudCover);
    return smoothstep(edge, edge.add(CLOUD_FIELD.edgeWidth), noise);
  });

  const cloudShadow = Fn(([xz]: [TslNode]) => {
    const projected = xz.add(sunDirection.xz.mul(CLOUD_HEIGHT)
      .div(max(sunDirection.y, CLOUD_FIELD.shadowMinSunHeight)));
    return mix(1, CLOUD_FIELD.shadowShade, cloudDensity(projected));
  });

  /** Wrapped Lambert sun + SH9 sky, cloud shadow, rain darkening and the wet sheen. */
  const lightSurface = Fn(([albedo, normal, sunVisibility, occlusion, xz]:
  [TslNode, TslNode, TslNode, TslNode, TslNode]) => {
    const wrapped = clamp(dot(normal, sunDirection).add(SURFACE_LIGHT.sunWrap)
      .div(1 + SURFACE_LIGHT.sunWrap), 0, 1);
    const wetAlbedo = albedo.mul(float(1).sub(rain.mul(SURFACE_LIGHT.rainDarkening)));
    const color = wetAlbedo.mul(sunColor.mul(wrapped).mul(sunVisibility).mul(cloudShadow(xz))
      .add(skyIrradiance(normal).mul(occlusion).mul(SURFACE_LIGHT.skyShare)));
    const halfway: TslNode = normalize(sunDirection.add(viewDirection));
    const sheen = max(dot(normal, halfway), 0).pow(SURFACE_LIGHT.sheenPower);
    const sheenLight = sunColor.mul(SURFACE_LIGHT.sheenSun).add(ambientSky.mul(SURFACE_LIGHT.sheenSky));
    return color.add(sheenLight.mul(sheen).mul(rain).mul(highlight)
      .mul(smoothstep(SURFACE_LIGHT.sheenSlopeStart, SURFACE_LIGHT.sheenSlopeEnd, normal.y)));
  });

  return { cloudShadow, lightSurface, skyIrradiance };
};
