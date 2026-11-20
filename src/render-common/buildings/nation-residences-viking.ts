import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingRecipe, Point3 } from "./building-recipe";
import { timberWindowFrame } from "./nation-kit-parts";
import { vikingDoor, vikingRoof, vikingWall } from "./nation-kit-viking";
import {
  addRoomFloor, finishResidence, frontPane, residenceKit, type ResidenceSite, roofOver, type Room, roomWalls
} from "./nation-residence-kit";
import { addTurfRoof, addTurfTufts } from "./nation-residences-viking-turf";
import { gableDragon } from "./viking-gable-dragon";

const TIMBER_FRAME_DEPTH = .045;

/** A small shuttered window in the front wall, in a timber frame. */
const frontWindow = (site: ResidenceSite, x: number, y: number) => {
  const pane = frontPane(site, x, y, [.22, .22]);
  pane.position[2] = site.front + .055 + TIMBER_FRAME_DEPTH - .008 - .01;
  site.add(pane);
  timberWindowFrame(site.add, pane, 0, site.front + .055, TIMBER_FRAME_DEPTH);
  if (!site.detailed) return;
  for (const side of [-1, 1]) site.add({ position: [x + side * .19, y, site.front + .08], rotation: [0, side * .5, 0],
    shape: "bevel-box", size: [.12, .24, .025], stage: 3, surface: "wood" });
};

/** Split firewood stacked against a wall between two stakes (a Norse household's winter store). */
const woodpile = (site: ResidenceSite, centre: Point3, length: number) => {
  const rows = site.detailed ? 3 : 2;
  for (let row = 0; row < rows; row++) for (const offset of [-.05, .05]) site.add({
    position: [centre[0], .05 + row * .09, centre[2] + offset + (row % 2) * .02], rotation: [0, 0, Math.PI / 2],
    shape: "cylinder", size: [.09, length, .09], stage: 3, surface: "bark" });
  for (const side of [-1, 1]) site.add({ position: [centre[0] + side * (length / 2 + .03), .17, centre[2]],
    shape: "box", size: [.04, .34, .04], stage: 3, surface: "wood" });
};

/**
 * Small residence: a notched log cabin under a sod roof on birch bark, a ridge smoke hole, a
 * shuttered window and the winter woodpile by the door.
 */
const vikingCottage = (site: ResidenceSite) => {
  const room: Room = { back: -1.05, base: 0, front: site.front, height: site.wallTop, x0: -1, x1: 1 };
  const walls = roomWalls(room, site.door), kit = residenceKit(site, walls);
  for (const wall of walls) vikingWall(kit, wall, true);
  vikingDoor(kit);
  addRoomFloor(site, room);
  const turf = { back: -1.12, eave: room.height, front: site.front + .14, rise: .62, x0: -1.07, x1: 1.07 };
  addTurfRoof(site, turf);
  if (site.detailed) addTurfTufts(site, [0, turf.eave + turf.rise, (turf.back + turf.front) / 2], 1.6);
  frontWindow(site, .45, .55);
  woodpile(site, [.66, 0, site.front + .2], .5);
};

