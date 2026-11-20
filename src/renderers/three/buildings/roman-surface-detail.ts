import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import {
  ROMAN_ROOF_COURSE_LENGTH_SCALE,
  ROMAN_ROOF_TILE_SCALE
} from "../../../render-common/buildings/roman-roof-tiles";
import { fract, smoothstep } from "../../../shared/world/noise";
import { hideSurfaceDetail } from "./hide-surface-detail";
import {
  blockVariation, type RomanSurfaceDetail, type SurfaceCoordinate,
wrapIndex} from "./surface-detail-common";
import { tanningLiquidDetail } from "./tanning-liquid-detail";
import { limePlasterDetail, plankDetail } from "./wall-surface-detail";

export type { RomanSurfaceDetail } from "./surface-detail-common";

/** Ashlar map layout: stone courses per tile and blocks per course (odd courses offset by half). */
export const STONE_COURSES = 8;
export const STONE_BLOCKS_PER_COURSE = 5;

/** Cut granite, with chipped mortar edges and warm/cool mineral inclusions. */
const stoneDetail = (point: SurfaceCoordinate): RomanSurfaceDetail => {
  const { grain, mineral, u, v, weather } = point;
  const course = fract(v + (Math.sin(u * Math.PI * 2) * 0.025) / STONE_COURSES) * STONE_COURSES;
  const row = Math.floor(course);
  const columnPosition = u * STONE_BLOCKS_PER_COURSE + (row % 2) * 0.5;
  const column = Math.floor(columnPosition);
  const jointDistance = Math.min(fract(course), fract(columnPosition));
  const stone = smoothstep(0.008, 0.037 + mineral * 0.012, jointDistance);
  const block = blockVariation(column % STONE_BLOCKS_PER_COURSE, (row + STONE_COURSES) % STONE_COURSES) - 0.5;
  const fleck = (grain - 0.5) * .012 + (mineral - 0.5) * .018;
  // One quarry palette: broad faces stay within roughly 14% including mineral colour tilt.
  const brightness = 1 + (weather - .5) * .035 + block * .045 + fleck - (1 - stone) * .18;
  return {
    brightness,
    colour: [1 + (mineral - 0.5) * .02, 1, 1 - (mineral - 0.5) * .018],
    height: 0.43 + stone * 0.12 + (mineral - 0.5) * 0.025 + (grain - 0.5) * 0.015,
    roughness: 205 + weather * 35 + (1 - stone) * 10
  };
};
const woodDetail = (point: SurfaceCoordinate, surface: BuildingSurface): RomanSurfaceDetail => {
  const { grain, mineral, u, v, weather } = point;
  const knotU = Math.sin((u - 0.28) * Math.PI) * 0.26;
  const knotV = Math.sin((v - 0.4) * Math.PI) * 0.65;
  const knotDistance = Math.hypot(knotU, knotV);
  const knot = Math.max(0, 1 - knotDistance * 9);
  const flow = Math.sin(v * 4 * Math.PI) * .8 + knot * 7;
  const fibres = Math.sin(u * 48 * Math.PI + flow);
  const fine = Math.sin(u * 156 * Math.PI + flow * 2) * .022;
  const pores = Math.pow(Math.max(0, Math.sin(u * 88 * Math.PI + flow)), 12)
    * (.035 + .035 * Math.sin(v * 12 * Math.PI) ** 2);
  let pattern = fibres * .085 + fine - pores - knot * .16;
  if (surface === "bark") {
    const fissure = Math.pow(Math.max(0, Math.sin(u * 32 * Math.PI + Math.sin(v * 6 * Math.PI) * .7)), 8);
    const flakes = Math.sin(u * 70 * Math.PI + Math.sin(v * 18 * Math.PI) * 2);
    pattern = -fissure * .3 + flakes * .045 + fibres * .035;
  }
  if (surface === "endgrain") {
    const radius = Math.hypot(u - 0.5, v - 0.5);
    const angle = Math.atan2(v - .5, u - .5);
    const rings = Math.sin(radius * 110 + Math.sin(angle * 3) * .5);
    const split = Math.pow(Math.max(0, Math.cos(angle * 5 + radius * .6)), 48)
      * smoothstep(.13, .42, radius);
    pattern = rings * .1 - split * .16;
  }
  return {
    brightness: 0.88 + weather * 0.24 + pattern + (grain - 0.5) * 0.025,
    colour: [1.025, 1, 0.98],
    height: 0.5 + pattern * 0.55 + (mineral - 0.5) * 0.018,
    roughness: 190 + weather * 48
  };
};
const roofDetail = (point: SurfaceCoordinate, detailed: boolean): RomanSurfaceDetail => {
  const { grain, mineral, u, v, weather } = point;
  let relief = 0;
  if (!detailed) {
    const tileU = fract((u * 16) / ROMAN_ROOF_TILE_SCALE);
    relief = Math.sin(tileU * Math.PI) * 0.085;
    if (
      fract((v * 12) / (ROMAN_ROOF_TILE_SCALE * ROMAN_ROOF_COURSE_LENGTH_SCALE)) < 0.055 ||
      tileU < 0.025
    )
      relief = -0.09;
  }
  const clay = (mineral - 0.5) * 0.07 + (grain - 0.5) * 0.025;
  // Fired-clay pitting and lichen rosettes keep the glaze-free tiles from reading as plastic.
  const pit = Math.max(0, .06 - grain) * 1.4;
  const lichen = smoothstep(.72, .8, mineral) * .6;
  // High tiles map one texture per tile: soot and grime settle at both laps of every tile.
  const laps = detailed ? (1 - smoothstep(0, .2, Math.min(u, 1 - u))) * .16 : 0;
  return {
    brightness: 0.92 + weather * 0.16 + clay + relief - pit + lichen * .06 - laps,
    colour: [1 + (weather - 0.5) * 0.035 - lichen * .08, 1 + lichen * .03, 1 + (mineral - 0.5) * 0.025 - lichen * .05],
    height: 0.5 + relief + clay * 0.6 - pit * .4 - laps * .3,
    roughness: 195 + mineral * 43 + lichen * 12 + laps * 60
  };
};

