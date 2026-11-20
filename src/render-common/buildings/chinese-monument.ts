import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { addChineseBracket, CHINESE_TIMBER } from "./chinese-building-roofs";
import { addChineseGatePodium, addChineseTerraceRails } from "./chinese-monument-podium";
import { addChineseRidgeFinial } from "./chinese-ridge-finial";
import { monumentRecipe } from "./monument-definition";
import { type Add, runBetween } from "./nation-kit-parts";
import { getOccupationRoofHeight } from "./occupation-roof-height";

const IVORY: Point3 = [.91, .84, .7];
const GILT: Point3 = [.57, .4, .19];
const HALL_FRONT = 1.15;
const HALL_BACK = -1.45;
const ROOF: BuildingPart = { occupationRoof: "hip", roofSweep: .29, roofCurve: .6, roofTiles: "pan-cover",
  position: [0, 3.93, -.15], rotation: [0, Math.PI / 2, 0], shape: "occupation-roof",
  size: [4.5, .98, 7.25], stage: 3, surface: "roof-slate" };

const roofPoint = (u: number, v: number, lift = 0): Point3 => [v * ROOF.size[2],
  ROOF.position[1] + getOccupationRoofHeight("hip", u, v, ROOF.roofSweep, ROOF.roofCurve) * ROOF.size[1] + lift,
  ROOF.position[2] - u * ROOF.size[0]];

/** The central palace gate only: five recessed gates, battered podium and one sweeping hall roof. */
export const chineseMonumentRecipe = (detailed: boolean): BuildingRecipe => {
  const parts: BuildingPart[] = [];
  const add: Add = part => parts.push({ compactGeometry: true, stage: 3, ...part });
  addChineseGatePodium(add, detailed);
  addChineseUpperHall(add, detailed);
  addChineseTerraceRails(add, detailed);
  addChinesePalaceRoof(add, detailed);
  return { ...monumentRecipe(), parts };
};

const addChineseUpperHall = (add: Add, detailed: boolean) => {
  // Closed ivory/red shell: front shutters and windows have opaque backing and real jambs.
  add({ position: [0, 2.805, -.15], shape: "box", size: [6.12, 1.55, 2.6],
    stage: 2, surface: "plaster", tint: IVORY });
  add({ position: [0, 2.075, -.15], shape: "bevel-box", size: [6.3, .09, 2.78],
    stage: 2, surface: "paint", tint: CHINESE_TIMBER });
  for (const z of [HALL_BACK - .035, HALL_FRONT + .035]) {
    for (let index = 0; index < 8; index++) {
      const x = -2.94 + index * .84;
      add({ position: [x, 2.765, z], radialSegments: detailed ? 12 : 6,
        shape: "cylinder", size: [.135, 1.42, .135], stage: 2, surface: "paint", tint: CHINESE_TIMBER });
      addChineseBracket(add, [x, 3.49, z], 0, detailed, 1.05);
    }
    for (const [y, height] of [[2.26, .1], [3.45, .13], [3.61, .12]])
      add({ position: [0, y!, z], shape: "box", size: [6.15, height!, .14],
        stage: 2, surface: "paint", tint: CHINESE_TIMBER });
    for (let bay = 0; bay < 7; bay++) addChineseHallBay(add, -2.52 + bay * .84, z, bay, detailed);
  }
  for (const side of [-1, 1]) {
    add({ position: [side * 3.035, 2.82, -.15], shape: "box", size: [.09, 1.4, 2.6],
      stage: 2, surface: "paint", tint: CHINESE_TIMBER });
    for (const y of [2.26, 3.45, 3.61]) add({ position: [side * 3.04, y, -.15],
      shape: "box", size: [.13, .12, 2.75], stage: 2, surface: "paint", tint: CHINESE_TIMBER });
    for (const z of [-.95, -.15, .65]) {
      add({ position: [side * 3.085, 2.82, z], shape: "box", size: [.035, .87, .58],
        stage: 2, surface: "paint", tint: [.32, .12, .07] });
      if (detailed) for (let slat = 0; slat < 5; slat++)
        add({ position: [side * 3.108, 2.82, z - .22 + slat * .11], shape: "box",
          size: [.025, .78, .025], stage: 3, surface: "paint", tint: IVORY });
    }
  }
  addChineseRoofWallHeads(add, detailed);
};

