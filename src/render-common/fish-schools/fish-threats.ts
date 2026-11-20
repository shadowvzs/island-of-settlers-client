/** Most threats considered per frame (ships, boats and people near the active schools). */
const THREAT_CAPACITY = 32;

/**
 * What the fish flee from this frame: points with a reach (a hull, a rowing boat, a wading
 * person). Only threats inside the active schools' bounds are kept, so a big crowd on land
 * costs one bounds test per person.
 */
export const createFishThreats = () => {
  const x = new Float32Array(THREAT_CAPACITY);
  const z = new Float32Array(THREAT_CAPACITY);
  const reach = new Float32Array(THREAT_CAPACITY);
  const bounds = { maxX: -Infinity, maxZ: -Infinity, minX: Infinity, minZ: Infinity };
  const nearest = { distance: Infinity, x: 0, z: 0 };
  let count = 0;

  /** Starts a frame: no threats, the bounds reset (grown by `include`). */
  const clear = () => {
    count = 0;
    bounds.minX = bounds.minZ = Infinity;
    bounds.maxX = bounds.maxZ = -Infinity;
  };

  /** Grows the bounds to hold a circle (an active school's home). */
  const include = (atX: number, atZ: number, radius: number) => {
    bounds.minX = Math.min(bounds.minX, atX - radius);
    bounds.minZ = Math.min(bounds.minZ, atZ - radius);
    bounds.maxX = Math.max(bounds.maxX, atX + radius);
    bounds.maxZ = Math.max(bounds.maxZ, atZ + radius);
  };

  const add = (atX: number, atZ: number, radius: number) => {
    if (count >= THREAT_CAPACITY) return;
    if (atX + radius < bounds.minX || atX - radius > bounds.maxX) return;
    if (atZ + radius < bounds.minZ || atZ - radius > bounds.maxZ) return;
    x[count] = atX;
    z[count] = atZ;
    reach[count] = radius;
    count += 1;
  };

  /**
   * The nearest threat whose reach (plus `margin`) holds the point, as a scratch result (no
   * allocation), or null.
   */
  const find = (atX: number, atZ: number, margin: number) => {
    nearest.distance = Infinity;
    for (let index = 0; index < count; index += 1) {
      const distance = Math.hypot(atX - x[index]!, atZ - z[index]!);
      if (distance >= reach[index]! + margin || distance >= nearest.distance) continue;
      nearest.distance = distance;
      nearest.x = x[index]!;
      nearest.z = z[index]!;
    }
    return nearest.distance < Infinity ? nearest : null;
  };

  /** Flee acceleration of a fish from every threat within reach (written into `out`). */
  const push = (atX: number, atZ: number, strength: number, out: { x: number; z: number }) => {
    out.x = 0;
    out.z = 0;
    for (let index = 0; index < count; index += 1) {
      const dx = atX - x[index]!, dz = atZ - z[index]!;
      const distance = Math.hypot(dx, dz);
      if (distance >= reach[index]! || distance < 1e-4) continue;
      const weight = strength * (1 - distance / reach[index]!);
      out.x += (dx / distance) * weight;
      out.z += (dz / distance) * weight;
    }
    return out;
  };

  return { add, clear, count: () => count, find, include, push };
};

export type FishThreats = ReturnType<typeof createFishThreats>;
