import { type IUniform, Matrix3, Matrix4, Vector3, Vector4 } from "three";

import type { SunDirection } from "../../../shared/world/world-data";

/**
 * CPU side of the night stars (exploration-stars-glsl.ts): the star-sphere rotation and the
 * per-frame visibility, moonlight floor, layer count and wrapped time. No allocation per frame.
 */
export interface ExplorationStarInputs {
  daylight: number;
  /** 0 new moon .. 0.5 full (default full); a bright moon lifts the floor that hides faint stars. */
  moonPhase?: number;
  starPole?: SunDirection;
  starRotation?: number;
  /** 0 .. 1 sky darkness (astronomical twilight); omitted derives it from daylight. */
  starlight?: number;
  timeSeconds: number;
}

/** Without a starlight value, stars appear once daylight is nearly gone. */
const STAR_DAYLIGHT_END = 0.12;
/** Overcast at which the stars are gone (the cloud layers cover most of them before that). */
const STAR_OVERCAST_END = 0.35;
/** Full-moon floor in display light: the faint layer vanishes and mid stars dim. */
const MOONLIGHT_FLOOR = 0.09;
/** Twinkle time wraps at a whole period of both of its frequencies (200 pi s). */
const TWINKLE_PERIOD = 200 * Math.PI;

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const createExplorationStarUniforms = () => {
  const frame = new Matrix3();
  const params = new Vector4(0, 0, 1, 0);
  const rotation = new Matrix4();
  const pole = new Vector3(0, 1, 0);
  const uniforms: Record<string, IUniform> = {
    uStarFrame: { value: frame },
    uStarParams: { value: params }
  };

  /**
   * `cloudDetail` 1..3 (QualityPreset): Minimal (1) draws the bright layer only. `overcast` 0 clear
   * .. 1 full (rain, snow) hides the stars on top of the cloud layers that already cover them.
   */
  const update = (inputs: ExplorationStarInputs, cloudDetail: number, overcast: number) => {
    const night = Math.min(1 - smoothstep(0, STAR_DAYLIGHT_END, inputs.daylight), inputs.starlight ?? 1);
    const clear = 1 - smoothstep(0, STAR_OVERCAST_END, overcast);
    const illumination = 0.5 * (1 - Math.cos((inputs.moonPhase ?? 0.5) * Math.PI * 2));
    const time = ((inputs.timeSeconds % TWINKLE_PERIOD) + TWINKLE_PERIOD) % TWINKLE_PERIOD;
    params.set(night * clear, MOONLIGHT_FLOOR * illumination, cloudDetail > 1 ? 2 : 1, time);
    if (!inputs.starPole || params.x <= 0) return;
    const horizontal = Math.cos(inputs.starPole.elevation);
    pole.set(inputs.starPole.azimuthX * horizontal, Math.sin(inputs.starPole.elevation),
      inputs.starPole.azimuthZ * horizontal).normalize();
    frame.setFromMatrix4(rotation.makeRotationAxis(pole, -(inputs.starRotation ?? 0)));
  };

  return { uniforms, update };
};
