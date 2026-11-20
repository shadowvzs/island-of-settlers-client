import { type Color3, computeEnvironment, type EnvironmentState, TIME_PRESETS } from "../environment";

const daylight = computeEnvironment({ azimuthX: 0, azimuthZ: 1, elevation: Math.PI / 4 }, TIME_PRESETS.day, 0);

/** Relative scene-light tint for tiny baked canonical pixels; never an emissive night decoration. */
export const ornamentalOverviewLight = (environment: Pick<EnvironmentState, "ambientSky" | "sunColor">): Color3 => {
  const intensity = (channel: number) => Math.max(0, Math.min(1,
    (environment.ambientSky[channel]! + environment.sunColor[channel]! * .5) /
    (daylight.ambientSky[channel]! + daylight.sunColor[channel]! * .5)));
  return [intensity(0), intensity(1), intensity(2)];
};