/** Combed reed thatch: layered courses whose lower edges shade the next, strand by strand. */
const thatchDetail = ({ grain, mineral, u, v, weather }: SurfaceCoordinate): RomanSurfaceDetail => {
  const course = v * 10 + Math.sin(u * Math.PI * 6) * .08, row = wrapIndex(Math.floor(course), 10);
  const down = fract(course);
  const stem = Math.sin(u * 300 * Math.PI + Math.sin(v * Math.PI * 8) * .6 + row * 1.3);
  const bundle = Math.sin(u * 46 * Math.PI + row * 2.1) * .5 + .5;
  const shade = Math.exp(-down * 9) * .2;
  const tone = blockVariation(row, Math.floor(u * 23)) - .5;
  return { brightness: .86 + stem * .1 + bundle * .05 + (mineral - .5) * .14 + down * .06 - shade + tone * .06
      + weather * .05,
    colour: [1.04, 1, .9 - shade * .2], height: .38 + stem * .04 + down * .14 + bundle * .02,
    roughness: 240 + grain * 12 };
};

/** Staggered wheat kernels with shaded hulls and the central crease of each seed. */
const feedGrainDetail = ({ grain, u, v }: SurfaceCoordinate): RomanSurfaceDetail => {
  const row = Math.floor(v * 18);
  const column = Math.floor(u * 24 + (row % 2) * .5);
  const x = fract(u * 24 + (row % 2) * .5) - .5;
  const y = fract(v * 18) - .5;
  const variation = blockVariation(column, row);
  const angle = (variation - .5) * 1.1;
  const across = x * Math.cos(angle) - y * Math.sin(angle);
  const along = x * Math.sin(angle) + y * Math.cos(angle);
  const ellipse = across * across / .075 + along * along / .22;
  const kernel = Math.max(0, 1 - ellipse);
  const crease = Math.exp(-across * across * 1800) * Math.max(0, 1 - along * along * 5);
  return { brightness: .65 + Math.sqrt(kernel) * .48 + variation * .12 - crease * .17,
    colour: [1.06, 1, .83], height: .43 + kernel * .18 - crease * .045,
    roughness: 218 + grain * 22 };
};

const feedWaterDetail = ({ u, v }: SurfaceCoordinate): RomanSurfaceDetail => {
  const ripple = Math.sin((u * 5 + v * 3) * Math.PI * 2 + Math.sin(v * Math.PI * 4) * .7);
  const cross = Math.sin((u * 3 - v * 7) * Math.PI * 2);
  const glint = Math.pow(Math.max(0, ripple * cross), 7);
  return { brightness: .94 + ripple * .07 + glint * .24, colour: [.92, 1, 1.03],
    height: .5 + ripple * .055 + cross * .025, roughness: 130 + (1 - glint) * 25 };
};

/** Matte fired-clay interior paving with fine earth grain and restrained kiln variation. */
const mosaicDetail = ({ grain, mineral, u, v }: SurfaceCoordinate): RomanSurfaceDetail => {
  const tileU = fract(u * 8), tileV = fract(v * 8);
  const grout = Math.min(tileU, 1 - tileU, tileV, 1 - tileV) < .015;
  const tileVariation = blockVariation(Math.floor(u * 8), Math.floor(v * 8));
  const variation = (tileVariation - .5) * .12 + (mineral - .5) * .06 + (grain - .5) * .045;
  return {
    brightness: grout ? .78 : 1 + variation,
    colour: [1.02, 1, .96],
    height: grout ? .47 : .52 + (grain - .5) * .018,
    roughness: grout ? 245 : 225 + mineral * 20
  };
};

