import { DMath } from "../../shared/math/deterministic-math";
import type { WorkerNation } from "../workers/worker-unit";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { addRoofVentWindow } from "./levels/level-roof-vent";
import { type Add, type DoorGap, doorGapOf } from "./nation-kit-parts";
import { JAPANESE_ROOF_TINTS, japaneseRoofClass, japaneseRoofUnderside } from "./nation-roof-palette";
import { nationRoofMeshHeight } from "./nation-roof-profile";
import { addShingledSlab, shingledSlopeYaw } from "./nation-roof-shingles";
import { gableDragon } from "./viking-gable-dragon";

/** Woodcutter body envelope shared by every nation (Roman authoring space). */
const BODY = { depth: 1.15, height: 1.17, width: 1.64 } as const;
const HALF_X = BODY.width / 2, HALF_Z = BODY.depth / 2;
const JAPANESE_ROOF_HEIGHT = .55;
/** Centre height of the kept Woodcutter pictogram (its Roman tablet is replaced). */
const NUBIAN_SIGN_HEIGHT = 1.09;
/**
 * Board behind the kept Roman pictogram (centred 1.09 high, its back layer 0.103 in front of the
 * wall line): the board face stays just behind it, its back sunk into the front logs.
 */
const VIKING_SIGN = { depth: .05, face: HALF_Z + .102, height: .21, width: .33, y: 1.09 } as const;
const PROP_SURFACES = new Set(["amber", "axe-head", "bark", "endgrain", "iron", "mosaic", "paint", "rope", "steel"]);


/** Keep stock, work props and everything outside the walls; walls, roof and quoins are replaced. */
const keepsPart = (part: BuildingPart) => {
  if (part.stock || PROP_SURFACES.has(part.surface) || part.shape === "axe-head" || part.shape === "cord") return true;
  const outside = Math.abs(part.position[0]) > HALF_X + .05 || part.position[2] > HALF_Z + .08;
  return outside && part.position[1] < BODY.height;
};

/** Front-wall pieces either side of (and above) the doorway, at `z` with the given thickness. */
const frontWall = (add: Add, gap: DoorGap, z: number, thickness: number, surface: BuildingPart["surface"],
  stage = 1, bottom = 0) => {
  const height = BODY.height - bottom, y = bottom + height / 2;
  const leftWidth = gap.left + HALF_X, rightWidth = HALF_X - gap.right;
  add({ position: [-HALF_X + leftWidth / 2, y, z], shape: "box", size: [leftWidth, height, thickness], stage, surface });
  add({ position: [gap.right + rightWidth / 2, y, z], shape: "box", size: [rightWidth, height, thickness], stage, surface });
  const lintel = BODY.height - gap.top;
  add({ position: [(gap.left + gap.right) / 2, gap.top + lintel / 2, z], shape: "box",
    size: [gap.right - gap.left, lintel, thickness], stage, surface });
  for (const side of [-1, 1]) add({ position: [(gap.left + gap.right) / 2 + side * (gap.right - gap.left) / 4,
    gap.spring + (gap.top - gap.spring) / 2, z], rotation: side < 0 ? undefined : [0, 0, Math.PI / 2] as Point3,
  shape: "arch-spandrel", size: [(gap.right - gap.left) / 2, gap.top - gap.spring, thickness], stage, surface });
};

