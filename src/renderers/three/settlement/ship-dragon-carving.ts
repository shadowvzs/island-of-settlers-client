import type { MeshStandardMaterial } from "three";

import { hash, knot, paintMaps, type Pattern } from "../buildings/viking-statue-textures";
import type { AtlasRect } from "../sculpt-geometry";

/**
 * Carving atlas of the longship's dragon (original procedural art), a multiplier over the vertex
 * paint: the stem-and-neck timber (plain grain up the stem, interlace knotwork from the throat up,
 * u along the timber), overlapping carved scales for the head and plain oak grain for small parts.
 */
export const DRAGON_CARVING_ATLAS = {
  grain: [.52, .52, 1, 1], neck: [0, 0, .48, 1], scales: [.52, 0, 1, .48]
} as const satisfies Record<string, AtlasRect>;

/** Share of the stem-and-neck timber (from the keel) that is plain stem before the carving starts. */
export const DRAGON_NECK_START = .6;

const grain: Pattern = (s, t) => .7 + .16 * Math.sin(s * 9 + Math.sin(t * 40) * .6 + Math.sin(t * 7) * 1.4) +
  (hash(Math.floor(s * 200), Math.floor(t * 900)) - .5) * .08;

/** Overlapping carved scales: rows of rounded tips, each with a cut groove along its edge. */
const scales: Pattern = (s, t) => {
  const y = t * 9, row = Math.floor(y), x = s * 7 + (row % 2) * .5;
  const distance = Math.hypot(x - Math.floor(x) - .5, (y - row) * .9);
  if (distance > .5) return .45;
  return distance > .43 ? .2 : .55 + (1 - distance / .43) * .4;
};

/** Stem and neck along s: plain timber whose grain fades into knotwork repeating round the neck. */
const neck: Pattern = (s, t) => {
  const plain = grain(t, s * 3);
  if (s < DRAGON_NECK_START) return plain;
  const along = (s - DRAGON_NECK_START) / (1 - DRAGON_NECK_START), fade = Math.min(1, along / .12);
  return plain + (knot(along, (t * 2) % 1) * .5 + .45 - plain) * fade;
};

const REGIONS: readonly (readonly [AtlasRect, Pattern])[] = [[DRAGON_CARVING_ATLAS.neck, neck],
  [DRAGON_CARVING_ATLAS.scales, scales], [DRAGON_CARVING_ATLAS.grain, grain]];

const sample = (u: number, v: number) => {
  const region = REGIONS.find(([rect]) => u >= rect[0] && u < rect[2] && v >= rect[1] && v < rect[3]);
  if (!region) return .6;
  const [rect, pattern] = region;
  return pattern((u - rect[0]) / (rect[2] - rect[0]), (v - rect[1]) / (rect[3] - rect[1]));
};

const maps = new Map<boolean, ReturnType<typeof paintMaps>>();

/** Gives the dragon's vertex-painted wood its carved relief (High) and shading; maps are cached. */
export const dressDragonCarving = (material: MeshStandardMaterial, detailed: boolean) => {
  let carving = maps.get(detailed);
  if (!carving) { carving = paintMaps(detailed ? 512 : 128, sample, 0); maps.set(detailed, carving); }
  material.map = carving.albedo;
  material.bumpMap = detailed ? carving.height : null; material.bumpScale = 1.2;
  material.needsUpdate = true;
  return material;
};
