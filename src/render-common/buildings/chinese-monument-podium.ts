import type { Point3 } from "./building-recipe";
import { CHINESE_TIMBER } from "./chinese-building-roofs";
import type { Add } from "./nation-kit-parts";
import { runBetween } from "./nation-kit-parts";

const STONE: Point3 = [.88, .81, .67];
const GILT: Point3 = [.61, .44, .21];
export const CHINESE_GATE_CENTRES = [-2.44, -1.22, 0, 1.22, 2.44] as const;

/** A solid battered podium, with genuine recessed door bays instead of dark squares on its face. */
export const addChineseGatePodium = (add: Add, detailed: boolean) => {
  add({ position: [0, .06, 0], shape: "bevel-box", size: [7.7, .12, 5.1],
    stage: 1, surface: "cut-stone", tint: STONE });
  add({ position: [0, 1.03, -.375], shape: "box", size: [7.3, 1.82, 3.65],
    stage: 1, surface: "cut-stone", tint: STONE, topScale: [.92, 1, .9], topOffset: [0, 0, -.14] });
  const spans: [number, number][] = [[-3.65, -2.83], [-2.05, -1.61], [-.83, -.39],
    [.39, .83], [1.61, 2.05], [2.83, 3.65]];
  for (const [left, right] of spans) {
    const outer = Math.abs(left) > 3 || Math.abs(right) > 3;
    const width = right - left, centre = (left + right) / 2;
    add({ position: [centre, .82, 1.8], shape: "box", size: [width, 1.4, .8],
      stage: 1, surface: "cut-stone", tint: STONE,
      topScale: [outer ? .72 : 1, 1, .75],
      topOffset: [outer ? -Math.sign(centre) * width * .14 : 0, 0, -.1] });
  }
  add({ position: [0, 1.72, 1.7], shape: "box", size: [7.07, .4, .6],
    stage: 1, surface: "cut-stone", tint: STONE, topScale: [.96, 1, .91], topOffset: [0, 0, -.027] });
  add({ position: [0, 1.96, -.08], shape: "bevel-box", size: [7.15, .15, 4.55],
    stage: 1, surface: "cut-stone", tint: [.94, .88, .75] });
  for (const x of CHINESE_GATE_CENTRES) addChineseGateDoor(add, x, detailed);
};

const addChineseGateDoor = (add: Add, x: number, detailed: boolean) => {
  // Door leaves sit0.34 behind the sloping opening lip, and close against an opaque rear chamber.
  add({ position: [x, .77, 1.445], shape: "box", size: [.79, 1.3, .08],
    stage: 2, surface: "paint", tint: [.29, .055, .035] });
  for (const side of [-1, 1]) {
    add({ position: [x + side * .186, .77, 1.498], shape: "bevel-box", size: [.366, 1.28, .04],
      stage: 2, surface: "paint", tint: CHINESE_TIMBER });
    add({ position: [x + side * .39, .78, 1.55], shape: "box", size: [.065, 1.32, .2],
      stage: 2, surface: "paint", tint: [.39, .075, .045] });
    add({ position: [x + side * .1, .73, 1.526], radialSegments: detailed ? 12 : 6,
      rotation: [Math.PI / 2, 0, 0], shape: "ring", size: [.065, .012, .065],
      stage: 3, surface: "gold", tint: GILT });
    const rows = detailed ? 6 : 3;
    for (let row = 0; row < rows; row++) for (const column of [-1, 1])
      add({ position: [x + side * (.186 + column * .102), .32 + row * .15 * 6 / rows, 1.526],
        radialSegments: 6, shape: detailed ? "sphere" : "box", size: [.022, .022, .014],
        stage: 3, surface: "gold", tint: GILT });
  }
  add({ position: [x, 1.444, 1.61], shape: "box", size: [.92, .095, .24],
    stage: 2, surface: "cut-stone", tint: [.96, .9, .77] });
  // A faceted ceremonial stone lintel follows the five-sided heads in the supplied gate reference.
  runBetween(add, [x - .45, 1.49, 1.66], [x - .3, 1.63, 1.66], [.075, .075],
    { stage: 2, surface: "cut-stone", tint: STONE });
  runBetween(add, [x + .45, 1.49, 1.66], [x + .3, 1.63, 1.66], [.075, .075],
    { stage: 2, surface: "cut-stone", tint: STONE });
  add({ position: [x, 1.63, 1.66], shape: "box", size: [.62, .075, .075],
    stage: 2, surface: "cut-stone", tint: STONE });
  add({ position: [x, .145, 1.88], shape: "box", size: [.78, .05, .65],
    stage: 1, surface: "cut-stone", tint: [.94, .88, .75] });
};

/** Continuous terrace rails stand on the stone deck, safely behind the battered wall face. */
export const addChineseTerraceRails = (add: Add, detailed: boolean) => {
  const post = (x: number, z: number) => {
    add({ position: [x, 2.17, z], shape: "bevel-box", size: [.085, .29, .085],
      stage: 2, surface: "cut-stone", tint: STONE });
    if (detailed) add({ position: [x, 2.326, z], shape: "bevel-box", size: [.12, .035, .12],
      stage: 3, surface: "cut-stone", tint: STONE });
  };
  for (const z of [-2.1, 1.94]) {
    for (let index = 0; index <= 14; index++) post(-3.4 + index * 6.8 / 14, z);
    for (const y of [2.1, 2.27]) add({ position: [0, y, z], shape: "box", size: [6.86, .045, .045],
      stage: 2, surface: "cut-stone", tint: STONE });
  }
  for (const side of [-1, 1]) {
    for (let index = 1; index < 8; index++) post(side * 3.4, -2.1 + index * 4.04 / 8);
    for (const y of [2.1, 2.27]) add({ position: [side * 3.4, y, -.08], shape: "box", size: [.045, .045, 4.04],
      stage: 2, surface: "cut-stone", tint: STONE });
  }
};