/** High only: shingled ridge roll, smoke vent, field-stone sill, window sill and shield. */
const vikingDetail = (add: Add, roof: { eave: number; rise: number }) => {
  const { eave, rise } = roof;
  add({ position: [0, eave + rise + .06, 0], rotation: [0, 0, Math.PI / 2], shape: "cylinder",
    size: [.2, BODY.width + .2, .2], stage: 4, surface: "roof" });
  const middle = eave + rise + .14;
  for (const x of [-1, 1]) for (const z of [-1, 1])
    add({ position: [.3 + x * .065, middle, z * .065], shape: "box", size: [.03, .1, .03],
      stage: 4, surface: "wood" });
  for (const axis of [0, 2] as const) for (const side of [-1, 1]) {
    const face: Point3 = [.3, middle, 0], outward: Point3 = [0, 0, 0];
    face[axis] += side * .065; outward[axis] = side;
    addRoofVentWindow({ add, detailed: true }, face, outward, .1, .08);
  }
  add({ position: [.3, eave + rise + .21, 0], rotation: [0, 0, Math.PI / 2], shape: "gable", size: [.22, .08, .22],
    stage: 4, surface: "roof" });
  const stones = (from: Point3, to: Point3) => {
    const span = DMath.hypot(to[0] - from[0], to[2] - from[2]), count = Math.max(1, Math.round(span / .17));
    for (let index = 0; index < count; index++) {
      const t = (index + .5) / count;
      add({ position: [from[0] + (to[0] - from[0]) * t, .06, from[2] + (to[2] - from[2]) * t], shape: "stone-block",
        size: [.17, .12, .17], stage: 1, surface: "stone" });
    }
  };
  stones([-HALF_X - .05, 0, -HALF_Z - .05], [HALF_X + .05, 0, -HALF_Z - .05]);
  stones([-HALF_X - .05, 0, HALF_Z + .05], [HALF_X + .05, 0, HALF_Z + .05]);
  for (const x of [-HALF_X - .05, HALF_X + .05]) stones([x, 0, -HALF_Z + .1], [x, 0, HALF_Z - .1]);
  add({ position: [HALF_X + .1, .49, 0], shape: "bevel-box", size: [.07, .04, .3], stage: 2, surface: "wood" });
  // The shield hangs right of the door frame, clear of the door leaf's swing.
  const shield: Point3 = [.48, .86, HALF_Z + .09];
  add({ position: shield, rotation: [Math.PI / 2, 0, 0], shape: "cylinder", size: [.3, .035, .3], stage: 3,
    surface: "wood" });
  for (const side of [-1, 1]) add({ position: [shield[0] + side * .075, shield[1], HALF_Z + .11], shape: "box",
    size: [.15, .26, .005], stage: 3, surface: "paint", tint: side < 0 ? [.62, .14, .1] : [.86, .8, .62] });
  add({ position: [shield[0], shield[1], HALF_Z + .13], shape: "sphere", size: [.07, .07, .05], stage: 3,
    surface: "iron" });
};

