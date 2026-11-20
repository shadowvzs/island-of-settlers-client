import { DoubleSide, type MeshStandardMaterial } from "three";

import { clamp01, lerp3, sinHash2 } from "../../../shared/world/noise";
import type { AtlasRect } from "../sculpt-geometry";
import { dataTexture } from "./viking-statue-textures";

/**
 * Detail atlas of the Viking wall helmets (original procedural art): hammered iron plate with worn
 * rust, a riveted strip (brow band, spangen, nasal, side mounts, leather straps) and a feather vane
 * (rachis along v, barbs sweeping to both edges). Vertex colours tint each region.
 */
const REGION_RECTS = {
  feather: [.5, 0, 1, 1], iron: [0, .5, .5, 1], rivets: [0, 0, .5, .5]
} as const satisfies Record<string, AtlasRect>;

/** Kept clear round each region, so mipmaps never bleed a neighbour (dark iron) into a feather edge. */
const GUTTER = .03;
const inset = ([u0, v0, u1, v1]: AtlasRect): AtlasRect => [u0 + GUTTER, v0 + GUTTER, u1 - GUTTER, v1 - GUTTER];

/** The rectangles the sculpts map into (each region minus its gutter). */
export const VIKING_HELMET_ATLAS = {
  feather: inset(REGION_RECTS.feather), iron: inset(REGION_RECTS.iron), rivets: inset(REGION_RECTS.rivets)
} as const satisfies Record<string, AtlasRect>;

type Rgb = readonly [number, number, number];
/** Albedo colour (0…1) and relief height (0…1) at local region coordinates. */
interface Texel { color: Rgb; height: number }
type Region = (s: number, t: number) => Texel;

const IRON: Rgb = [.86, .87, .88];
const RUST: Rgb = [.62, .36, .2];
const DENTS = 9;

/** Distance to the nearest jittered hammer-blow centre (cells of a DENTS × DENTS grid). */
const nearestDent = (s: number, t: number) => {
  const x = s * DENTS, y = t * DENTS, cellX = Math.floor(x), cellY = Math.floor(y);
  let nearest = 1;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = cellX + dx, cy = cellY + dy;
    const px = cx + .2 + sinHash2(cx, cy) * .6, py = cy + .2 + sinHash2(cy + 7, cx) * .6;
    nearest = Math.min(nearest, Math.hypot(x - px, y - py));
  }
  return nearest;
};

/** Low-frequency patina: rust gathers in streaks and blotches, the rest is worn bright. */
const patina = (s: number, t: number) => {
  const wave = Math.sin(s * 15 + Math.sin(t * 8.3) * 2) * Math.sin(t * 13.1 + s * 5.2) +
    Math.sin(s * 37 + t * 29) * .35;
  return Math.max(0, Math.min(1, (wave - .55) * 1.8));
};

/** Hammered iron: shallow dish-shaped dents, fine grit and rust patches. */
const iron: Region = (s, t) => {
  const dent = Math.min(1, nearestDent(s, t) / .62), grit = (sinHash2(Math.floor(s * 256), Math.floor(t * 256)) - .5) * .1;
  const shade = .78 + dent * .2 + grit, rust = patina(s, t) * .5;
  return { color: lerp3([IRON[0] * shade, IRON[1] * shade, IRON[2] * shade], RUST, rust), height: dent * .8 + grit };
};

const RIVETS_ALONG = 8;

/** A metal strip with raised rivet heads in one row, darkened at its edges. */
const rivets: Region = (s, t) => {
  const along = s * RIVETS_ALONG, local = along - Math.floor(along);
  const head = Math.max(0, 1 - Math.hypot(local - .5, (t - .5) * 2.2) / .32);
  const edge = Math.min(t, 1 - t) < .08 ? .7 : 1, grit = (sinHash2(Math.floor(s * 200), Math.floor(t * 60)) - .5) * .08;
  const shade = (.82 + head * .22 + grit) * edge;
  return { color: lerp3([shade, shade, shade], RUST, patina(s * .4, t * .4) * .3), height: .3 + head * .7 };
};

