import { valueNoise } from "./noise";

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

const IOR_WATER = 1.333;

export const refractedSunOffset = (sunDirection: Vec2): Vec2 => {
  const across: Vec2 = [sunDirection[0] / IOR_WATER, sunDirection[1] / IOR_WATER];
  const scale = 1 / Math.sqrt(Math.max(1 - (across[0] * across[0] + across[1] * across[1]), 0.05));
  return [across[0] * scale, across[1] * scale];
};

const causticLayer = (x: number, y: number, time: number): number => {
  const warpX = valueNoise(x + time * 0.3, y + time * 0.3);
  const warpY = valueNoise(y - time * 0.25 + 7, x - time * 0.25 + 7);
  const value = valueNoise(x * 2.2 + warpX * 2, y * 2.2 + warpY * 2);
  return (1 - Math.abs(value * 2 - 1)) ** 7;
};

export const caustics = (xz: Vec2, time: number): number => {
  const x = xz[0] * 0.85;
  const y = xz[1] * 0.85;
  const first = causticLayer(x, y, time);
  const second = causticLayer(x * 1.7 + 3.1, y * 1.7 + 3.1, time);
  return (first + second) * 0.6;
};

export const waterlineGround = (lit: Vec3, signedDepth: number, xz: Vec2, time: number,
  sunDirection: Vec3, sunColor: Vec3): Vec3 => {
  const depth = Math.max(signedDepth, 0);
  const shallow = Math.exp(-depth * 0.9) * smoothstep(0, 0.12, depth);
  const offset = refractedSunOffset([sunDirection[0], sunDirection[2]]);
  const entry: Vec2 = [xz[0] + offset[0] * depth, xz[1] + offset[1] * depth];
  const sunLight = smoothstep(0.04, 0.3, sunDirection[1]);
  const amount = caustics(entry, time) * 0.32 * shallow * sunLight;
  return [lit[0] + sunColor[0] * amount, lit[1] + sunColor[1] * amount, lit[2] + sunColor[2] * amount];
};

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};