/** Medium residence: a stave house under a dragon-gabled shingle roof, with a lean-to woodshed on the east. */
const vikingHouse = (site: ResidenceSite) => {
  const room: Room = { back: -1.15, base: 0, front: site.front, height: site.wallTop, x0: -1.45, x1: .95 };
  const walls = roomWalls(room, site.door), kit = residenceKit(site, walls);
  for (const wall of walls) vikingWall(kit, wall, false);
  vikingDoor(kit);
  addRoomFloor(site, room);
  vikingRoof(kit, roofOver([-1.56, -1.24], [1.06, site.front + .1], room.height, room.height + .8, .8));
  frontWindow(site, .35, .58);
  // Woodshed: two posts and a shingled pent roof falling away from the house wall.
  const shed = { eave: .72, top: room.height - .06, x0: room.x1, x1: 1.47 };
  for (const z of [-.9, .2]) site.add({ position: [1.44, shed.eave / 2, z], shape: "bevel-box",
    size: [.07, shed.eave, .07], stage: 2, surface: "wood" });
  site.add({ position: [1.44, shed.eave + .02, -.35], shape: "bevel-box", size: [.08, .06, 1.2], stage: 2, surface: "wood" });
  const run = shed.x1 - shed.x0 + .06, drop = shed.top - shed.eave, slope = DMath.atan2(drop, run);
  site.add({ position: [(shed.x0 + shed.x1) / 2 + .03, (shed.top + shed.eave) / 2 + .06, -.35],
    rotation: [0, 0, -slope], shape: "box", size: [DMath.hypot(run, drop), .06, 1.36], stage: 4, surface: "roof" });
  woodpile(site, [1.2, 0, -.6], .4);
  if (site.detailed) woodpile(site, [1.2, 0, -.1], .4);
};

/**
 * Big residence: a longhouse — low stave walls under a tall, steep shingle roof with gable
 * dragons, and a gabled entrance porch on carved posts before the door.
 */
const vikingLonghouse = (site: ResidenceSite) => {
  const room: Room = { back: -1.4, base: 0, front: site.front, height: site.wallTop, x0: -1.8, x1: 1.8 };
  const walls = roomWalls(room, site.door), kit = residenceKit(site, walls);
  for (const wall of walls) vikingWall(kit, wall, false);
  vikingDoor(kit);
  addRoomFloor(site, room);
  const top = room.height + 1.15;
  vikingRoof(kit, roofOver([-1.84, -1.44], [1.84, site.front + .12], room.height, top, 1.15));
  for (const x of [-1.15, 1.15]) frontWindow(site, x, .6);
  entrancePorch(site, room.height);
};

/** A gabled porch on four carved posts over the door, its ridge running out from the wall. */
const entrancePorch = (site: ResidenceSite, wallTop: number) => {
  const centre = (site.door.left + site.door.right) / 2, out = site.front + .62, eave = Math.min(1.02, wallTop - .02);
  for (const x of [centre - .5, centre + .5]) for (const z of [site.front + .14, out]) site.add({
    position: [x, eave / 2, z], shape: "bevel-box", size: [.07, eave, .07], stage: 2, surface: "wood" });
  for (const x of [centre - .5, centre + .5]) site.add({ position: [x, eave + .03, (site.front + .1 + out) / 2],
    shape: "bevel-box", size: [.08, .06, out - site.front], stage: 2, surface: "wood" });
  const run = .58, rise = .38, slope = DMath.atan2(rise, run);
  for (const side of [-1, 1]) site.add({ position: [centre + side * run / 2, eave + rise / 2 + .05, (site.front + out) / 2 + .02],
    rotation: [0, 0, -side * slope], shape: "box", size: [DMath.hypot(run, rise) + .04, .06, out - site.front + .12],
    stage: 4, surface: "roof" });
  site.add({ position: [centre, eave + rise / 2, out + .03], shape: "gable", size: [run * 2 - .06, rise - .02, .05],
    stage: 3, surface: "planks" });
  const foot: Point3 = [centre - run + .05, eave + .08, out + .07], tip: Point3 = [centre + .1, eave + rise + .18, out + .07];
  if (site.detailed) site.add(gableDragon(foot, tip, .16));
};

const DESIGNS: Readonly<Record<number, (site: ResidenceSite) => void>> = {
  57: vikingCottage, 58: vikingHouse, 59: vikingLonghouse
};

/** Viking residences: log cabin, stave house and longhouse on the Roman plots and doors. */
export const createVikingResidence = (original: BuildingRecipe, site: ResidenceSite): BuildingRecipe => {
  DESIGNS[site.typeId]!(site);
  return finishResidence(original, site);
};
