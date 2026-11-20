import { smoothstep } from "../../shared/world/noise";
import { rgb } from "../color";
import { SNOW_PALETTE } from "../snow-palette";
import {
  fillBase,
  type MaterialRecipe,
  type RecipeContext,
  scatterStones,
  unit} from "./recipe-helpers";
import { blendPaint, hashTexel, setPaint } from "./tile-canvas";

/** Same stone family as the cliff materials (rocks/rock-texture), terrain splat palette. */
const ROCK = {
  beige: rgb(0x9c927f),
  coolDark: rgb(0x5d6066),
  coolLight: rgb(0x8e9196),
  moss: rgb(0x4a5a2a),
  warmDark: rgb(0x6a6158),
  warmLight: rgb(0xa09484)
} as const;

const SNOW = {
  blue: SNOW_PALETTE.tileBlue,
  light: SNOW_PALETTE.tileLight,
  rocks: [rgb(0x77736e), rgb(0x86817a), rgb(0x6a6662)],
  shadow: SNOW_PALETTE.tileShadow
} as const;

/**
 * Exposed bedrock between the sculpted rocks: mineral grains, worn facets and interrupted fractures.
 * Fine relief carries the close view; restrained large features avoid repeating paving-stone plates.
 */
export const rock: MaterialRecipe = (context) => {
  const { noise } = context;
  fillBase(context, (u, v, x, y, paint) => {
    const warpU = noise.gradient(u, v, 3) * .035;
    const warpV = noise.gradient(u + .47, v + .13, 3) * .035;
    const plate = noise.worley(u + warpU, v + warpV, 9);
    const fracture = (1 - smoothstep(.008, .075, plate.second - plate.nearest)) *
      smoothstep(-.1, .35, noise.gradient(u + .11, v + .29, 4));
    const weathering = smoothstep(-0.2, 0.35, noise.fbm(u + 0.3, v + 0.1, 2, 2));
    const mineral = noise.fbm(u + .37, v + .61, 24, 2);
    const grain = noise.gradient(u, v, 104);
    const pit = smoothstep(.3, .65, noise.gradient(u + .19, v + .43, 62));
    const facet = (plate.offsetX * .65 + plate.offsetY * .35) * .025;
    const luminance = .53 + noise.fbm(u, v, 3, 2) * .11 + mineral * .065 + grain * .025 +
      facet - fracture * .12 - weathering * .035 - pit * .025;
    const warm = unit(noise.fbm(u + 0.6, v, 2, 2));
    setPaint(paint, ROCK.coolDark, ROCK.coolLight, smoothstep(0.25, 0.75, luminance));
    blendPaint(paint, ROCK.warmDark, ROCK.warmLight, smoothstep(0.25, 0.75, luminance), warm * 0.7);
    const band = smoothstep(
      0.7,
      0.95,
      unit(Math.sin((u * 2 + v * 11 + warpU * 12) * Math.PI * 2))
    );
    blendPaint(paint, ROCK.beige, ROCK.beige, 0, band * .1);
    const mossy = smoothstep(.1, .4, noise.gradient(u, v, 6)) * fracture * weathering;
    blendPaint(paint, ROCK.moss, ROCK.moss, 0, mossy * .32);
    const speckle = .98 + hashTexel(x, y, 71) * .04;
    paint.r *= speckle;
    paint.g *= speckle;
    paint.b *= speckle;
    paint.roughness = .72 + weathering * .16 + pit * .05;
    return .48 + facet + mineral * .035 + grain * .012 - fracture * .065 - pit * .018;
  });
};

/**
 * Wind packed snow: soft drifts, crust ripples (fine wind-crust ripples break the long ones, no footprints),
 * matte grain, a few small stones poking through (GROUND-PALETTE step 3: fewer, smaller, lighter dots).
 */
export const snow: MaterialRecipe = (context: RecipeContext) => {
  const { noise } = context;
  fillBase(context, (u, v, x, y, paint) => {
    const warp = noise.fbm(u, v, 2, 3) * 0.15;
    const drift = unit(noise.fbm(u + warp, v - warp, 3, 4));
    const ripple = unit(Math.sin((u * 3 + v * 9 + warp * 6) * Math.PI * 2)) * 0.5;
    const crustRipple = unit(Math.sin((u * 7 + v * 23 + warp * 14) * Math.PI * 2)) *
      smoothstep(0.35, 0.75, drift);
    const crust = noise.gradient(u + .17, v + .43, 52);
    const grain = hashTexel(x, y, 99) - .5;
    setPaint(paint, SNOW.shadow, SNOW.light, smoothstep(0.2, 0.8, drift + ripple * 0.15 + crustRipple * 0.05));
    blendPaint(paint, SNOW.blue, SNOW.blue, 0, (1 - drift) * 0.25);
    const grainTint = 1 + crust * .012 + grain * .012;
    paint.r *= grainTint; paint.g *= grainTint; paint.b *= grainTint;
    paint.roughness = .83 + (1 - drift) * .08 + crust * .025;
    return .3 + drift * .45 + ripple * .06 + crustRipple * .035 + crust * .014 + grain * .006;
  });
  scatterStones(
    context,
    {
      angularity: 0.7,
      buried: 0.85,
      count: 9,
      flatTop: 0.8,
      maxRadius: 5,
      minRadius: 1.5,
      palette: SNOW.rocks,
      surface: 0.62
    },
    97
  );
};
