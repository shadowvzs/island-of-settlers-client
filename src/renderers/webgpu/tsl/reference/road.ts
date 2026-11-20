import { TRAFFIC_WEAR_TUNING } from "../../../../render-common/traffic-wear-tuning";

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

/** CPU reference of `trafficWheelTrack` in tsl/road.ts. */
export const trafficWheelTrack = (signed: number, halfWidth: number, soft: number): number => {
  const wheel = Math.abs(Math.abs(signed) - TRAFFIC_WEAR_TUNING.wheelHalfGauge);
  return 1 - smoothstep(halfWidth - soft, halfWidth + soft, wheel);
};
