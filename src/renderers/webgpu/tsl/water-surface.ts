import { float, mix, smoothstep, vec2 } from "three/tsl";

import { CLOUD_FIELD, CLOUD_HEIGHT } from "../../../render-common/shaders/cloud-glsl";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

export interface WaterSurfaceOptions {
  cloudCover: TslNode;
  cloudDrift: TslNode;
  fbm3: (point: TslNode) => TslNode;
  sun: TslNode;
  time: TslNode;
  valueNoise: (point: TslNode) => TslNode;
}

/**
 * Shared water-surface pieces (water.ts and the ship wakes): the cloud shadow over the sea and the
 * lacy foam modulation. Both are pure texture/noise kernels with every tuning constant imported.
 */
export const createWaterSurfaceNodes = ({ cloudCover, cloudDrift, fbm3, sun, time, valueNoise }:
WaterSurfaceOptions) => {
  const cloudShadow = (xz: TslNode): TslNode => {
    const projected = xz.add(sun.xz.mul(CLOUD_HEIGHT)
      .div(sun.y.max(CLOUD_FIELD.shadowMinSunHeight))) as TslNode;
    const noise = fbm3(projected.mul(CLOUD_FIELD.noiseScale)
      .add(cloudDrift.mul(CLOUD_FIELD.driftScale))) as TslNode;
    const edge = float(1).sub(cloudCover) as TslNode;
    return mix(1, CLOUD_FIELD.shadowShade,
      smoothstep(edge, edge.add(CLOUD_FIELD.edgeWidth), noise)) as TslNode;
  };

  const foamLace = (xz: TslNode): TslNode => {
    const coarse = valueNoise(xz.mul(1.7).add(vec2(time.mul(0.21), time.mul(0.13)))) as TslNode;
    const fine = valueNoise(vec2(xz.x.mul(0.8).add(xz.y.mul(0.6)).mul(3.91)
      .sub(time.mul(0.17)).add(19.3), xz.y.mul(0.8).sub(xz.x.mul(0.6)).mul(3.91)
      .add(time.mul(0.11)).add(19.3))) as TslNode;
    return coarse.mul(0.6).add(fine.mul(0.4)) as TslNode;
  };

  return { cloudShadow, foamLace };
};
