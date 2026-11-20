import { MILL_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { RoofEnvelope, WallRun } from "./nation-kit-classify";
import {
  alongWall, envelopeCenter, envelopeSize, type KitContext,
meetsCorner, onWall, wallNormal} from "./nation-kit-parts";

const BEAM_SPACING = .3;
const MERLON_SPACING = .24;
/** Two brick courses (the map lays twelve per unit), so the footing ends on a bed joint. */
const PLINTH_HEIGHT = 2 / 12;
const PLINTH_PROJECTION = .025;

/**
 * High only: the bottom courses stand proud of the wall face (a footing course against splash
 * erosion), turning round each real corner; the brick map shows through on both.
 */
const nubianPlinth = (context: KitContext, wall: WallRun) => {
  const { center, walls } = context, normal = wallNormal(wall, center);
  const start = meetsCorner(wall, walls, 0) ? PLINTH_PROJECTION : 0;
  const end = meetsCorner(wall, walls, 1) ? PLINTH_PROJECTION : 0;
  context.add({ position: onWall(wall, center, .5 + (end - start) / 2 / wall.length, wall.base + PLINTH_HEIGHT / 2),
    shape: "box",
    size: alongWall(wall, wall.length + start + end, PLINTH_HEIGHT, normal.thickness + PLINTH_PROJECTION * 2),
    stage: 1, surface: "plaster" });
};

/** Thick mud brick; High adds a footing course and rows of palm-beam ends projecting from the outer face. */
export const nubianWall = (context: KitContext, wall: WallRun) => {
  const { add, center, detailed } = context, normal = wallNormal(wall, center), thickness = normal.thickness + .06;
  // The extra thickness grows indoors, so outer faces stay on the original plot line.
  add({ position: onWall(wall, center, .5, wall.base + wall.height / 2, -.03), shape: "box",
    size: alongWall(wall, wall.length, wall.height, thickness), stage: 1, surface: "plaster" });
  if (!detailed || context.lean) return;
  if (wall.base < .1) nubianPlinth(context, wall);
  if (wall.length < .45 || wall.height < .6) return;
  const beams = Math.max(1, Math.floor(wall.length / BEAM_SPACING));
  // Mill sails pass immediately in front of the brickwork: seat their timber ends inside it.
  const millFront = context.typeId === MILL_TYPE_ID && normal.axis === 2 && normal.sign > 0;
  const beamProjection = millFront ? -.035 : .05;
  for (let index = 0; index < beams; index++) add({
    position: onWall(wall, center, (index + .5) / beams,
      wall.base + wall.height * .78, normal.thickness / 2 + beamProjection),
    rotation: wall.along === 0 ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2],
    shape: "cylinder", size: [.04, .12, .04], stage: 3, surface: "wood"
  });
};

/**
 * Flat earthen terrace behind a parapet, tapered pinnacles at the corners; the main roof gets a dome
 * unless a cupola already stands on it (`crowned`).
 */
export const nubianRoof = (context: KitContext, roof: RoofEnvelope, main: boolean, crowned = false) => {
  const { add, detailed } = context, size = envelopeSize(roof), base = envelopeCenter(roof);
  const inset = .06, width = size.width - inset * 2, depth = size.depth - inset * 2, y = base[1];
  add({ position: [base[0], y + .03, base[2]], shape: "box", size: [width, .06, depth], stage: 3, surface: "roof" });
  for (const side of [-1, 1]) {
    add({ position: [base[0], y + .12, base[2] + side * (depth / 2 - .05)], shape: "box", size: [width, .2, .1],
      stage: 3, surface: "plaster" });
    add({ position: [base[0] + side * (width / 2 - .05), y + .12, base[2]], shape: "box", size: [.1, .2, depth],
      stage: 3, surface: "plaster" });
  }
  // Lean buildings keep pinnacles on the main roof only.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    if (context.lean && !main) break;
    const x = base[0] + sx * (width / 2 - .08), z = base[2] + sz * (depth / 2 - .08);
    add({ position: [x, y + .2, z], shape: "cylinder", size: [.17, .4, .17], stage: 3, surface: "plaster",
      topScale: [.8, 1, .8] });
    add({ position: [x, y + .48, z], shape: "cone", size: [.15, .18, .15], stage: 3, surface: "plaster" });
  }
  if (main && !crowned && !context.lean) add({ position: [base[0], y + .04, base[2]], shape: "dome",
    size: [Math.min(1, width * .55), Math.min(.5, width * .3), Math.min(1, depth * .55)], stage: 4, surface: "roof" });
  if (!detailed || context.lean) return;
  for (const side of [-1, 1]) for (let x = -width / 2 + .3; x <= width / 2 - .3; x += MERLON_SPACING)
    add({ position: [base[0] + x, y + .27, base[2] + side * (depth / 2 - .05)], shape: "cone", size: [.08, .1, .08],
      stage: 3, surface: "plaster" });
};

/** A raised plaster arch frame and a wooden lintel over the shared arched leaf. */
export const nubianDoor = (context: KitContext) => {
  const { add, door } = context;
  add({ position: [(door.left + door.right) / 2, door.top + .06, door.z + .04], shape: "box",
    size: [door.right - door.left + .14, .08, .06], stage: 2, surface: "wood" });
  for (const x of [door.left - .07, door.right + .07]) add({ position: [x, door.top / 2 + .1, door.z + .03],
    shape: "box", size: [.1, door.top + .2, .08], stage: 2, surface: "plaster" });
};
