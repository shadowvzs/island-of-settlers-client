import { getVertexCount } from "../grid-geometry";
import { clamp, createFbm, smoothstep } from "../noise";
import { deriveSeed } from "../rng";
import { ISLAND_THEMES, type IslandTheme,THEME_COUNT } from "./island-themes";
import type { ThemeLayout, ThemeLayoutKind } from "./theme-field";

/** Adjacent bands share two weights; broad interiors stay pure and weights always sum to 255. */
const writeBand = (
  weights: Uint8Array,
  vertex: number,
  themes: readonly IslandTheme[],
  value: number
) => {
  const position = clamp(value, 0, 1) * (themes.length - 1);
  const band = Math.min(themes.length - 2, Math.floor(position));
  const blend = Math.round(smoothstep(0.25, 0.75, position - band) * 255);
  const offset = vertex * THEME_COUNT;
  weights[offset + ISLAND_THEMES.indexOf(themes[band]!)]! += 255 - blend;
  weights[offset + ISLAND_THEMES.indexOf(themes[band + 1]!)]! += blend;
};

/** Generation-only layouts: the existing theme sampler controls ground, vegetation and wildlife. */
export const createBandLayout =
  (main: IslandTheme, kind: ThemeLayoutKind): ThemeLayout =>
  ({ grid, heights, seed = 0 }) => {
    const weights = new Uint8Array(getVertexCount(grid) * THEME_COUNT);
    let peak = 1;
    if (kind === "altitude") for (const height of heights) peak = Math.max(peak, height);
    let themes: readonly IslandTheme[] = ["snowy", main, "desert"];
    if (kind === "altitude") themes = [main, main === "snowy" ? "snowy" : "dirt", "snowy"];
    if (kind === "regions") themes = [main, ...ISLAND_THEMES.filter((theme) => theme !== main)];
    const noise = createFbm(deriveSeed(seed, "theme-regions"), { octaves: 2 });
    const stride = grid.cellsX + 1;
    for (let vertex = 0; vertex < getVertexCount(grid); vertex++) {
      const x = vertex % stride,
        z = Math.floor(vertex / stride);
      let value = z / Math.max(1, grid.cellsZ);
      if (kind === "altitude") value = Math.max(0, heights[vertex]!) / peak;
      if (kind === "regions")
        value = 0.5 + noise((x / grid.cellsX) * 4, (z / grid.cellsZ) * 4) * 0.85;
      writeBand(weights, vertex, themes, value);
    }
    return weights;
  };
