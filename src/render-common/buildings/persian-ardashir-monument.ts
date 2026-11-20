import { srgbToLinear } from "../color";
import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { monumentRecipe } from "./monument-definition";
import type { Add } from "./nation-kit-parts";
import { PERSIAN_BARREL_INNER_HEIGHT_SCALE, PERSIAN_BARREL_INNER_WIDTH_SCALE } from "./persian-vault-profile";
import { eulerFromRotation, multiplyRotations, rotationFromEuler } from "./recipe-rotation";

type Tint = NonNullable<BuildingPart["tint"]>;
const GYPSUM: Tint = [.94, .85, .70], WARM_STONE: Tint = [.76, .66, .51];
const TURQUOISE = srgbToLinear(.12, .53, .56), COBALT = srgbToLinear(.16, .33, .62);
const OCHRE = srgbToLinear(.79, .49, .25), GOLD = srgbToLinear(.90, .70, .36);
const HALL_CENTRES = [-2.65, 0, 2.65] as const;

const vaultEnd = (add: Add, x: number, z: number, width: number, rise: number, spring: number, depth: number) => {
  const innerRise = rise * PERSIAN_BARREL_INNER_HEIGHT_SCALE;
  add({ position: [x, spring + innerRise / 2, z], shape: "persian-barrel-end",
    size: [width * PERSIAN_BARREL_INNER_WIDTH_SCALE, innerRise, depth], surface: "plaster", worldUv: .875 });
};

const turned = (add: Add, x: number, z: number, yaw = 0): Add => part => {
  const [px, py, pz] = part.position;
  add({ ...part, position: [x + px * Math.cos(yaw) + pz * Math.sin(yaw), py,
    z - px * Math.sin(yaw) + pz * Math.cos(yaw)],
  rotation: eulerFromRotation(multiplyRotations(rotationFromEuler([0, yaw, 0]),
    rotationFromEuler(part.rotation ?? [0, 0, 0]))) });
};

/** True elliptical opening assembled from the existing mirrored quarter-circle spandrels. */
const archedWall = (add: Add, width: number, height: number, depth: number,
  opening: number, base: number, spring: number, rise: number, detailed: boolean) => {
  const pier = (width - opening) / 2, crown = Math.max(0, height - base - spring - rise);
  if (base > 0) add({ position: [0, base / 2, 0], shape: "box",
    size: [width, base, depth], surface: "plaster" });
  for (const side of [-1, 1]) {
    add({ position: [side * (opening + pier) / 2, height / 2, 0], shape: "box",
      size: [pier, height, depth], surface: "plaster" });
    add({ position: [side * opening / 4, base + spring + rise / 2, 0],
      rotation: [0, side < 0 ? Math.PI : 0, 0], shape: "arch-spandrel",
      size: [opening / 2, rise, depth], surface: "plaster" });
    const rows = detailed ? Math.max(3, Math.ceil(spring / .28)) : 2;
    for (let row = 0; row < rows; row++) add({
      position: [side * (opening / 2 + .055), base + spring * (row + .5) / rows, depth / 2 + .018],
      shape: "bevel-box", compactGeometry: true, size: [.11, spring / rows - .005, .075],
      surface: "paint", tint: row % 3 ? TURQUOISE : COBALT });
  }
  if (crown > .001) add({ position: [0, height - crown / 2, 0], shape: "box",
    size: [opening, crown, depth], surface: "plaster" });
  const segments = detailed ? 18 : 6;
  for (let index = 0; index < segments; index++) {
    const a = Math.PI * index / segments, b = Math.PI * (index + 1) / segments;
    const ax = Math.cos(a) * opening / 2, bx = Math.cos(b) * opening / 2;
    const ay = base + spring + rise * Math.sin(a), by = base + spring + rise * Math.sin(b);
    add({ position: [(ax + bx) / 2, (ay + by) / 2, depth / 2 + .02],
      rotation: [0, 0, Math.atan2(by - ay, bx - ax)], shape: "bevel-box", compactGeometry: true,
      size: [Math.hypot(bx - ax, by - ay) - .002, .10, .085],
      surface: "paint", tint: index % 4 ? TURQUOISE : GOLD });
  }
};

const cornice = (add: Add, width: number, y: number, depth: number, detailed: boolean) => {
  const courses = [[0, .018, .10], [.10, .04, .065], [.18, .065, .075]];
  for (const [lift, projection, thickness] of detailed ? courses : courses.slice(1))
    add({ position: [0, y + lift!, projection!], shape: "bevel-box", compactGeometry: true,
      size: [width, thickness!, depth + projection! * 2], surface: "paint",
      tint: lift === .10 ? COBALT : TURQUOISE });
};

