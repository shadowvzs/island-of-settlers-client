import { smoothstep } from "../../shared/world/noise";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Grass height weight for the current view. Isometric keeps the historical zoom fade; the possessed
 * view blends to full height so the strategic zoom used before possessing no longer squashes it.
 */
export const getGrassFade = (
  grassEnabled: boolean,
  strategicZoom: number,
  possessedBlend: number
) => {
  if (!grassEnabled) return 0;
  const isoFade = smoothstep(0.3, 0.6, strategicZoom);
  return isoFade + (1 - isoFade) * clamp01(possessedBlend);
};