/** Log house: notched overhanging courses, steep shingles, crossed gable boards with dragon heads. */
const vikingWoodcutter = (add: Add, gap: DoorGap, detailed: boolean) => {
  for (const [x, z, w, d] of [[0, -HALF_Z, BODY.width + .16, .14], [0, HALF_Z, BODY.width + .16, .14],
    [-HALF_X, 0, .14, BODY.depth], [HALF_X, 0, .14, BODY.depth]] as const)
    add({ position: [x, .05, z], shape: "bevel-box", size: [w, .1, d], stage: 1, surface: "stone" });
  // Every wall gets a log each course; the cross walls sit half a course higher (notched corners).
  // The courses run up to the eave, so the gables and roof slopes bear on the top logs.
  const course = .12, overhang = .1, log = .13;
  const bottom = .16, top = bottom + (Math.ceil((BODY.height - bottom) / course) - 1) * course;
  for (let y = bottom; y <= top + .001; y += course) {
    for (const z of [-HALF_Z, HALF_Z]) {
      const front = z > 0 && y < gap.top + .04;
      const spans: Array<[number, number]> = front
        ? [[-HALF_X - overhang, gap.left - .03], [gap.right + .03, HALF_X + overhang]]
        : [[-HALF_X - overhang, HALF_X + overhang]];
      for (const [from, to] of spans) add({ position: [(from + to) / 2, y, z], rotation: [0, 0, Math.PI / 2],
        shape: "cylinder", size: [log, to - from, log], stage: 1, surface: "bark" });
    }
    for (const x of [-HALF_X, HALF_X]) add({ position: [x, y + course / 2, 0], rotation: [Math.PI / 2, 0, 0],
      shape: "cylinder", size: [log, BODY.depth + overhang * 2, log], stage: 1, surface: "bark" });
  }
  for (const x of [gap.left - .035, gap.right + .035]) add({ position: [x, gap.top / 2 + .05, HALF_Z + .04],
    shape: "bevel-box", size: [.07, gap.top + .1, .1], stage: 2, surface: "wood" });
  add({ position: [(gap.left + gap.right) / 2, gap.top + .07, HALF_Z + .04], shape: "bevel-box",
    size: [gap.right - gap.left + .2, .1, .11], stage: 2, surface: "wood" });
  // Plank spandrels close the corners between the shared arched door leaf and the square frame.
  for (const side of [-1, 1]) add({ position: [(gap.left + gap.right) / 2 + side * (gap.right - gap.left) / 4,
    gap.spring + (gap.top - gap.spring) / 2, HALF_Z], rotation: side < 0 ? undefined : [0, 0, Math.PI / 2] as Point3,
  shape: "arch-spandrel", size: [(gap.right - gap.left) / 2, gap.top - gap.spring, .1], stage: 2, surface: "wood" });
  const rise = .7, run = HALF_Z + .14, slope = DMath.atan2(rise, run), length = DMath.hypot(rise, run);
  const eave = BODY.height + .04;
  // Wall plates: one more log on the long walls, seated under the roof slopes.
  for (const z of [-HALF_Z, HALF_Z]) add({ position: [0, top + course, z], rotation: [0, 0, Math.PI / 2],
    shape: "cylinder", size: [log, BODY.width + overhang * 2, log], stage: 1, surface: "bark" });
  // A carved board on the front logs carries the kept occupation pictogram.
  add({ position: [0, VIKING_SIGN.y, VIKING_SIGN.face - VIKING_SIGN.depth / 2], shape: "bevel-box",
    size: [VIKING_SIGN.width, VIKING_SIGN.height, VIKING_SIGN.depth], stage: 3, surface: "wood" });
  // A positive x rotation lowers the +z end, so each slab falls from the ridge to its own eave.
  for (const side of [-1, 1]) addShingledSlab(add, { bare: .03, centre: [0, eave + rise / 2, side * run / 2],
    depth: length + .05, length: BODY.width + .24, slope, yaw: shingledSlopeYaw(true, side) }, detailed);
  for (const x of [-HALF_X, HALF_X]) add({ position: [x, eave + rise / 2 - .02, 0], rotation: [0, Math.PI / 2, 0],
    shape: "gable", size: [BODY.depth + .1, rise - .04, .1], stage: 3, surface: "planks" });
  add({ position: [0, eave + rise + .04, 0], rotation: [0, 0, Math.PI / 2], shape: "cylinder",
    size: [.11, BODY.width + .3, .11], stage: 4, surface: "bark" });
  const past = .28, cos = DMath.cos(slope), sin = DMath.sin(slope);
  for (const x of [-HALF_X - .14, HALF_X + .14]) for (const side of [-1, 1]) {
    // Each barge board runs up its slope and past the ridge, crossing its partner in an X.
    add({ position: [x, eave + rise / 2 + past / 2 * sin + .06, side * (run / 2 - past / 2 * cos)],
      rotation: [side * slope, 0, 0], shape: "bevel-box", size: [.045, .07, length + past], stage: 4, surface: "wood" });
    const tip: Point3 = [x, eave + rise + past * sin + .06, -side * past * cos];
    add(gableDragon([x, eave + .06, side * run], tip));
  }
  add({ position: [HALF_X + .07, .62, 0], shape: "box", size: [.02, .24, .2], stage: 2, surface: "dark" });
  for (const side of [-1, 1]) add({ position: [HALF_X + .085, .62, side * .16], rotation: [0, side * .5, 0],
    shape: "bevel-box", size: [.025, .26, .12], stage: 3, surface: "wood" });
  if (detailed) vikingDetail(add, { eave, rise });
};

/** High only: mud merlons, battered side buttresses, lattice window with a straw awning, water jar. */
const nubianDetail = (add: Add) => {
  for (const z of [-HALF_Z + .02, HALF_Z - .02]) for (let x = -HALF_X + .3; x <= HALF_X - .3; x += .22)
    add({ position: [x, BODY.height + .2, z], shape: "cone", size: [.09, .12, .09], stage: 3, surface: "plaster" });
  for (const x of [-HALF_X - .1, HALF_X + .1]) for (const z of [-.28, .28]) add({ position: [x, .45, z], shape: "box",
    size: [.12, .9, .16], stage: 2, surface: "plaster", topScale: [.45, 1, .7] });
  add({ position: [HALF_X + .1, .66, 0], shape: "box", size: [.02, .22, .24], stage: 2, surface: "dark" });
  for (let index = -2; index <= 2; index++) add({ position: [HALF_X + .115, .66, index * .045], shape: "box",
    size: [.012, .22, .012], stage: 3, surface: "wood" });
  add({ position: [HALF_X + .16, .83, 0], rotation: [0, 0, -.45], shape: "box", size: [.22, .025, .38], stage: 3,
    surface: "straw" });
  for (const z of [-.17, .17]) add({ position: [HALF_X + .25, .7, z], shape: "cylinder", size: [.02, .3, .02],
    stage: 3, surface: "wood" });
  add({ position: [HALF_X + .14, .1, -.3], shape: "sphere", size: [.18, .2, .18], stage: 3, surface: "roof" });
  add({ position: [HALF_X + .14, .22, -.3], shape: "cylinder", size: [.08, .06, .08], stage: 3, surface: "roof" });
};

