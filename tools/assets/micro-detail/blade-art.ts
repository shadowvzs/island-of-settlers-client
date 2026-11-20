import { fillBase, range, type RecipeContext, scatter, scatterGrid,
  unit } from "../../../src/render-common/materials/recipe-helpers";
import { hashTexel } from "../../../src/render-common/materials/tile-canvas";
import { setTone, stampRibbedStroke } from "./micro-canvas";

/** Texels per tiller (≈ 4 cm at 4.7 mm per texel): an even, dense sward without bare patches. */
const TILLER_SPACING = 8.5;
const BLADE_RIB = 0.16;

/** Shaded thatch and soil between the tillers: the darkest, lowest layer. */
const paintThatch = (context: RecipeContext) => {
  const { noise } = context;
  fillBase(context, (u, v, x, y, paint) => {
    const litter = unit(noise.fbm(u, v, 32, 2));
    const fibre = unit(noise.gradient(u * 3 + v, v * 0.5, 96));
    setTone(paint, 0.5 + litter * 0.12 + fibre * 0.05 + (hashTexel(x, y, 7) - 0.5) * 0.06);
    paint.roughness = 0.95;
    return 0.02 + litter * 0.07 + fibre * 0.02;
  });
};

/** Dead leaf bits lying flat in the thatch: paler, thin and low. */
const paintDeadBlades = (context: RecipeContext) => {
  const { canvas, paint, random } = context;
  scatter(context, 260, (x, y) => {
    setTone(paint, range(random, 0.72, 0.95));
    const height = range(random, 0.1, 0.18);
    stampRibbedStroke(canvas, {
      angle: random() * Math.PI * 2, baseHeight: height, bend: range(random, -0.6, 0.6),
      length: range(random, 7, 16), taper: 0.6, tipHeight: height + 0.02, wiggle: 0.1,
      wiggleFrequency: 1, width: range(random, 1.2, 1.9), x, y
    }, paint, 0.05, () => 1);
  });
};

/** One tiller: 3–6 leaves fanning out from a base in a common lean direction. */
const paintTiller = (context: RecipeContext, x: number, y: number) => {
  const { canvas, paint, random } = context;
  const blades = 3 + Math.floor(random() * 4);
  const lean = random() * Math.PI * 2;
  const vigour = range(random, 0.85, 1.15);
  for (let blade = 0; blade < blades; blade += 1) {
    const baseHeight = range(random, 0.16, 0.3);
    const tipHeight = Math.min(1, range(random, 0.55, 0.95) * vigour);
    const tone = range(random, 0.95, 1.28);
    setTone(paint, tone);
    paint.roughness = 0.75;
    stampRibbedStroke(canvas, {
      angle: lean + range(random, -0.85, 0.85),
      baseHeight,
      bend: range(random, -0.7, 0.7),
      length: range(random, 9, 22) * vigour,
      taper: 0.9,
      tipHeight,
      wiggle: 0.06,
      wiggleFrequency: 1.2,
      width: range(random, 1.5, 3.1),
      x: x + range(random, -1.2, 1.2),
      y: y + range(random, -1.2, 1.2)
    }, paint, BLADE_RIB, t => 0.8 + 0.28 * Math.sqrt(t));
  }
};

/**
 * Class 0 (grass, lush grass, forest floor): a close sward of tapering leaf blades 0.7–1.5 cm
 * wide with a ridged mid-rib, over dark thatch. Tillers sit on a jittered grid, so the cover has
 * no clumps or bare patches that would repeat visibly every 0.75 units.
 */
export const paintBladeMicro = (context: RecipeContext) => {
  paintThatch(context);
  paintDeadBlades(context);
  scatterGrid(context, TILLER_SPACING, (x, y) => paintTiller(context, x, y));
};
