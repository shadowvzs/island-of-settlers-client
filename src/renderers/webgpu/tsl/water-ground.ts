import { abs, dot, exp, float, max, pow, smoothstep, sqrt, vec2 } from "three/tsl";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

export interface WaterGroundOptions {
  /** Projected cloud visibility in the sun direction (LIGHTING_GLSL `cloudShadow`). */
  cloudShadow: (xz: TslNode) => TslNode;
  /** Baked/real sun visibility at the ground point. */
  sunVisibility: TslNode;
  sunColor: TslNode;
  sunDirection: TslNode;
  time: TslNode;
  valueNoise: (point: TslNode) => TslNode;
}

const IOR_WATER = 1.333;

/**
 * TSL twin of the caustic part of `water-glsl.ts`: `refractedSunOffset`, `caustics` and
 * `waterlineGround`. The caustic pattern sits where the refracted sun ray entered the water, so it
 * shifts with the sun and is lit only by direct sun through the clouds; the ground shader calls it
 * on the seabed before fog. Refraction/SSR remain C-2.
 */
export const createWaterGroundNodes = (options: WaterGroundOptions) => {
  const { cloudShadow, sunColor, sunDirection, sunVisibility, time, valueNoise } = options;

  const refractedSunOffset = (): TslNode => {
    const across = sunDirection.xz.div(IOR_WATER) as TslNode;
    return across.div(sqrt(max(float(1).sub(dot(across, across)), 0.05))) as TslNode;
  };

  const causticLayer = (q: TslNode): TslNode => {
    const warp = vec2(valueNoise(q.add(time.mul(0.3))),
      valueNoise(q.yx.sub(time.mul(0.25)).add(7))) as TslNode;
    const value = valueNoise(q.mul(2.2).add(warp.mul(2))) as TslNode;
    return pow(float(1).sub(abs(value.mul(2).sub(1))), 7) as TslNode;
  };
  const caustics = (xz: TslNode): TslNode =>
    causticLayer(xz.mul(0.85)).add(causticLayer(xz.mul(0.85).mul(1.7).add(3.1))).mul(0.6) as TslNode;

  const waterlineGround = (lit: TslNode, signedDepth: TslNode, xz: TslNode): TslNode => {
    const depth = max(signedDepth, 0) as TslNode;
    const shallow = exp(depth.mul(-0.9)).mul(smoothstep(0, 0.12, depth)) as TslNode;
    const entry = xz.add(refractedSunOffset().mul(depth)) as TslNode;
    const sunLight = sunVisibility.mul(cloudShadow(entry))
      .mul(smoothstep(0.04, 0.3, sunDirection.y)) as TslNode;
    return lit.add(caustics(entry).mul(sunColor).mul(0.32).mul(shallow).mul(sunLight)) as TslNode;
  };

  return { caustics, refractedSunOffset, waterlineGround };
};
