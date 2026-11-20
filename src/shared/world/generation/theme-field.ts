import type { NationTerrainAffinity } from "@shared/catalog";

import { getVertexCount, type GridSize } from "../grid-geometry";
import { clamp } from "../noise";
import {
  applyForestAmount,
  blendThemes,
  ISLAND_THEMES,
  type IslandTheme,
  THEME_COUNT,
  type ThemeParameters
} from "./island-themes";
import { applyNationTerrainAffinity } from "./nation-terrain-bias";
import { labelLandmasses } from "./plateaus";
import { createBandLayout } from "./theme-bands";

/**
 * Theme weight field: THEME_COUNT bytes per vertex (ISLAND_THEMES order), summing to 255. Each
 * area of the map has its own theme mix; borders between themes are blended weights.
 */
export type ThemeWeights = Uint8Array;

/** What a layout strategy may read; extend it (landmass labels, moisture) as strategies need. */
interface ThemeLayoutContext {
  grid: GridSize;
  /** Terrain heights after erosion (sea below 0): landmasses and altitude bands. */
  heights: Float32Array;
  seed?: number;
}

/**
 * Pluggable theme layout step: one theme everywhere (createUniformLayout) or one per landmass
 * (createLandmassLayout), altitude / latitude bands, or seeded natural regions with blended
 * borders. Every strategy fills weights consumed by the same terrain and vegetation rules.
 */
export type ThemeLayout = (context: ThemeLayoutContext) => ThemeWeights;

/** Theme layout strategies of the world options (?themeLayout=, World form). */
const THEME_LAYOUTS = ["uniform", "landmass", "altitude", "latitude", "regions"] as const;

export type ThemeLayoutKind = (typeof THEME_LAYOUTS)[number];

export const isThemeLayoutKind = (value: unknown): value is ThemeLayoutKind =>
  THEME_LAYOUTS.some((kind) => kind === value);

const FULL_WEIGHT = 255;

/** Full weight for one theme per vertex (`themeOf` gives the theme of a vertex). */
const fillWeights = (grid: GridSize, themeOf: (vertex: number) => IslandTheme) => {
  const count = getVertexCount(grid);
  const weights = new Uint8Array(count * THEME_COUNT);
  for (let vertex = 0; vertex < count; vertex += 1) {
    weights[vertex * THEME_COUNT + ISLAND_THEMES.indexOf(themeOf(vertex))] = FULL_WEIGHT;
  }
  return weights;
};

/** The selected theme on every vertex (?theme= and the World form). */
export const createUniformLayout =
  (theme: IslandTheme): ThemeLayout =>
  ({ grid }) =>
    fillWeights(grid, () => theme);

/** Landmass label of every vertex: its own on land, the nearest one's in the sea (breadth first). */
const spreadLabelsToSea = (grid: GridSize, labels: Int32Array) => {
  const stride = grid.cellsX + 1;
  const nearest = Int32Array.from(labels);
  const queue = new Int32Array(labels.length);
  let tail = 0;
  for (let vertex = 0; vertex < labels.length; vertex += 1) {
    if (labels[vertex]! >= 0) queue[tail++] = vertex;
  }
  for (let head = 0; head < tail; head += 1) {
    const vertex = queue[head]!;
    const x = vertex % stride;
    const neighbours = [
      x > 0 ? vertex - 1 : -1,
      x < grid.cellsX ? vertex + 1 : -1,
      vertex - stride,
      vertex + stride
    ];
    for (const neighbour of neighbours) {
      if (neighbour < 0 || neighbour >= labels.length || nearest[neighbour]! >= 0) continue;
      nearest[neighbour] = nearest[vertex]!;
      queue[tail++] = neighbour;
    }
  }
  return nearest;
};

/** Vertices a landmass needs for its own theme (smaller islets keep the main theme). */
const MIN_THEMED_LANDMASS = 150;

/**
 * Each landmass its own theme (an archipelago of different islands): the largest keeps `main`,
 * the others take `others` in turn, biggest first; the sea takes the theme of the nearest land.
 * A single island or a peninsula stays one theme.
 */