/** Sahelian mud brick: buttressed walls, corner pinnacles, beam ends, dome and painted band. */
const nubianWoodcutter = (add: Add, gap: DoorGap, detailed: boolean) => {
  frontWall(add, gap, HALF_Z, .18, "plaster", 1);
  add({ position: [0, BODY.height / 2, -HALF_Z], shape: "box", size: [BODY.width, BODY.height, .18], stage: 1, surface: "plaster" });
  for (const x of [-HALF_X, HALF_X]) add({ position: [x, BODY.height / 2, 0], shape: "box",
    size: [.18, BODY.height, BODY.depth], stage: 1, surface: "plaster" });
  for (const x of [-HALF_X, HALF_X]) for (const z of [-HALF_Z, HALF_Z]) {
    add({ position: [x, (BODY.height + .18) / 2, z], shape: "cylinder", size: [.26, BODY.height + .18, .26],
      stage: 2, surface: "plaster", topScale: [.85, 1, .85] });
    add({ position: [x, BODY.height + .3, z], shape: "cone", size: [.22, .24, .22], stage: 2, surface: "plaster" });
  }
  for (const x of [gap.left - .1, gap.right + .1]) {
    add({ position: [x, (BODY.height + .3) / 2, HALF_Z + .07], shape: "box", size: [.12, BODY.height + .3, .1],
      stage: 2, surface: "plaster" });
    add({ position: [x, BODY.height + .4, HALF_Z + .07], shape: "cone", size: [.13, .2, .13], stage: 2, surface: "plaster" });
  }
  for (const y of [.42, .92]) for (let x = -HALF_X + .25; x < HALF_X - .1; x += .27) {
    if (y < gap.top + .05 && x > gap.left - .2 && x < gap.right + .2) continue;
    add({ position: [x, y, HALF_Z + .13], rotation: [Math.PI / 2, 0, 0], shape: "cylinder", size: [.045, .14, .045],
      stage: 3, surface: "wood" });
  }
  for (const side of [-1, 1]) add({ position: [0, BODY.height + .08, side * (HALF_Z - .02)], shape: "box",
    size: [BODY.width, .16, .14], stage: 3, surface: "plaster" });
  // The Nubian roof material is the earthen terrace finish: it covers the terrace and the dome.
  add({ position: [0, BODY.height - .02, 0], shape: "box", size: [BODY.width - .1, .05, BODY.depth - .1], stage: 3,
    surface: "roof" });
  add({ position: [.12, BODY.height, -.05], shape: "dome", size: [.9, .5, .78], stage: 4, surface: "roof" });
  // Plaster plaque carrying the kept occupation pictogram, flush with the front wall face.
  add({ position: [0, NUBIAN_SIGN_HEIGHT, HALF_Z + .096], shape: "box", size: [.31, .18, .012], stage: 3,
    surface: "plaster" });
  for (let index = 0; index < 8; index++) {
    const x = -HALF_X + .2 + index * .18;
    if (x > gap.left - .14 && x < gap.right + .14) continue;
    add({ position: [x, 1.02, HALF_Z + .095], shape: "paint-triangle", size: [.16, .13, .01], stage: 3,
      surface: "paint", tint: index % 2 ? [.24, .3, .62] : [.78, .42, .16] });
  }
  add({ position: [(gap.left + gap.right) / 2, gap.top + .06, HALF_Z + .1], shape: "box",
    size: [gap.right - gap.left + .14, .08, .06], stage: 2, surface: "wood" });
  if (detailed) nubianDetail(add);
};

