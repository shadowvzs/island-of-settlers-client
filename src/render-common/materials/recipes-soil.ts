import { smoothstep } from "../../shared/world/noise";
import { rgb } from "../color";
import { type BladeStyle,paintBladeClump } from "./grass-blades";
import {
  addGrain,
  fillBase,
  type MaterialRecipe,
  range,
  type RecipeContext,
  scatter,
  scatterDebris,
  scatterLeaves,
  scatterStones,
  unit} from "./recipe-helpers";
import { blendPaint, setPaint } from "./tile-canvas";

const DIRT = {
  crust: rgb(0x8f7050),
  dark: rgb(0x4b3624),
  debris: [rgb(0x8f8050), rgb(0xa4925c), rgb(0x6e5c3a)],
  grainDark: rgb(0x3a2b1e),
  grainLight: rgb(0xa58a66),
  leaves: [rgb(0x7b5a31), rgb(0x8d6a3a), rgb(0x5d4326)],
  mid: rgb(0x654e37),
  pebbles: [rgb(0x6f6458), rgb(0x857865), rgb(0x5e544a), rgb(0x9a8a72), rgb(0x7a6a58)]
} as const;

const GRAVEL = {
  dark: rgb(0x564a3c),
  light: rgb(0x8a7c68),
  stones: [rgb(0x726d65), rgb(0x86817a), rgb(0x969085), rgb(0x635e57), rgb(0x7c7164), rgb(0x9f988a)]
} as const;

/**
 * Warm cream beach sand (owner white-beach references 06–08, 2026-11-17): less yellow and about 20 % darker
 * than before, so noon sand in the possessed view leaves the tonemapper's shoulder (TOOL-8: luma 239 → 215)
 * and the white swash foam keeps headroom over it; iso beaches still read light.
 */
const SAND = {
  dark: rgb(0x8f806a),
  debris: [rgb(0x5e5236), rgb(0x6f6040), rgb(0x8a7a58)],
  grainDark: rgb(0x957c58),
  grainLight: rgb(0xf1e6c8),
  light: rgb(0xb1a794),
  pebbles: [rgb(0x8f8678), rgb(0xa49a88), rgb(0x7a7064)],
  shells: [rgb(0xf0e8d8), rgb(0xe4d6c0), rgb(0xd9c4a6)]
} as const;

const SPRIG_STYLE: BladeStyle = {
  dryChance: 0.4,
  dryRamp: [rgb(0x9c8c4c), rgb(0xb4a35e), rgb(0x857a42)],
  greens: [rgb(0x4d6a2b), rgb(0x60802f), rgb(0x768f38)],
  height: [0.55, 0.85],
  length: [5, 10],
  tip: rgb(0xa8b062),
  width: [1.3, 2]
};

/** Sparse tufts of tough grass and weeds (soil is never completely bare). */
const paintSprigs = (context: RecipeContext, count: number) => {
  const { random } = context;
  scatter(context, count, (x, y) => {
    const blades = Math.round(range(random, 3, 9));
    const clump = {
      blades,
      hue: random(),
      lean: random() * 6.3,
      moisture: range(random, 0.15, 0.45),
      radius: 2.5,
      vigour: 0.3,
      x,
      y
    };
    paintBladeClump(context, SPRIG_STYLE, clump);
  });
};

/**
 * Packed earth: moist darker hollows, dry lighter crust, compacted smooth zones (less rough),
 * crumbs, pebbles of every size, dry grass bits and a few sprigs.
 */