/** Original geometric stucco, using dimensional carved rosettes rather than later tile murals. */
const reliefBand = (add: Add, width: number, y: number, z: number, detailed: boolean) => {
  add({ position: [0, y, z], shape: "bevel-box", compactGeometry: true,
    size: [width, .32, .085], surface: "paint", tint: COBALT });
  const count = detailed ? 3 : 1;
  for (let index = 0; index < count; index++) add({
    position: [(index - (count - 1) / 2) * width / count, y, z + .071],
    shape: "persian-palmette-panel", size: [width / count * .86, .25, .055],
    surface: "paint", worldUv: .875, tint: GOLD });
};

const domedHall = (add: Add, x: number, detailed: boolean) => {
  const local = turned(add, x, -1.125);
  // The real octagonal transition closes the corners between square walls and rounded shell.
  local({ position: [0, 3.575, 0], shape: "persian-transition",
    size: [2.65, .55, 2.65], surface: "paint", worldUv: .875, tint: TURQUOISE });
  local({ position: [0, 4.675, 0], shape: "persian-dome", roofSupport: true,
    size: [2.65, 1.65, 2.65], stage: 3, surface: "plaster", worldUv: .875, tint: [.91, .79, .61] });
  // Windows and doors remain actual gaps through all four square chamber walls.
  archedWall(turned(add, x, .20), 2.65, 3.4, .38, x === 0 ? 1.85 : 1.25, 0, 1.95, 1.10, detailed);
  archedWall(turned(add, x, -2.45, Math.PI), 2.65, 3.4, .38, 1.2, 0, 1.65, .90, detailed);
  reliefBand(turned(add, x, -2.24), 2.13, 2.93, .025, detailed);
  for (const side of [-1, 1]) local({ position: [side * .97, .18, 0], shape: "bevel-box",
    compactGeometry: true, size: [.28, .36, 1.9], surface: "cut-stone" });
};

const longFacades = (add: Add, detailed: boolean) => {
  const bays = [
    { centre: -3.275, height: 2.55, width: 1.65 },
    { centre: -1.125, height: 3.4, width: 2.65 },
    { centre: 1.175, height: 2.8, width: 1.95 },
    { centre: 3.125, height: 2.8, width: 1.95 }
  ];
  for (const side of [-1, 1]) {
    for (const bay of bays) {
      const local = turned(add, side * 3.86, bay.centre, side * Math.PI / 2);
      archedWall(local, bay.width, bay.height, .40, bay.width * .57, .68, 1.05, .74, detailed);
      cornice(local, bay.width, bay.height, .40, detailed);
      // Buttresses are bonded into the masonry, with broad worn dressed-stone footing.
      for (const end of [-1, 1]) {
        local({ position: [end * (bay.width / 2 - .09), 1.22, .23], shape: "bevel-box",
          compactGeometry: true, size: [.18, 2.44, .19], surface: "plaster" });
        local({ position: [end * (bay.width / 2 - .09), .19, .24], shape: "bevel-box",
          compactGeometry: true, size: [.26, .38, .20], surface: "cut-stone", tint: WARM_STONE });
      }
    }
  }
};

const frontIwan = (add: Add, detailed: boolean) => {
  for (const side of [-1, 1]) {
    archedWall(turned(add, side * 1.225, 2.15, side * Math.PI / 2),
      3.9, 3.15, .45, 2.15, 0, 1.7, 1.05, detailed);
    const wing = turned(add, side * 2.65, 3.90);
    archedWall(wing, 2.65, 2.8, .32, 1.35, 0, 1.55, 1.13, detailed);
    cornice(wing, 2.65, 2.79, .32, detailed);
    add({ position: [side * 2.65, 3.24, 2.15], shape: "persian-barrel", roofSupport: true,
      size: [2.42, .88, 3.9], stage: 3, surface: "plaster", worldUv: .875 });
    for (const z of [.24, 3.95]) vaultEnd(add, side * 2.65, z, 2.42, .88, 2.8, .18);
    add({ position: [side * 1.45, 1.575, 3.985], shape: "bevel-box", compactGeometry: true,
      size: [.32, 3.15, .36], surface: "plaster", tint: WARM_STONE });
    cornice(turned(add, side * 1.45, 3.885), .48, 3.10, .36, detailed);
  }
  add({ position: [0, 4, 2.15], shape: "persian-barrel", roofSupport: true,
    size: [2.9, 1.7, 3.9], stage: 3, surface: "plaster", worldUv: .875, tint: [.91, .80, .63] });
  vaultEnd(add, 0, .24, 2.9, 1.7, 3.15, .18);
  // A broad, thick archivolt visibly exposes the iwan's masonry rather than a thin drawn line.
  add({ position: [0, 4, 4], shape: "persian-barrel", size: [3.06, 1.76, .32],
    stage: 3, surface: "plaster", worldUv: .875, tint: GYPSUM });
  add({ position: [0, .125, 1.02], shape: "box", size: [.94, .01, 5.6],
    surface: "cloth", tint: [.39, .17, .10] });
  for (const side of [-1, 1]) add({ position: [side * .43, .132, 1.02], shape: "box",
    size: [.04, .008, 5.6], surface: "cloth", tint: [.83, .61, .27] });
};