/** High only: hip ridge tiles, cut-stone plinth blocks, door stepping stone, reed blind, paper lantern. */
/** A tile run between two points, lying along the line from `from` to `to`. */
const tileRun = (add: Add, from: Point3, to: Point3, width: number, lift = .03) => {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], horizontal = DMath.hypot(dx, dz);
  add({ position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + lift, (from[2] + to[2]) / 2],
    rotation: [DMath.atan2(-dy, horizontal), DMath.atan2(dx, dz), 0], shape: "bevel-box",
    size: [width, .06, DMath.hypot(horizontal, dy) + .02], stage: 4, surface: "roof" });
};

/** The woodcutter roof turned a quarter: local z runs along world x (see japaneseWoodcutter). */
const japaneseRoofPoint = (roof: { base: number; depth: number; length: number }, x: number, z: number): Point3 =>
  [z * roof.length, roof.base + nationRoofMeshHeight("japanese", true, x, z) * JAPANESE_ROOF_HEIGHT, -x * roof.depth];

const japaneseDetail = (add: Add, roof: { base: number; depth: number; length: number }) => {
  // Hip ridges follow the concave surface in short runs seated into the tiles (a long straight
  // run would bridge the curve and float), then curl up at the swept corner.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const points = Array.from({ length: 13 }, (_, index) => .88 * index / 12)
      .map(t => japaneseRoofPoint(roof, sx * .5 * t, sz * (.25 + .25 * t)));
    for (let index = 1; index < points.length; index++) tileRun(add, points[index - 1]!, points[index]!, .08, .015);
    const corner = points.at(-1)!, outward = .015;
    const tip: Point3 = [corner[0] + Math.sign(corner[0]) * outward, corner[1] + .13,
      corner[2] + Math.sign(corner[2]) * outward];
    tileRun(add, corner, tip, .07, .02);
    add({ position: [tip[0], tip[1] + .05, tip[2]], shape: "cone", size: [.05, .09, .05], stage: 4, surface: "roof" });
  }
  for (let x = -HALF_X; x <= HALF_X + .01; x += BODY.width / 6) for (const z of [-HALF_Z - .05, HALF_Z + .05])
    add({ position: [x, .06, z], shape: "stone-block", size: [.28, .12, .1], stage: 1, surface: "cut-stone" });
  add({ position: [0, .012, HALF_Z + .22], shape: "bevel-box", size: [.42, .024, .24], stage: 1, surface: "cut-stone" });
  add({ position: [.53, .935, HALF_Z + .045], shape: "box", size: [.32, .045, .035], stage: 3, surface: "straw" });
  add({ position: [-.62, .93, HALF_Z + .2], shape: "sphere", size: [.13, .18, .13], stage: 3, surface: "cloth",
    tint: [1, .86, .7] });
  for (const dy of [-.095, .095]) add({ position: [-.62, .93 + dy, HALF_Z + .2], shape: "cylinder",
    size: [.09, .02, .09], stage: 3, surface: "dark" });
  add({ position: [-.62, 1.08, HALF_Z + .2], shape: "cylinder", size: [.01, .12, .01], stage: 3, surface: "rope" });
};

