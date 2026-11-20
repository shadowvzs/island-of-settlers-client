import { clamp, distance, float, Fn, fract, max, min, mix, pow, smoothstep } from "three/tsl";

import {
  GRASS_RING_EDGE_NOISE,
  GRASS_RING_EDGE_NOISE_SCALE,
  GRASS_RING_FADE_START,
  GRASS_RING_FALLOFF
} from "../../../render-common/grass/grass-ring-layout";
import { GRASS_RANK_BAND } from "../../three/grass-range";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type NoiseNode = (point: TslNode) => TslNode;

/** 1 / (2π): a tuft's phase (0..2π) as its stable thinning rank (GLSL `0.15915494`). */
const PHASE_TO_RANK = 1 / (2 * Math.PI);

/**
 * TSL twin of the prop vertex's grass keep (three-prop-materials PROP_VERTEX_GLSL with
 * GRASS_RING_SHARE_GLSL): the eye-distance range fade, the possessed ring hole of the short-grass
 * tufts and the nested rank thinning. CPU mirrors: `grassKeepAt` / `grassHoleKeepAt`.
 */
export const createGrassKeepNodes = (valueNoise: NoiseNode) => {
  /** Share of the ring patch drawn at this eye distance (shape: density, full density, radius, cover). */
  const ringShare = Fn(([shape, distanceToEye, root]: [TslNode, TslNode, TslNode]) => {
    const falloff = min(1, pow(shape.y.div(max(distanceToEye, 1e-3)), GRASS_RING_FALLOFF));
    const shifted = distanceToEye.add(valueNoise(root.mul(GRASS_RING_EDGE_NOISE_SCALE))
      .mul(GRASS_RING_EDGE_NOISE).mul(shape.z));
    const edge = float(1).sub(smoothstep(shape.z.mul(GRASS_RING_FADE_START), shape.z, shifted));
    return shape.x.mul(falloff).mul(edge);
  });

  const ringTuftKeep = Fn(([shape, distanceToEye, root]: [TslNode, TslNode, TslNode]) =>
    float(1).sub(min(1, ringShare(shape, distanceToEye, root).div(shape.w))));

  /** hole: eye x/z, radius, possession blend (0 = off). */
  const holeKeep = Fn(([hole, shape, root]: [TslNode, TslNode, TslNode]) => {
    const kept = mix(1, ringTuftKeep(shape, distance(root, hole.xy), root), hole.w);
    return hole.w.lessThanEqual(0).select(float(1), kept);
  });

  /** 1 keeps a tuft whole, 0 removes it. range: eye x/z, fade start, fade end. */
  const grassKeep = Fn(([range, hole, shape, root, phase]:
  [TslNode, TslNode, TslNode, TslNode, TslNode]) => {
    const keep = float(1).sub(smoothstep(range.z, range.w, distance(root, range.xy)))
      .mul(holeKeep(hole, shape, root));
    const rank = fract(phase.mul(PHASE_TO_RANK));
    return clamp(keep.mul(1 + GRASS_RANK_BAND).sub(rank).div(GRASS_RANK_BAND), 0, 1);
  });

  return { grassKeep, holeKeep, ringShare, ringTuftKeep };
};