const rearCourt = (add: Add, detailed: boolean) => {
  for (const x of HALL_CENTRES) {
    const local = turned(add, x, -3.92, Math.PI);
    archedWall(local, 2.65, 2.35, .28, 1.25, 0, 1.3, .85, detailed);
    cornice(local, 2.65, 2.34, .28, detailed);
  }
  for (const side of [-1, 1]) {
    add({ position: [side * 3.3, 2.57, -3.20], shape: "persian-barrel", roofSupport: true,
      size: [1.13, .58, 1.61], stage: 3, surface: "plaster", worldUv: .875 });
    for (const z of [-3.95, -2.47]) vaultEnd(add, side * 3.3, z, 1.13, .58, 2.28, .15);
    for (const z of [-3.90, -2.52]) add({ position: [side * 2.80, 1.14, z],
      shape: "bevel-box", compactGeometry: true, size: [.25, 2.28, .25], surface: "plaster" });
  }
};


/** Bonded portal stucco and ceremonial wall friezes, retaining the Persian rounded-vault silhouette. */
const ceremonialOrnament = (add: Add, detailed: boolean) => {
  const panel = (x: number, y: number, z: number, width: number, height: number, yaw = 0) =>
    add({ position: [x, y, z], rotation: [0, yaw, 0], shape: "persian-palmette-panel",
      size: [width, height, .075], stage: 4, surface: "paint", tint: GOLD });
  for (let index = 0; index < 12; index++) {
    const angle = (index + .5) / 12 * Math.PI;
    add({ position: [Math.cos(angle) * 1.49, 3.12 + Math.sin(angle) * 1.73, detailed ? 4.165 : 4.1605],
      rotation: [0, 0, Math.atan2(1.73 * Math.cos(angle), -1.49 * Math.sin(angle))],
      shape: detailed ? "persian-palmette-panel" : "paint-ellipse", compactGeometry: true,
      size: detailed ? [.21, .07, .03] : [.052, .035, .001], stage: 4,
      surface: "paint", tint: OCHRE });
  }
  for (const side of [-1, 1]) {
    panel(side * 1.45, 1.76, 4.155, .245, 1.70);
    panel(side * 3.72, 1.43, 4.08, .26, 1.50);
    panel(side * 2.65, 2.99, 4.08, 2.22, .22);
    // Restrained red ochre runs on existing masonry cornices articulate the two broad wings.
    add({ position: [side * 2.65, 2.855, 4.09], shape: "box", size: [2.45, .035, .025],
      stage: 4, surface: "paint", tint: [.48, .20, .12] });
    if (detailed) for (const z of [1.05, 3.1])
      panel(side * 1.015, 3.0, z, 1.35, .22, -side * Math.PI / 2);
  }
};

/** Original compact game adaptation of the intact Ardashir palace audience sequence, not an exact restoration. */
export const persianArdashirMonumentRecipe = (detailed: boolean): BuildingRecipe => {
  const parts: BuildingPart[] = [], add: Add = part => parts.push({ stage: 1, ...part });
  add({ position: [0, .06, 0], shape: "box", size: [8.2, .12, 8.2], surface: "cut-stone" });
  for (const x of HALL_CENTRES) domedHall(add, x, detailed);
  for (const side of [-1, 1]) archedWall(turned(add, side * 1.325, -1.125, Math.PI / 2),
    2.65, 3.4, .38, 1.15, 0, 1.65, .90, detailed);
  longFacades(add, detailed);
  frontIwan(add, detailed);
  rearCourt(add, detailed);
  ceremonialOrnament(add, detailed);
  return { ...monumentRecipe(), parts };
};
