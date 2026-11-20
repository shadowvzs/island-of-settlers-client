import { fillBase, range, type RecipeContext, scatter,
  scatterStones, unit } from "../../../src/render-common/materials/recipe-helpers";
import { hashTexel } from "../../../src/render-common/materials/tile-canvas";
import { smoothstep } from "../../../src/shared/world/noise";
import { setTone, stampRibbedStroke, toneRamp } from "./micro-canvas";

/** Worley cells per tile for the isolated pores (≈ 3 cm apart); only some cells hold a pit. */
const PORE_PERIOD = 40;
const PORE_SHARE = 0.28;

/** Continuous silt matrix with soft relief and isolated dark pores (no polygon network). */
const paintMatrix = (context: RecipeContext) => {
  const { noise } = context;
  fillBase(context, (u, v, x, y, paint) => {
    const relief = unit(noise.fbm(u, v, 24, 3));
    const fine = noise.fbm(u, v, 96, 2);
    const pore = noise.worley(u, v, PORE_PERIOD);
    const pit = pore.nearestId < PORE_SHARE ? 1 - smoothstep(0.08, 0.26, pore.nearest) : 0;
    const speck = hashTexel(x, y, 11) - 0.5;
    setTone(paint, 0.88 + relief * 0.12 + fine * 0.05 - pit * 0.2 + speck * 0.1);
    paint.roughness = 0.95;
    return 0.14 + relief * 0.1 + fine * 0.03 - pit * 0.1 + speck * 0.012;
  });
};

/** Twig and root bits: thin, mostly dark, a few pale dry ones. */
const paintTwigs = (context: RecipeContext) => {
  const { canvas, paint, random } = context;
  scatter(context, 34, (x, y) => {
    setTone(paint, random() < 0.85 ? range(random, 0.62, 0.8) : range(random, 1.1, 1.25));
    const height = range(random, 0.42, 0.52);
    stampRibbedStroke(canvas, {
      angle: random() * Math.PI * 2, baseHeight: height, bend: range(random, -1, 1),
      length: range(random, 8, 24), taper: 0.5, tipHeight: height - 0.04, wiggle: 0.18,
      wiggleFrequency: 1.6, width: range(random, 1, 1.7), x, y
    }, paint, 0.08, t => 1 - 0.1 * t);
  });
};

/**
 * Class 1 (dirt, mine): silt matrix with pores, irregular crumb aggregates (2–20 mm), mineral
 * granules and twig bits. Every element is small and evenly spread, so 0.75-unit repeats stay
 * invisible and no regular lattice forms.
 */
export const paintSoilMicro = (context: RecipeContext) => {
  paintMatrix(context);
  const crumbs = { angularity: 0.2, flatTop: 0.6, palette: toneRamp(0.86, 0.98, 1.08, 1.18), surface: 0.22 };
  scatterStones(context, { ...crumbs, buried: 0.45, count: 1700, maxRadius: 2.2, minRadius: 0.7 }, 71);
  scatterStones(context, { ...crumbs, buried: 0.5, count: 160, maxRadius: 4.4, minRadius: 2.2 }, 73);
  scatterStones(context, { angularity: 0.55, buried: 0.4, count: 700, flatTop: 0.8, maxRadius: 1.2,
    minRadius: 0.5, palette: toneRamp(0.66, 0.9, 1.2, 1.34), surface: 0.24 }, 79);
  paintTwigs(context);
};