const createLandmassLayout =
  (main: IslandTheme, others: readonly IslandTheme[]): ThemeLayout =>
  ({ grid, heights }) => {
    const { labels, landmasses } = labelLandmasses(grid, heights);
    const themes = new Map<number, IslandTheme>();
    const islands = landmasses.filter(({ size }) => size >= MIN_THEMED_LANDMASS);
    islands.forEach(({ label }, rank) => {
      const other = others[(rank - 1) % Math.max(1, others.length)];
      themes.set(label, rank === 0 || !other ? main : other);
    });
    const nearest = spreadLabelsToSea(grid, labels);
    return fillWeights(grid, (vertex) => themes.get(nearest[vertex]!) ?? main);
  };

/** The layout of a world's options: the selected theme everywhere, or it on the main land. */
export const createThemeLayout = (theme: IslandTheme, kind: ThemeLayoutKind): ThemeLayout => {
  if (kind === "uniform") return createUniformLayout(theme);
  if (kind !== "landmass") return createBandLayout(theme, kind);
  return createLandmassLayout(
    theme,
    ISLAND_THEMES.filter((other) => other !== theme)
  );
};

/** Blend steps of the cache key: borders are smooth enough, the cache stays small. */
const KEY_LEVELS = 32;

/** The same weights on every vertex: the theme of the whole map (fast path). */
const findUniformWeights = (weights: ThemeWeights) => {
  for (let index = THEME_COUNT; index < weights.length; index += 1) {
    if (weights[index] !== weights[index % THEME_COUNT]) return null;
  }
  return Array.from(weights.subarray(0, THEME_COUNT));
};

/**
 * Local theme parameters from the weight field, blended from the theme table; the world's
 * forest amount and an optional homeland affinity are applied on top. Mixes are cached by quantised weights.
 */
export const createThemeSampler = (grid: GridSize, weights: ThemeWeights, forestAmount = 1, mutable = false,
  affinity?: NationTerrainAffinity) => {
  const cache = new Map<number, ThemeParameters>();
  const levels = new Array<number>(THEME_COUNT).fill(0);
  const blend = (mix: ArrayLike<number>) =>
    applyNationTerrainAffinity(applyForestAmount(blendThemes(mix), forestAmount), affinity);
  // Foresters/editor planting retain a sampler across painting and undo; their field is live.
  const uniform = mutable ? null : findUniformWeights(weights);
  const uniformTheme = uniform ? blend(uniform) : null;
  const lookUp = () => {
    let key = 0;
    for (let theme = 0; theme < THEME_COUNT; theme += 1)
      key = key * (KEY_LEVELS + 1) + levels[theme]!;
    const known = cache.get(key);
    if (known) return known;
    const mixed = blend(levels);
    cache.set(key, mixed);
    return mixed;
  };
  const stride = grid.cellsX + 1;
  /** Theme at a vertex index. */
  const atVertex = (vertex: number) => {
    if (uniformTheme) return uniformTheme;
    for (let theme = 0; theme < THEME_COUNT; theme += 1) {
      levels[theme] = Math.round(
        (weights[vertex * THEME_COUNT + theme]! / FULL_WEIGHT) * KEY_LEVELS
      );
    }
    return lookUp();
  };
  /** Theme at a world position (bilinear weights). */
  const at = (x: number, z: number) => {
    if (uniformTheme) return uniformTheme;
    const cx = clamp(x, 0, grid.cellsX - 1e-4);
    const cz = clamp(z, 0, grid.cellsZ - 1e-4);
    const x0 = Math.floor(cx);
    const z0 = Math.floor(cz);
    const fx = cx - x0;
    const fz = cz - z0;
    const corners: [number, number][] = [
      [z0 * stride + x0, (1 - fx) * (1 - fz)],
      [z0 * stride + x0 + 1, fx * (1 - fz)],
      [(z0 + 1) * stride + x0, (1 - fx) * fz],
      [(z0 + 1) * stride + x0 + 1, fx * fz]
    ];
    for (let theme = 0; theme < THEME_COUNT; theme += 1) {
      let weight = 0;
      for (const [vertex, share] of corners)
        weight += weights[vertex * THEME_COUNT + theme]! * share;
      levels[theme] = Math.round((weight / FULL_WEIGHT) * KEY_LEVELS);
    }
    return lookUp();
  };
  return { at, atVertex };
};

export type ThemeSampler = ReturnType<typeof createThemeSampler>;