export const dirt: MaterialRecipe = (context) => {
  const { noise } = context;
  fillBase(context, (u, v, x, y, paint) => {
    const warp = noise.fbm(u, v, 3, 2);
    const moist = unit(noise.fbm(u + warp * .05, v, 4, 3));
    const crust = smoothstep(-0.05, 0.5, noise.fbm(u, v, 6, 3));
    const compacted = smoothstep(0.05, 0.3, noise.fbm(u + 0.37, v + 0.11, 3, 2));
    const fine = unit(noise.fbm(u, v, 48, 2));
    const aggregate = noise.worley(u + warp * .018, v - warp * .018, 62);
    const crumb = 1 - smoothstep(.18, .64, aggregate.nearest);
    const loose = crumb * (1 - compacted * .8);
    setPaint(paint, DIRT.dark, DIRT.mid, moist);
    blendPaint(paint, DIRT.crust, DIRT.crust, 0, crust * 0.4);
    blendPaint(paint, DIRT.mid, DIRT.crust, aggregate.nearestId, loose * .18);
    const grain = addGrain(paint, x, y, DIRT.grainDark, DIRT.grainLight, 0.035);
    paint.roughness = .93 - compacted * .16 - (1 - moist) * .04 + loose * .025;
    const relief = fine * (.055 - compacted * .03) + grain * .008 + loose * .055;
    return 0.16 + moist * 0.06 + crust * 0.04 + relief;
  });
  scatterStones(
    context,
    {
      angularity: 0.35,
      buried: 0.45,
      count: 900,
      flatTop: 0.75,
      maxRadius: 3,
      minRadius: 0.7,
      palette: DIRT.pebbles,
      surface: 0.24
    },
    41
  );
  scatterStones(
    context,
    {
      angularity: 0.3,
      buried: 0.65,
      count: 70,
      flatTop: 0.7,
      maxRadius: 8,
      minRadius: 3.5,
      palette: DIRT.pebbles,
      surface: 0.24
    },
    43
  );
  scatterDebris(context, {
    bend: 1,
    count: 160,
    height: [0.3, 0.42],
    length: [4, 11],
    palette: DIRT.debris,
    roughness: 0.9,
    taper: 0.5,
    width: [1, 1.6]
  });
  scatterLeaves(context, {
    count: 12,
    curl: 0.06,
    height: [0.35, 0.5],
    length: [9, 15],
    palette: DIRT.leaves,
    shape: [0.45, 0.6]
  });
  paintSprigs(context, 26);
};

/** Exposed stony soil / scree: thin grey-brown earth packed with angular stones. */
export const gravel: MaterialRecipe = (context) => {
  const { noise } = context;
  fillBase(context, (u, v, x, y, paint) => {
    const tone = unit(noise.fbm(u, v, 5, 3));
    const matrix = noise.worley(u, v, 92);
    const grit = 1 - smoothstep(.22, .64, matrix.nearest);
    setPaint(paint, GRAVEL.dark, GRAVEL.light, tone);
    blendPaint(paint, GRAVEL.stones[0], GRAVEL.stones[2], matrix.nearestId, grit * .56);
    addGrain(paint, x, y, GRAVEL.dark, GRAVEL.light, .055);
    paint.roughness = .93 - grit * .1;
    return .13 + tone * .04 + unit(noise.gradient(u, v, 40)) * .02 + grit * .1;
  });
  const stones = { angularity: .85, buried: .48, flatTop: .65, palette: GRAVEL.stones };
  scatterStones(
    context,
    { ...stones, count: 3400, maxRadius: 3.5, minRadius: 1.2, surface: 0.2 },
    51
  );
  scatterStones(context, { ...stones, count: 480, maxRadius: 8, minRadius: 3.5, surface: 0.2 }, 53);
  scatterStones(context, { ...stones, count: 18, maxRadius: 15, minRadius: 8, surface: 0.22 }, 57);
  paintSprigs(context, 14);
};

/** Beach sand: soft wind ripples, mixed grains, shell fragments, pebbles, drift debris. */
export const sand: MaterialRecipe = (context) => {
  const { noise } = context;
  fillBase(context, (u, v, x, y, paint) => {
    const warp = noise.fbm(u, v, 3, 2) * 0.1;
    const phase = (u * 4 + v * 13 + warp * 13) * Math.PI * 2;
    const exposure = smoothstep(-.45, .4, noise.gradient(u + .31, v - .17, 5));
    const ripple = (unit(Math.sin(phase)) + Math.sin(phase * 2) * .08) * (.4 + exposure * .6);
    const tone = unit(noise.fbm(u, v, 4, 3));
    const fine = noise.gradient(u, v, 144);
    setPaint(paint, SAND.dark, SAND.light, tone * .76 + ripple * .14);
    const grain = addGrain(paint, x, y, SAND.grainDark, SAND.grainLight, .055);
    paint.roughness = .82 + exposure * .035 + grain * .025;
    return .18 + ripple * .1 + tone * .08 + fine * .012 + grain * .009;
  });
  scatterStones(
    context,
    {
      angularity: 0.1,
      buried: 0.4,
      count: 60,
      flatTop: 0.8,
      maxRadius: 3.5,
      minRadius: 1,
      palette: SAND.pebbles,
      surface: 0.3
    },
    61
  );
  scatterLeaves(context, {
    count: 70,
    curl: 0.08,
    height: [0.32, 0.42],
    length: [3, 7],
    palette: SAND.shells,
    shape: [0.55, 0.8]
  });
  scatterDebris(context, {
    bend: 1.4,
    count: 22,
    height: [0.33, 0.4],
    length: [6, 16],
    palette: SAND.debris,
    roughness: 0.8,
    taper: 0.4,
    width: [1, 1.8]
  });
};
