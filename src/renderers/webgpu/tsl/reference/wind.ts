import { valueNoise } from "./noise";

/** CPU reference of `WIND_GLSL`; tests compare these table cases with tolerance 1e-4. */
export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export const windDisplacement = (xz: Vec2, phase: number, time: number,
  wind: Vec2, windPhase: Vec2): Vec2 => {
  const strength = Math.hypot(wind[0], wind[1]);
  const direction: Vec2 = [wind[0] / Math.max(strength, 0.001), wind[1] / Math.max(strength, 0.001)];
  const gust = valueNoise(xz[0] * 0.07 - windPhase[0] * 0.35, xz[1] * 0.07 - windPhase[1] * 0.35);
  const push = (0.3 + gust * gust * 1.8) * strength;
  const sway = Math.sin(time * 1.9 + phase + xz[0] * 0.37 + xz[1] * 0.23) * (0.4 + 0.6 * gust);
  const tremble = Math.sin(time * 7.3 + phase * 2.3) * gust * gust;
  const across: Vec2 = [-direction[1], direction[0]];
  const acrossScale = Math.sin(time * 1.3 + phase * 1.7) * 0.006 * strength;
  const along = direction[0] * push * (0.08 + sway * 0.035 + tremble * 0.012);
  const alongZ = direction[1] * push * (0.08 + sway * 0.035 + tremble * 0.012);
  return [along + across[0] * acrossScale, alongZ + across[1] * acrossScale];
};

export const flutterOffset = (position: Vec3, phase: number, time: number): Vec3 => [
  Math.sin(time * 11 + phase * 3 + position[1] * 11) * 0.014,
  Math.sin(time * 9.4 + phase + position[0] * 9) * 0.5 * 0.014,
  Math.cos(time * 12.3 + phase * 2 + position[2] * 13) * 0.014
];

export const branchSway = (position: Vec3, phase: number, time: number, wind: Vec2): Vec3 => {
  const wave = phase + position[0] * 5.3 + position[2] * 4.1 + position[1] * 2;
  const strength = 0.4 + Math.hypot(wind[0], wind[1]);
  return [
    Math.sin(time * 3.1 + wave) * 0.012 * strength,
    0,
    Math.cos(time * 2.7 + wave * 1.3) * 0.012 * strength
  ];
};
