import { DMath } from "../../../math/deterministic-math";
import { ALPINE_HEIGHT_SAMPLES, ALPINE_HEIGHT_SIZE } from "./alpine-height-data";

/** Versioned key: saved maps retain their source shape when new templates are added. */
export type MountainTemplate = "great-mountain-v1";

export const isMountainTemplate = (value: unknown): value is MountainTemplate =>
  value === "great-mountain-v1";

/** Bilinear normalized height; outside the fitted circular footprint the rise is zero. */
export const sampleMountainTemplate = (x: number, z: number) => {
  const radius = DMath.hypot(x, z);
  if (radius >= 1) return 0;
  const last = ALPINE_HEIGHT_SIZE - 1;
  const column = (x + 1) * 0.5 * last;
  const row = (z + 1) * 0.5 * last;
  const lowX = Math.floor(column);
  const lowZ = Math.floor(row);
  const dx = column - lowX;
  const dz = row - lowZ;
  const at = (x: number, z: number) => ALPINE_HEIGHT_SAMPLES[z * ALPINE_HEIGHT_SIZE + x]! / 65535;
  const top = at(lowX, lowZ) * (1 - dx) + at(lowX + 1, lowZ) * dx;
  const bottom = at(lowX, lowZ + 1) * (1 - dx) + at(lowX + 1, lowZ + 1) * dx;
  // Bilinear interpolation can straddle the circular cut despite feathered grid samples.
  // This final analytic rim guarantees continuous ground contact between sample points.
  const rim = Math.min(1, (1 - radius) / 0.08);
  return (top * (1 - dz) + bottom * dz) * rim * rim * (3 - 2 * rim);
};
