import { smoothstep01 } from "../../shared/world/noise";

/** Matches the exported 2.8-second plantation clips; presentation only, never a ware transfer. */
export const PLANTATION_CLIP_SECONDS = 2.8;
export const plantationPropWeight = (action: string, time: number) => {
  if (!Number.isFinite(time) || time < 0) return 0;
  const phase = (time % PLANTATION_CLIP_SECONDS) / PLANTATION_CLIP_SECONDS;
  if (action === "lift_honeycomb")
    return smoothstep01((phase - 0.22) / 0.1) * (1 - smoothstep01((phase - 0.68) / 0.14));
  if (action === "pick_grapes")
    return smoothstep01((phase - 0.32) / 0.08) * (1 - smoothstep01((phase - 0.7) / 0.1));
  return 0;
};
