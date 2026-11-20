import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, type MeshStandardMaterial,
RGBAFormat, SRGBColorSpace} from "three";

import type { AtlasRect } from "../sculpt-geometry";
import { cachedPixelSet } from "./building-pixel-cache";

/**
 * Detail atlas of the bronze Thor: riveted chainmail, interlace knotwork (hammer, belt, helmet
 * band), fine strands (beard, hair, leather wrap) and a plain cast surface. Original procedural art.
 */
export const THOR_ATLAS = {
  knot: [.5, .5, 1, 1], mail: [0, 0, .5, 1], plain: [.75, 0, 1, .5], strands: [.5, 0, .75, .5]
} as const satisfies Record<string, AtlasRect>;

/** Height 0…1 of a pattern at local atlas coordinates (s, t in 0…1). */
export type Pattern = (s: number, t: number) => number;

export const hash = (x: number, y: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

/** Riveted rings in staggered rows, about square on the byrnie (96 round, 56 up). */
const mail: Pattern = (s, t) => {
  const row = t * 56, column = s * 96 + (Math.floor(row) % 2) * .5;
  const distance = Math.hypot(column - Math.floor(column) - .5, row - Math.floor(row) - .5);
  return Math.max(0, 1 - Math.abs(distance - .33) / .13);
};

/** Two families of diagonal bands weaving over and under each other, inside a beaded border. */
export const knot: Pattern = (s, t) => {
  if (Math.min(s, t, 1 - s, 1 - t) < .05) return .55 + .45 * Math.sin(s * 120) * Math.sin(t * 120);
  const turns = 5, a = Math.sin((s + t) * Math.PI * turns), b = Math.sin((s - t) * Math.PI * turns);
  const bandA = Math.max(0, 1 - Math.abs(a) / .38), bandB = Math.max(0, 1 - Math.abs(b) / .38);
  const over = (Math.floor((s + t) * turns) + Math.floor((s - t + 2) * turns)) % 2 === 0;
  const top = over ? bandA : bandB, under = over ? bandB : bandA;
  return Math.max(top > .15 ? .55 + .45 * top : 0, under > .15 && top < .05 ? .35 + .3 * under : 0);
};

const strands: Pattern = (s, t) => .5 + .5 * Math.sin(s * Math.PI * 2 * 36 + Math.sin(t * 9) * 2.2);
const plain: Pattern = (s, t) => .62 + (hash(Math.floor(s * 512), Math.floor(t * 512)) - .5) * .12;

const REGIONS: readonly (readonly [AtlasRect, Pattern])[] = [[THOR_ATLAS.mail, mail], [THOR_ATLAS.knot, knot],
  [THOR_ATLAS.strands, strands], [THOR_ATLAS.plain, plain]];

const regionAt = (u: number, v: number) => REGIONS.find(([rect]) => u >= rect[0] && u < rect[2] && v >= rect[1] &&
  v < rect[3]) ?? REGIONS[3]!;

export const dataTexture = (pixels: Uint8Array, size: number, colour: boolean) => {
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  if (colour) texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

const paintPixels = (size: number, sample: (u: number, v: number) => number, verdigris: number) => {
  const albedo = new Uint8Array(size * size * 4), height = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const value = sample((x + .5) / size, (y + .5) / size), index = (y * size + x) * 4;
    const shade = 150 + value * 105 + (hash(x, y) - .5) * 14, green = (1 - value) * verdigris;
    albedo.set([shade - green * .6, shade + green * .2, shade - green * .2, 255], index);
    height.set([value * 255, value * 255, value * 255, 255], index);
  }
  return [albedo, height];
};

/**
 * Albedo (recesses darkened with a little verdigris) and height maps drawn from one pattern sampler.
 * A `cacheKey` naming the sampler paints them once per size; every call still owns its textures.
 */
export const paintMaps = (size: number, sample: (u: number, v: number) => number, verdigris: number,
  cacheKey?: string) => {
  const paint = () => paintPixels(size, sample, verdigris);
  const [albedo, height] = cacheKey ? cachedPixelSet(`${cacheKey}:${size}:${verdigris}`, paint) : paint();
  return { albedo: dataTexture(albedo!, size, true), height: dataTexture(height!, size, false) };
};

const atlasSample = (u: number, v: number) => {
  const [rect, pattern] = regionAt(u, v);
  return pattern((u - rect[0]) / (rect[2] - rect[0]), (v - rect[1]) / (rect[3] - rect[1]));
};

/** Cast bronze with worn highlights, verdigris in the recesses and the atlas relief as a bump map. */
export const createThorBronze = (source: MeshStandardMaterial, detailed: boolean) => {
  const maps = paintMaps(detailed ? 1024 : 128, atlasSample, 40, "thor-bronze");
  const material = source.clone();
  material.color.setRGB(1, 1, 1);
  material.map = maps.albedo;
  material.bumpMap = detailed ? maps.height : null;
  material.bumpScale = 1.6;
  material.normalMap = null; material.roughnessMap = null;
  material.roughness = .46; material.metalness = .35;
  if (!detailed) maps.height.dispose();
  return material;
};

/** Younger-futhark-like staves and twigs (each a list of strokes in a 0…1 cell). */
export const RUNES: readonly (readonly (readonly [number, number, number, number])[])[] = [
  [[.5, .1, .5, .9], [.5, .9, .8, .68], [.5, .66, .8, .44]],
  [[.35, .1, .35, .9], [.35, .9, .7, .6], [.7, .6, .7, .1]],
  [[.5, .1, .5, .9], [.5, .75, .78, .6], [.78, .6, .5, .45]],
  [[.5, .1, .5, .9], [.5, .9, .78, .66], [.78, .66, .5, .48], [.5, .48, .78, .1]],
  [[.5, .1, .5, .9], [.5, .6, .78, .85]],
  [[.5, .1, .5, .9], [.25, .75, .75, .35], [.75, .75, .25, .35]],
  [[.5, .1, .5, .9], [.3, .62, .7, .42]],
  [[.5, .1, .5, .9], [.5, .9, .25, .65], [.5, .9, .75, .65]],
  [[.4, .1, .4, .9], [.4, .9, .7, .7], [.7, .7, .4, .5], [.4, .5, .7, .3], [.7, .3, .4, .1]],
  [[.5, .1, .5, .9], [.5, .6, .25, .85], [.5, .6, .75, .85]],
  [[.5, .1, .5, .9], [.5, .9, .78, .65]]
];

export const segmentDistance = (s: number, t: number, [x0, y0, x1, y1]: readonly [number, number, number, number]) => {
  const dx = x1 - x0, dy = y1 - y0, length = dx * dx + dy * dy;
  const k = Math.max(0, Math.min(1, ((s - x0) * dx + (t - y0) * dy) / length));
  return Math.hypot(s - x0 - dx * k, t - y0 - dy * k);
};

/** The plinth's plain band (caps and top) and its carved side faces, in plinth UV space. */
export const RUNE_PLINTH_ATLAS = { face: [0, .15, 1, 1], plain: [0, 0, 1, .15] } as const satisfies Record<string, AtlasRect>;
const GLYPHS_PER_FACE = 7;

/** Side face: framed panel, a knotwork frieze under the cap and a carved rune row. */
const runeFace: Pattern = (s, t) => {
  const edge = Math.min(s, 1 - s, t, 1 - t);
  if (edge < .05) return .85;
  if (edge < .075) return .1;
  if (t > .74 && t < .92) return knot((s - .075) / .85, (t - .74) / .18) * .7 + .15;
  if (t < .3 || t > .7 || s < .1 || s >= .9) return .8;
  const position = (s - .1) / .8 * GLYPHS_PER_FACE, cell = Math.floor(position);
  const local = position - cell, row = (t - .3) / .4;
  const glyph = RUNES[(cell * 5 + 3) % RUNES.length]!;
  const distance = Math.min(...glyph.map(stroke => segmentDistance(local, row, stroke)));
  return distance < .07 ? .12 + distance * 4 : .8;
};

const runeStoneSample = (u: number, v: number) => {
  const grit = (hash(Math.floor(u * 300), Math.floor(v * 300)) - .5) * .12;
  if (v < RUNE_PLINTH_ATLAS.face[1]) return .78 + grit;
  return runeFace(u, (v - RUNE_PLINTH_ATLAS.face[1]) / (1 - RUNE_PLINTH_ATLAS.face[1])) + grit;
};

/** Dark weathered field stone with a carved rune row and knotwork frieze (albedo and bump). */
export const createRunePlinthStone = (source: MeshStandardMaterial, detailed: boolean) => {
  const maps = paintMaps(detailed ? 512 : 128, runeStoneSample, 0, "rune-stone");
  const material = source.clone();
  material.color.setRGB(.17, .165, .155);
  material.map = maps.albedo;
  material.bumpMap = detailed ? maps.height : null;
  material.bumpScale = 2;
  material.normalMap = null; material.roughnessMap = null;
  material.roughness = .9; material.metalness = 0;
  if (!detailed) maps.height.dispose();
  return material;
};
