import { smoothstep } from "../../shared/world/noise";
import { rgb } from "../color";
import {
  addGrain,
  fillBase,
  type MaterialRecipe,
  scatterStones,
  type StoneScatter,
  unit} from "./recipe-helpers";
import { blendPaint, setPaint } from "./tile-canvas";

/** Pale, cool grey mine gravel (art direction A of docs/archive/dated/mine-area-brainstorm.md). */
const MINE = {
  base: rgb(0xb4ada1),
  chips: [
    rgb(0x8e8a82),
    rgb(0xcfc9bd),
    rgb(0xa39d92),
    rgb(0x9a9488),
    rgb(0xa89c8a),
    rgb(0xbcb6aa),
    rgb(0x77736c)
  ],
  damp: rgb(0x6f6a62),
  grainDark: rgb(0x847e74),
  grainLight: rgb(0xdcd7cc),
  light: rgb(0xcfc9bd),
  slabs: [rgb(0xcfc9bd), rgb(0xc2bcb0), rgb(0xaaa498)]
} as const;

const CHIPS: Omit<StoneScatter, "count" | "maxRadius" | "minRadius"> = {
  angularity: 0.9,
  buried: 0.35,
  flatTop: 0.6,
  palette: MINE.chips,
  surface: 0.2
};

/** Faint parallel drag marks (sledges, carts) along one direction, broken by noise. */
const getDragMark = (u: number, v: number, breakup: number) => {
  const line = Math.abs(Math.sin((u * 3 + v * 17 + breakup * 0.6) * Math.PI * 2));
  return smoothstep(0.06, 0.0, line) * smoothstep(0.1, 0.45, breakup);
};

/**
 * Mine gravel: pale sandy grit with fine grain, cooler damp seams, angular chips at two sizes,
 * a few pale half-buried slabs and faint drag marks; dry and rough.
 */
export const mineGravel: MaterialRecipe = (context) => {
  const { noise } = context;
  fillBase(context, (u, v, x, y, paint) => {
    const tone = unit(noise.fbm(u, v, 3, 3));
    const damp = smoothstep(0.15, 0.45, noise.fbm(u + 0.41, v + 0.17, 4, 3));
    const drag = getDragMark(u, v, unit(noise.fbm(u + 0.7, v, 6, 2)));
    setPaint(paint, MINE.base, MINE.light, tone * 0.7);
    blendPaint(paint, MINE.damp, MINE.damp, 0, damp * 0.4);
    blendPaint(paint, MINE.grainDark, MINE.grainDark, 0, drag * 0.25);
    const grain = addGrain(paint, x, y, MINE.grainDark, MINE.grainLight, 0.12);
    paint.roughness = 0.9 - damp * 0.06;
    const fine = unit(noise.fbm(u, v, 48, 2)) * 0.05;
    return 0.12 + tone * 0.05 + fine + grain * 0.02 - drag * 0.03;
  });
  scatterStones(context, { ...CHIPS, count: 3000, maxRadius: 3, minRadius: 1 }, 81);
  scatterStones(context, { ...CHIPS, count: 380, maxRadius: 7, minRadius: 3 }, 83);
  scatterStones(
    context,
    {
      ...CHIPS,
      buried: 0.55,
      count: 9,
      flatTop: 0.9,
      maxRadius: 22,
      minRadius: 12,
      palette: MINE.slabs
    },
    87
  );
};
