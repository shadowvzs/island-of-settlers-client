import type { Random } from "../../shared/world/rng";
import { dot, normalize, type Vec3 } from "../props/mesh-builder";
import { subtract } from "../props/tree-parts";

/**
 * Irregular crown volume: an ellipsoid whose radius swells and dents per direction (a few
 * random lobes). Limbs grow until they reach it, so the silhouette gets bays and bulges instead
 * of a perfect dome; sprays use it to know how deep inside the crown they sit.
 */
export interface CrownEnvelope {
  centre: Vec3;
  /** 0 at the centre, 1 on the (lobed) surface, > 1 outside. */
  depthOf: (point: Vec3) => number;
  radii: Vec3;
  /** Distance from `start` along `direction` (unit) to the surface; minimum 0.2 x radius. */
  reach: (start: Vec3, direction: Vec3) => number;
}

interface Lobe {
  axis: Vec3;
  strength: number;
  width: number;
}


const createLobes = (random: Random, count: number, strength: number): Lobe[] =>
  Array.from({ length: count }, () => ({
    axis: normalize([random() - 0.5, (random() - 0.35) * 0.8, random() - 0.5]),
    strength: (random() - 0.4) * strength,
    width: 2 + random() * 3
  }));

/** Radius multiplier towards a unit direction (from the crown centre). */
const getLobeScale = (lobes: Lobe[], direction: Vec3) =>
  lobes.reduce((scale, lobe) => {
    const alignment = Math.max(0, dot(direction, lobe.axis));
    return scale + lobe.strength * Math.pow(alignment, lobe.width);
  }, 1);

export const createCrownEnvelope = (
  random: Random,
  centre: Vec3,
  radii: Vec3,
  irregularity: number
): CrownEnvelope => {
  const lobes = createLobes(random, 7, irregularity);
  const depthOf = (point: Vec3) => {
    const offset = subtract(point, centre);
    const scaled: Vec3 = [offset[0] / radii[0], offset[1] / radii[1], offset[2] / radii[2]];
    const length = Math.hypot(...scaled);
    if (length < 1e-6) return 0;
    return length / getLobeScale(lobes, normalize(offset));
  };
  /** March outwards until the point leaves the envelope (cheap, robust to the lobes). */
  const reach = (start: Vec3, direction: Vec3) => {
    const step = Math.max(...radii) * 0.04;
    let distance = 0;
    for (let index = 0; index < 60; index += 1) {
      const point: Vec3 = [
        start[0] + direction[0] * distance,
        start[1] + direction[1] * distance,
        start[2] + direction[2] * distance
      ];
      if (depthOf(point) >= 1) break;
      distance += step;
    }
    return Math.max(Math.min(...radii) * 0.2, distance);
  };
  return { centre, depthOf, radii, reach };
};

/** Per-species crown shading: base + depth^exponent * gain + height * lift, clamped to 0..1. */
export interface CrownShading {
  base: number;
  exponent: number;
  gain: number;
  lift: number;
}

/** Shade of a spray: deep inside the crown is darker, the upper outer skin catches the sun. */
export const getCrownShade = (envelope: CrownEnvelope, position: Vec3, shading: CrownShading) => {
  const depth = Math.min(1.15, envelope.depthOf(position));
  const height = (position[1] - envelope.centre[1]) / envelope.radii[1];
  return Math.min(1, Math.max(0,
    shading.base + Math.pow(depth, shading.exponent) * shading.gain + height * shading.lift));
};