/** Minka: stone plinth, dark post-and-beam frame with white plaster, irimoya roof with ridge tiles. */
const japaneseWoodcutter = (add: Add, gap: DoorGap, detailed: boolean) => {
  add({ position: [0, .06, 0], shape: "bevel-box", size: [BODY.width + .1, .12, BODY.depth + .1], stage: 1,
    surface: "cut-stone" });
  frontWall(add, gap, HALF_Z, .07, "plaster", 1, .12);
  add({ position: [0, .64, -HALF_Z], shape: "box", size: [BODY.width, BODY.height - .12, .07], stage: 1, surface: "plaster" });
  for (const x of [-HALF_X, HALF_X]) add({ position: [x, .64, 0], shape: "box", size: [.07, BODY.height - .12, BODY.depth],
    stage: 1, surface: "plaster" });
  const posts = [-HALF_X, gap.left - .04, gap.right + .04, HALF_X];
  for (const x of posts) add({ position: [x, .66, HALF_Z + .02], shape: "box", size: [.08, 1.08, .08], stage: 2, surface: "wood" });
  for (const x of [-HALF_X, 0, HALF_X]) add({ position: [x, .66, -HALF_Z - .02], shape: "box", size: [.08, 1.08, .08],
    stage: 2, surface: "wood" });
  for (const z of [-HALF_Z / 2, HALF_Z / 2]) for (const x of [-HALF_X - .02, HALF_X + .02])
    add({ position: [x, .66, z], shape: "box", size: [.08, 1.08, .08], stage: 2, surface: "wood" });
  for (const y of [.42, 1.12]) {
    for (const z of [-HALF_Z - .03, HALF_Z + .03]) {
      if (z > 0 && y < gap.top) {
        for (const [from, to] of [[-HALF_X, gap.left - .04], [gap.right + .04, HALF_X]] as const)
          add({ position: [(from + to) / 2, y, z], shape: "box", size: [to - from, .06, .05], stage: 2, surface: "wood" });
        continue;
      }
      add({ position: [0, y, z], shape: "box", size: [BODY.width + .04, .06, .05], stage: 2, surface: "wood" });
    }
    for (const x of [-HALF_X - .03, HALF_X + .03]) add({ position: [x, y, 0], shape: "box", size: [.05, .06, BODY.depth],
      stage: 2, surface: "wood" });
  }
  for (const [from, to] of [[-HALF_X, gap.left - .04], [gap.right + .04, HALF_X]] as const)
    add({ position: [(from + to) / 2, .27, HALF_Z + .045], shape: "box", size: [to - from, .3, .03], stage: 2,
      surface: "planks" });
  const window = { x: (gap.right + HALF_X) / 2, y: .76 };
  // An open workshop window, with jambs and a sill outside its clear aperture.
  for (const side of [-1, 1]) add({ position: [window.x + side * .17, window.y, HALF_Z + .0425],
    shape: "box", size: [.04, .32, .055], stage: 2, surface: "wood" });
  add({ position: [window.x, window.y, HALF_Z + .05], shape: "box", size: [.3, .24, .02], stage: 2, surface: "dark" });
  for (const dy of [-.14, .14]) add({ position: [window.x, window.y + dy, HALF_Z + .0425], shape: "box",
    size: [.38, .04, .055], stage: 2, surface: "wood" });
  // The profile's flat ridge runs along its depth, so the roof turns to put the ridge along the width.
  // The mesh's flat ridge spans its middle half (vertex rows land on the quarters), matching the tiles.
  const roof = { base: BODY.height + .25, depth: BODY.depth + .5, length: BODY.width + .5 };
  const ridgeTop = roof.base + JAPANESE_ROOF_HEIGHT / 2, ridge = roof.length / 2;
  const tiled: BuildingPart = { position: [0, roof.base, 0], roofProfile: "japanese", rotation: [0, Math.PI / 2, 0],
    shape: "nation-roof", size: [roof.depth, JAPANESE_ROOF_HEIGHT, roof.length], stage: 4, surface: "roof" };
  add(tiled);
  for (const part of japaneseRoofUnderside(tiled, japaneseRoofClass(17), detailed)) add(part);
  // Both grids land on the ridge ends, so the ridge tiles sit on the flat ridge in either quality.
  if (detailed) japaneseDetail(add, roof);
  add({ position: [0, ridgeTop + .025, 0], shape: "bevel-box", size: [ridge, .07, .12], stage: 4, surface: "roof" });
  for (const x of [-ridge / 2, ridge / 2]) add({ position: [x, ridgeTop + .07, 0], shape: "bevel-box",
    size: [.1, .16, .16], stage: 4, surface: "roof" });
};

const DESIGNS: Partial<Record<WorkerNation, (add: Add, gap: DoorGap, detailed: boolean) => void>> = {
  japanese: japaneseWoodcutter, nubian: nubianWoodcutter, viking: vikingWoodcutter
};

/** Pilot: a nation-specific Woodcutter on the original plot, door, stock and work anchors. */
export const createNationWoodcutterRecipe = (original: BuildingRecipe, nation: WorkerNation, detailed: boolean) => {
  const design = DESIGNS[nation];
  if (!design) return null;
  const parts = original.parts.filter(keepsPart);
  // Japanese tiles take their colour from the part tint (the Woodcutter is a kawara workshop).
  const tint = nation === "japanese" ? JAPANESE_ROOF_TINTS[japaneseRoofClass(17)] : undefined;
  design(part => parts.push({ stage: 1, ...part, ...(tint && part.surface === "roof" ? { tint } : {}) }),
    doorGapOf(original), detailed);
  return { ...original, parts };
};