const BARBS = 46;

/** Feather vane: a pale rachis at u = .5, barbs sweeping to the tip, small splits between barb groups. */
const feather: Region = (s, t) => {
  const across = Math.abs(s - .5) * 2;
  if (across < .05) return { color: [1, .98, .94], height: 1 };
  const barb = .5 + .5 * Math.sin((t * 1.2 - across * .45) * BARBS * Math.PI);
  // A few barb groups part at the outer vane: a thin dark line along the barbs, not a whole band.
  const group = (t * 1.2 - across * .45) * 9, parted = sinHash2(Math.floor(group), s > .5 ? 1 : 2) > .7;
  const split = parted && across > .5 && group - Math.floor(group) < .07 ? .72 : 1;
  const shade = (.72 + barb * .22) * split * (1 - across * across * .18);
  return { color: [shade, shade * .99, shade * .96], height: barb * .6 * split };
};

const REGIONS: readonly (readonly [AtlasRect, AtlasRect, Region])[] = [
  [REGION_RECTS.iron, VIKING_HELMET_ATLAS.iron, iron], [REGION_RECTS.rivets, VIKING_HELMET_ATLAS.rivets, rivets],
  [REGION_RECTS.feather, VIKING_HELMET_ATLAS.feather, feather]];

/** The gutter repeats the region's edge texels. */
const sampleAtlas = (u: number, v: number) => {
  const [, rect, region] = REGIONS.find(([area]) => u >= area[0] && u < area[2] && v >= area[1] && v < area[3]) ??
    REGIONS[0]!;
  return region(clamp01((u - rect[0]) / (rect[2] - rect[0])), clamp01((v - rect[1]) / (rect[3] - rect[1])));
};

const paint = (size: number) => {
  const albedo = new Uint8Array(size * size * 4), height = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const texel = sampleAtlas((x + .5) / size, (y + .5) / size), index = (y * size + x) * 4;
    albedo.set([...texel.color.map(value => Math.round(Math.max(0, Math.min(1, value)) * 255)), 255], index);
    const relief = Math.round(Math.max(0, Math.min(1, texel.height)) * 255);
    height.set([relief, relief, relief, 255], index);
  }
  return { albedo: dataTexture(albedo, size, true), height: dataTexture(height, size, false) };
};

/** Painted once per detail level: every helmet and wing material shares these (re-uploaded after a dispose). */
const atlases = new Map<boolean, ReturnType<typeof paint>>();
const atlasFor = (detailed: boolean) => {
  let atlas = atlases.get(detailed);
  if (!atlas) { atlas = paint(detailed ? 512 : 128); atlases.set(detailed, atlas); }
  return atlas;
};

const atlasMaterial = (source: MeshStandardMaterial, detailed: boolean, finish: { metalness: number;
  roughness: number; bumpScale: number }) => {
  const atlas = atlasFor(detailed), material = source.clone();
  material.color.setRGB(1, 1, 1);
  material.map = atlas.albedo;
  material.bumpMap = detailed ? atlas.height : null;
  material.bumpScale = finish.bumpScale;
  material.normalMap = null; material.roughnessMap = null;
  material.metalness = finish.metalness; material.roughness = finish.roughness;
  return material;
};

/** Hammered, rust-worn iron with bronze and leather fittings (tinted by vertex colour). */
export const createVikingHelmetIron = (source: MeshStandardMaterial, detailed: boolean) =>
  atlasMaterial(source, detailed, { bumpScale: 1.2, metalness: .55, roughness: .5 });

/** Matt feathers with the vane texture and a soft barb relief. */
export const createVikingFeathers = (source: MeshStandardMaterial, detailed: boolean) => {
  const material = atlasMaterial(source, detailed, { bumpScale: .6, metalness: 0, roughness: .86 });
  // Each feather is a single curved vane, seen from both faces.
  material.side = DoubleSide;
  return material;
};
