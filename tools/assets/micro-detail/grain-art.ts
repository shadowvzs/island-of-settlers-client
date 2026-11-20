import { fillBase, type RecipeContext, scatterStones,
  unit } from "../../../src/render-common/materials/recipe-helpers";
import { hashTexel } from "../../../src/render-common/materials/tile-canvas";
import { setTone, toneRamp } from "./micro-canvas";

/** Sub-texel sand grains as speckle: light quartz, mid feldspar, a few dark mineral grains. */
const paintGrainBed = (context: RecipeContext) => {
  const { noise } = context;
  fillBase(context, (u, v, x, y, paint) => {
    const grain = hashTexel(x, y, 23);
    const mineral = hashTexel(x, y, 29);
    const relief = unit(noise.fbm(u, v, 64, 2));
    const dark = mineral < 0.05 ? 0.25 : 0;
    const light = mineral > 0.93 ? 0.16 : 0;
    setTone(paint, 0.9 + (grain - 0.5) * 0.24 + relief * 0.1 - dark + light);
    paint.roughness = 0.85;
    return 0.18 + relief * 0.1 + grain * 0.05;
  });
};

/**
 * Class 2 (sand, gravel): a speckled grain bed with dense coarse grains (3–7 mm) and evenly spread
 * fine gravel (1–3 cm). Rounded and angular grains mix, so both sand and gravel read correctly.
 */
export const paintGrainMicro = (context: RecipeContext) => {
  paintGrainBed(context);
  scatterStones(context, { angularity: 0.3, buried: 0.35, count: 2600, flatTop: 0.85, maxRadius: 1.5,
    minRadius: 0.6, palette: toneRamp(0.62, 0.9, 1.04, 1.18, 1.32), surface: 0.26 }, 81);
  scatterStones(context, { angularity: 0.6, buried: 0.5, count: 230, flatTop: 0.75, maxRadius: 3.8,
    minRadius: 1.6, palette: toneRamp(0.68, 0.88, 1.02, 1.16, 1.3), surface: 0.28 }, 83);
  scatterStones(context, { angularity: 0.55, buried: 0.55, count: 26, flatTop: 0.7, maxRadius: 5.6,
    minRadius: 3.8, palette: toneRamp(0.74, 0.95, 1.12, 1.26), surface: 0.3 }, 87);
};
