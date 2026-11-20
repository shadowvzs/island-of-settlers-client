import { fillBase, range, type RecipeContext, scatter } from "../../../src/render-common/materials/recipe-helpers";
import { hashTexel, stampDisc } from "../../../src/render-common/materials/tile-canvas";
import { smoothstep } from "../../../src/shared/world/noise";
import { setTone } from "./micro-canvas";

/** Worley cells per tile: crust plates of ≈ 6 cm. */
const CRUST_PERIOD = 20;
/** Share of single texels that glint (a static ice-crystal sparkle in the albedo). */
const GLINT_SHARE = 0.012;

/** Sintered surface: soft bumps, slightly tilted crust plates and broken crust edges. */
const paintCrust = (context: RecipeContext) => {
  const { noise } = context;
  fillBase(context, (u, v, x, y, paint) => {
    const sinter = noise.fbm(u, v, 12, 3);
    const plate = noise.worley(u, v, CRUST_PERIOD);
    const edge = 1 - smoothstep(0.015, 0.09, plate.second - plate.nearest);
    const broken = smoothstep(0.22, 0.5, noise.fbm(u + 0.31, v - 0.17, 8, 2));
    const crack = edge * broken * 0.7;
    const tiltX = (plate.nearestId - 0.5) * 0.08;
    const tiltY = ((plate.nearestId * 7.31) % 1 - 0.5) * 0.08;
    const grain = hashTexel(x, y, 41);
    const glint = hashTexel(x, y, 43) < GLINT_SHARE ? 0.3 : 0;
    setTone(paint, 1 + sinter * 0.04 + (grain - 0.5) * 0.08 - crack * 0.16 + glint);
    paint.roughness = 0.7;
    const facet = plate.offsetX * tiltX + plate.offsetY * tiltY;
    return 0.42 + sinter * 0.16 + facet - crack * 0.14 + grain * 0.03;
  });
};

/** Rounded ice granules (corn snow) resting on the crust. */
const paintGranules = (context: RecipeContext) => {
  const { canvas, paint, random } = context;
  scatter(context, 1400, (x, y) => {
    setTone(paint, range(random, 1.02, 1.18));
    stampDisc(canvas, x, y, range(random, 0.6, 1.3), range(random, 0.5, 0.6), 0.05, paint);
  });
};

/** Class 3 (snow; rock if it ever renders): crystal grain, sintered bumps and a broken crust. */
export const paintSnowMicro = (context: RecipeContext) => {
  paintCrust(context);
  paintGranules(context);
};
