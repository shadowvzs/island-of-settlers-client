import { type IUniform, Matrix4, Vector3 } from "three";

import {
  createGroundPaletteMatrices,
  fillGroundPaletteMatrices,
  type GroundPaletteContext,
  getRockPropTint,
  resolveThemePalettes
} from "../../render-common/ground-palette";
import { THEME_COUNT } from "../../shared/world/generation/island-themes";
import type { GroundPalette } from "../../shared/world/ground-palette";
import type { WorldData } from "../../shared/world/world-data";

type PaletteUniforms = Record<"uClimatePalette" | "uRockPalette" | "uSandPalette" | "uSoilPalette", IUniform<Matrix4>>
  & { uRockPropTint: IUniform<Vector3> };
type PaletteWorld = Pick<WorldData, "groundPalette"> & Partial<Pick<WorldData, "themeWeights">>;

const scratch = createGroundPaletteMatrices();
const themeShares = new WeakMap<object, number[]>();

/** The island's share of each theme slot (mean of the vertex theme weights), cached per weight field. */
const getThemeShares = (world: PaletteWorld) => {
  const weights = world.themeWeights;
  if (!weights?.length) return [1, 0, 0, 0];
  const cached = themeShares.get(weights);
  if (cached) return cached;
  const sums = new Array<number>(THEME_COUNT).fill(0);
  for (let index = 0; index < weights.length; index += 1) sums[index % THEME_COUNT]! += weights[index]!;
  const total = sums.reduce((sum, value) => sum + value, 0) || 1;
  const shares = sums.map(value => value / total);
  themeShares.set(weights, shares);
  return shares;
};

const fillUniforms = (uniforms: PaletteUniforms, world: PaletteWorld, context: GroundPaletteContext) => {
  const palettes = resolveThemePalettes(world.groundPalette, context);
  fillGroundPaletteMatrices(palettes, scratch);
  uniforms.uSandPalette.value.fromArray(scratch.sand);
  uniforms.uSoilPalette.value.fromArray(scratch.soil);
  uniforms.uRockPalette.value.fromArray(scratch.rock);
  uniforms.uClimatePalette.value.fromArray(scratch.climate);
  uniforms.uRockPropTint.value.fromArray(getRockPropTint(palettes, getThemeShares(world)));
};

/** The ground palette uniforms (GROUND-PALETTE), filled with the island's automatic or chosen palette. */
export const createGroundPaletteUniforms = (world: PaletteWorld, context: GroundPaletteContext): PaletteUniforms => {
  const uniforms = {
    uClimatePalette: { value: new Matrix4() },
    uRockPalette: { value: new Matrix4() },
    /** Rock props and the mountain skin (no theme weights): the island's rock palette by its theme shares. */
    uRockPropTint: { value: new Vector3(1, 1, 1) },
    uSandPalette: { value: new Matrix4() },
    uSoilPalette: { value: new Matrix4() }
  };
  fillUniforms(uniforms, world, context);
  return uniforms;
};

const samePalette = (a: GroundPalette | undefined, b: GroundPalette) =>
  a?.rock === b.rock && a?.sand === b.sand && a?.soil === b.soil;

/**
 * Per-frame check of the island's palette choice (the map editor changes it, undo restores it): three
 * field comparisons (no allocation), and a refill of the matrices only when the choice changed.
 */
export const createGroundPaletteSync = (uniforms: PaletteUniforms, world: WorldData,
  context: GroundPaletteContext) => {
  const seen: GroundPalette = { ...world.groundPalette };
  return () => {
    const palette = world.groundPalette;
    if (samePalette(palette, seen)) return;
    seen.rock = palette?.rock;
    seen.sand = palette?.sand;
    seen.soil = palette?.soil;
    fillUniforms(uniforms, world, context);
  };
};