const addChineseHallBay = (add: Add, x: number, z: number, bay: number, detailed: boolean) => {
  const front = Math.sign(z + .15), face = z + front * .055;
  const window = bay === 0 || bay === 2 || bay === 4 || bay === 6;
  add({ position: [x, 2.87, face], shape: "box", size: [.65, .96, .035],
    stage: 2, surface: "paint", tint: window ? [.15, .23, .16] : [.43, .075, .045] });
  for (const offset of [-.34, .34]) add({ position: [x + offset, 2.87, face + front * .028],
    shape: "box", size: [.045, 1.04, .065], stage: 2, surface: "paint", tint: CHINESE_TIMBER });
  for (const y of [2.37, 3.37]) add({ position: [x, y, face + front * .028], shape: "box",
    size: [.71, .045, .065], stage: 2, surface: "paint", tint: CHINESE_TIMBER });
  if (window) {
    const slats = detailed ? 7 : 3;
    for (let slat = 0; slat < slats; slat++)
      add({ position: [x - .27 + slat * .54 / (slats - 1), 2.87, face + front * .028],
        shape: "box", size: [.022, .88, .025], stage: 3, surface: "paint", tint: [.7, .59, .37] });
    add({ position: [x, 2.87, face + front * .03], shape: "box", size: [.59, .025, .025],
      stage: 3, surface: "paint", tint: [.7, .59, .37] });
  } else add({ position: [x, 2.87, face + front * .025], shape: "box", size: [.025, .88, .025],
    stage: 3, surface: "paint", tint: CHINESE_TIMBER });
  if (bay === 3) add({ position: [x, 3.46, face + front * .04], shape: "bevel-box",
    size: [.34, .27, .055], stage: 3, surface: "paint", tint: GILT });
};

/** Curved roof/wall junctions are sealed to the actual profile, including the higher hip ends. */
const addChineseRoofWallHeads = (add: Add, detailed: boolean) => {
  const count = detailed ? 24 : 12;
  for (const z of [HALL_BACK, HALL_FRONT]) for (let index = 0; index < count; index++) {
    const x = -3.06 + (index + .5) * 6.12 / count;
    const y = roofPoint((ROOF.position[2] - z) / ROOF.size[0], x / ROOF.size[2])[1] - .135;
    add({ position: [x, (3.55 + y) / 2, z], shape: "box", size: [6.12 / count + .01, y - 3.55, .13],
      stage: 2, surface: "paint", tint: CHINESE_TIMBER });
  }
  for (const x of [-3.02, 3.02]) for (let index = 0; index < count / 2; index++) {
    const z = HALL_BACK + (index + .5) * 2.6 / (count / 2);
    const y = roofPoint((ROOF.position[2] - z) / ROOF.size[0], x / ROOF.size[2])[1] - .135;
    add({ position: [x, (3.55 + y) / 2, z], shape: "box", size: [.13, y - 3.55, 2.6 / (count / 2) + .01],
      stage: 2, surface: "paint", tint: CHINESE_TIMBER });
  }
  // Visible rafters follow the actual swept soffit and bear on the continuous wall heads.
  for (const side of [-1, 1]) for (let column = 0; column < 8; column++) {
    const x = -2.94 + column * .84, segments = detailed ? 8 : 2;
    const wallU = -side * 1.3 / ROOF.size[0];
    for (let segment = 0; segment < segments; segment++) {
      const start = wallU + (-side * .4 - wallU) * segment / segments;
      const end = wallU + (-side * .4 - wallU) * (segment + 1) / segments;
      runBetween(add, roofPoint(start, x / ROOF.size[2], -.135),
        roofPoint(end, x / ROOF.size[2], -.135), [.085, .08],
        { stage: 2, surface: "paint", tint: CHINESE_TIMBER });
    }
  }
};

const addChinesePalaceRoof = (add: Add, detailed: boolean) => {
  add(ROOF);
  runBetween(add, roofPoint(0, -.285, .035), roofPoint(0, .285, .035), [.09, .085],
    { stage: 3, surface: "paint", tint: GILT });
  for (const side of [-1, 1]) {
    const point = roofPoint(0, side * .285, .05);
    if (detailed) addChineseRidgeFinial(part => add({ ...part,
      position: part.position.map((value, axis) => point[axis]! + (value - point[axis]!) * 2) as Point3,
      size: part.size.map(value => value * 2) as Point3, surface: "paint", tint: GILT }),
    point, side > 0 ? Math.PI / 2 : -Math.PI / 2, "roof-slate");
    else {
      add({ position: [point[0], point[1] + .085, point[2]], shape: "bevel-box",
        size: [.1, .21, .1], stage: 3, surface: "paint", tint: GILT });
      add({ position: [point[0] + side * .035, point[1] + .19, point[2]], shape: "box",
        rotation: [0, 0, side * -.25], size: [.16, .055, .09], stage: 3, surface: "paint", tint: GILT });
    }
  }
};
