import { DMath } from "../../shared/math/deterministic-math";
import type { Point3 } from "./building-recipe";
import { runBetween } from "./nation-kit-parts";
import type { ResidenceSite } from "./nation-residence-kit";

const TURF: Point3 = [.42, .5, .26];
const TURF_THICKNESS = .12;
/** Birch bark under the sod shows as a pale lip at the eaves. */
const BARK_LIP = .035;

export interface TurfRoof { back: number; front: number; eave: number; rise: number; x0: number; x1: number }

/**
 * Sod roof: two turf slopes on a birch-bark underlay, plank gables, crossed barge boards with turned
 * finials and a little smoke louver on the ridge. The ridge runs along x.
 */
export const addTurfRoof = (site: ResidenceSite, roof: TurfRoof) => {
  const { add, detailed } = site, run = (roof.front - roof.back) / 2, mid = (roof.front + roof.back) / 2;
  const slope = DMath.atan2(roof.rise, run), length = DMath.hypot(roof.rise, run), width = roof.x1 - roof.x0;
  const centreX = (roof.x0 + roof.x1) / 2;
  for (const side of [-1, 1]) {
    const z = mid + side * run / 2, y = roof.eave + roof.rise / 2;
    add({ position: [centreX, y + .05, z], rotation: [side * slope, 0, 0], shape: "box",
      size: [width, TURF_THICKNESS, length], stage: 4, surface: "leaf", tint: TURF });
    add({ position: [centreX, y - .02, z], rotation: [side * slope, 0, 0], shape: "box",
      size: [width + BARK_LIP, .03, length + BARK_LIP], stage: 4, surface: "wood", tint: [.9, .85, .72] });
  }
  for (const x of [roof.x0 + .06, roof.x1 - .06]) add({ position: [x, roof.eave + roof.rise / 2, mid],
    rotation: [0, Math.PI / 2, 0], shape: "gable", size: [run * 2 - .1, roof.rise - .02, .08], stage: 3, surface: "planks" });
  add({ position: [centreX, roof.eave + roof.rise + .07, mid], radialSegments: detailed ? 8 : 4,
    rotation: [0, 0, Math.PI / 2], shape: "cylinder", size: [.16, width - .02, .16], stage: 4, surface: "leaf", tint: TURF });
  for (const x of [roof.x0 - .01, roof.x1 + .01]) for (const side of [-1, 1]) {
    const foot: Point3 = [x, roof.eave + .06, mid + side * (run - .02)];
    const tip: Point3 = [x, roof.eave + roof.rise + .26, mid - side * .12];
    runBetween(site.add, foot, tip, [.04, .07], { shape: "bevel-box", surface: "wood" });
  }
  for (const x of [roof.x0 - .01, roof.x1 + .01]) add({ position: [x, roof.eave + roof.rise + .3, mid], shape: "cone",
    size: [.06, .12, .06], stage: 4, surface: "wood", radialSegments: detailed ? 8 : 4 });
  smokeLouver(site, [centreX - width * .22, roof.eave + roof.rise, mid]);
};

/** Plank box over the smoke hole with a little two-board cap. */
const smokeLouver = (site: ResidenceSite, ridge: Point3) => {
  const [x, y, z] = ridge;
  site.add({ position: [x, y + .12, z], shape: "box", size: [.18, .16, .18], stage: 4, surface: "planks" });
  site.add({ position: [x, y + .14, z + .091], shape: "window-shadow", size: [.1, .05, .01], stage: 4, surface: "dark" });
  for (const side of [-1, 1]) site.add({ position: [x, y + .23, z + side * .06], rotation: [side * .6, 0, 0],
    shape: "box", size: [.24, .03, .16], stage: 4, surface: "roof" });
};

/** High: tufts of grass along the sod ridge. */
export const addTurfTufts = (site: ResidenceSite, ridge: Point3, length: number) => {
  for (let index = 0; index < 7; index++) site.add({
    position: [ridge[0] - length / 2 + index * length / 6, ridge[1] + .14, ridge[2] + (index % 2 ? .04 : -.05)],
    radialSegments: 5, shape: "sphere", size: [.14, .09, .12], stage: 4, surface: "leaf", tint: [.5, .62, .3] });
};