/** Original surface detail is baked into shared PBR maps; no extra draw calls or shader passes. */
export const sampleRomanSurfaceDetail = (
  surface: BuildingSurface,
  point: SurfaceCoordinate,
  detailed: boolean
): RomanSurfaceDetail => {
  if (surface === "feed-grain") return feedGrainDetail(point);
  if (surface === "feed-water") return feedWaterDetail(point);
  if (surface === "mosaic") return mosaicDetail(point);
  if (surface === "copper") {
    const { grain, mineral, u, v, weather } = point;
    const dents = Math.sin(u * 38 * Math.PI) * Math.sin(v * 30 * Math.PI);
    const patina = Math.max(0, mineral - .64) * .3;
    return { brightness: .91 + weather * .15 + dents * .055 + (grain - .5) * .07,
      colour: [1 - patina, 1 + patina * .3, 1 + patina * .8],
      height: .5 + dents * .032 + (grain - .5) * .019,
      roughness: 155 + mineral * 65 };
  }
  if (surface === "cut-stone") {
    const { grain, mineral, u, v, weather } = point;
    const pit = Math.max(0, .22 - grain) * .5;
    const dressing = Math.sin(u * 48 * Math.PI + Math.sin(v * 8 * Math.PI) * 1.5)
      * Math.sin(v * 40 * Math.PI) * .025;
    return {
      brightness: 1 + (weather - .5) * .04 + (grain - .5) * .018 + (mineral - .5) * .025
        - pit * .2 + dressing * .2,
      colour: [1 + (weather - .5) * .024, 1, 1 - (weather - .5) * .022],
      height: .5 + (grain - .5) * .075 + (mineral - .5) * .05 - pit * .45 + dressing,
      roughness: 218 + mineral * 27
    };
  }
  if (surface === "bread") {
    const { grain, mineral, weather } = point;
    const blister = Math.max(0, mineral - .6) * .3;
    return { brightness: .88 + weather * .23 + (grain - .5) * .08 - blister,
      colour: [1.03, 1, .96], height: .5 + blister * .2 + (grain - .5) * .02,
      roughness: 210 + mineral * 30 };
  }
  if (surface === "tanning-liquid") return tanningLiquidDetail(point);
  if (surface === "stone") return stoneDetail(point);
  if (surface === "plaster") return limePlasterDetail(point);
  if (surface === "planks") return plankDetail(point);
  if (surface === "wood" || surface === "bark" || surface === "endgrain")
    return woodDetail(point, surface);
  if (surface === "roof-thatch") return thatchDetail(point);
  if (surface === "roof") return roofDetail(point, detailed);
  if (surface === "hide") return hideSurfaceDetail(point);
  const { grain, mineral, u, v, weather } = point;
  const result: RomanSurfaceDetail = {
    brightness: 0.87 + weather * 0.2 + (grain - 0.5) * 0.025,
    colour: [1, 1, 1],
    height: 0.5 + (mineral - 0.5) * 0.025,
    roughness: 205 + weather * 35
  };
  if (surface === "fish") {
    const back = (1 + Math.cos(u * Math.PI * 2)) / 2;
    const row = Math.floor(v * 28);
    const scales = Math.sin((u * 24 + (row % 2) * 0.5) * Math.PI * 2);
    result.brightness = 1.35 - back * 0.68 + scales * 0.045;
    result.colour = [0.78 + (1 - back) * 0.22, 0.9, 1];
    result.height = 0.5 + scales * 0.02;
    result.roughness = 145 + back * 20;
  }
  if (surface === "straw") {
    const fibres = Math.sin(u * (detailed ? 96 : 32) * Math.PI + Math.sin(v * Math.PI * 2) * 0.18);
    const grooves = Math.pow(Math.max(0, fibres), 5);
    result.brightness += fibres * 0.085 - grooves * 0.12;
    result.height += fibres * 0.04 - grooves * 0.055;
    result.roughness = 238;
  }
  if (surface === "cloth" || surface === "rope" || surface === "sacking") {
    const weave = Math.sin(u * 256 * Math.PI) * Math.sin(v * 256 * Math.PI);
    result.height += weave * (surface === "sacking" ? 0.045 : 0.018);
    result.brightness += weave * (surface === "sacking" ? 0.09 : 0.035);
    result.roughness = 235;
  }
  if (surface === "steel" || surface === "iron" || surface === "gold") {
    const brushed = Math.sin(v * 192 * Math.PI + mineral * 3);
    result.brightness = 0.96 + (weather - 0.5) * 0.045 + brushed * 0.018;
    result.height = 0.5 + brushed * 0.003;
    result.roughness = 135 + weather * 25;
  }
  return result;
};
