import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { nubianDoor, nubianRoof, nubianWall } from "./nation-kit-nubian";
import {
  addRoomFloor, finishResidence, residenceKit, type ResidenceSite, roofOver, type Room, roomWalls
} from "./nation-residence-kit";

const LIME: Point3 = [.92, .9, .84];
const INDIGO: Point3 = [.16, .3, .58];
const OCHRE: Point3 = [.72, .44, .2];
const SKY: Point3 = [.34, .6, .74];
/** Earth vault rise over the room (the barrel profile spans 0.87 of its box). */
const VAULT_RISE = .48;

/** Nubian vault along x over a room: the earthen barrel and its plastered end walls. */
const addVault = (site: ResidenceSite, room: Room) => {
  const span = room.front - room.back + .1, height = VAULT_RISE / .87, eave = room.base + room.height;
  const position: Point3 = [(room.x0 + room.x1) / 2, eave + .44 * height - .02, (room.back + room.front) / 2];
  const base: Omit<BuildingPart, "shape" | "surface"> = { occupationRoof: "barrel", position,
    rotation: [0, Math.PI / 2, 0], size: [span, height, room.x1 - room.x0 + .08], stage: 4 };
  site.add({ ...base, shape: "occupation-roof", surface: "roof" });
  site.add({ ...base, shape: "roof-infill", surface: "plaster" });
};

/** Painted façade band: a lime ground with indigo and sky zigzag triangles (High) above the door. */
const addPaintedBand = (site: ResidenceSite, x0: number, x1: number, y: number) => {
  const face = site.front + .07;
  site.add({ position: [(x0 + x1) / 2, y, face], shape: "box", size: [x1 - x0, .13, .012], stage: 3, surface: "paint",
    tint: LIME });
  if (!site.detailed) return;
  const count = Math.floor((x1 - x0) / .12);
  for (let index = 0; index < count; index++) {
    const up = index % 2 === 0, x = x0 + (index + .5) * (x1 - x0) / count;
    site.add({ position: [x, y, face + .007], rotation: up ? undefined : [0, 0, Math.PI], shape: "paint-triangle",
      size: [.11, .1, .001], stage: 3, surface: "paint", tint: up ? INDIGO : SKY });
  }
};

/** Ceramic plates set in the wall over the door (a Nubian house blessing), lime rims and blue centres. */
const addPlates = (site: ResidenceSite, y: number) => {
  const centre = (site.door.left + site.door.right) / 2, face = site.front + .075;
  for (const dx of site.detailed ? [-.16, 0, .16] : [0]) {
    site.add({ position: [centre + dx, y, face], shape: "paint-ellipse", size: [.11, .11, .001], stage: 3,
      surface: "paint", tint: LIME });
    site.add({ position: [centre + dx, y, face + .002], shape: "paint-ellipse", size: [.05, .05, .001], stage: 3,
      surface: "paint", tint: INDIGO });
  }
};

/** The door gate: a raised lime-washed frame and a stepped crest over the door. */
const addGate = (site: ResidenceSite, wallTop: number) => {
  const centre = (site.door.left + site.door.right) / 2, width = site.door.right - site.door.left;
  for (const step of [0, 1]) site.add({ position: [centre, wallTop + .07 + step * .1, site.front],
    shape: "box", size: [width + .5 - step * .24, .14, .16], stage: 3, surface: "plaster" });
  site.add({ position: [centre, site.door.top + .17, site.front + .07], shape: "box", size: [width + .24, .07, .02],
    stage: 3, surface: "paint", tint: OCHRE });
};

/** A small window with a palm-rib lattice and an indigo frame. */
const latticeWindow = (site: ResidenceSite, x: number, y: number) => {
  const face = site.front + .056;
  for (const side of [-1, 1]) {
    site.add({ position: [x + side * .115, y, face + .004], shape: "box", size: [.03, .28, .012],
      stage: 3, surface: "paint", tint: INDIGO });
    site.add({ position: [x, y + side * .125, face + .004], shape: "box", size: [.2, .03, .012],
      stage: 3, surface: "paint", tint: INDIGO });
  }
  site.add({ position: [x, y, face + .006], shape: "window-shadow", size: [.2, .22, .006],
    stage: 3, surface: "dark" });
  if (site.detailed) for (const dx of [-.05, 0, .05]) site.add({ position: [x + dx, y, face + .012], shape: "box",
    size: [.016, .22, .012], stage: 3, surface: "wood" });
};

/** A mud mastaba bench against the front wall. */
const mastaba = (site: ResidenceSite, x: number, width: number) => site.add({
  position: [x, .11, site.front + .19], shape: "box", size: [width, .22, .26], stage: 2, surface: "plaster" });

const buildRoom = (site: ResidenceSite, room: Room, door = true) => {
  const walls = roomWalls(room, door ? site.door : undefined), kit = residenceKit(site, walls);
  for (const wall of walls) nubianWall(kit, wall);
  if (door) nubianDoor(kit);
  addRoomFloor(site, room);
  return kit;
};

/** Small residence: one vaulted room behind a raised, painted gate front with plates over the door. */
const nubianCottage = (site: ResidenceSite) => {
  const room: Room = { back: -1.05, base: 0, front: site.front, height: site.wallTop, x0: -1, x1: 1 };
  buildRoom(site, room);
  addVault(site, room);
  addGate(site, room.height);
  addPaintedBand(site, room.x0 + .05, room.x1 - .05, room.height - .12);
  addPlates(site, site.door.top + .1);
  latticeWindow(site, .45, .58);
  mastaba(site, .62, .5);
};

/** Medium residence: a terraced house crowned with a dome and a walled forecourt on the east. */
const nubianHouse = (site: ResidenceSite) => {
  const room: Room = { back: -1.15, base: 0, front: site.front, height: site.wallTop, x0: -1.45, x1: .95 };
  const kit = buildRoom(site, room);
  nubianRoof(kit, roofOver([-1.5, -1.2], [1, site.front + .06], room.height, room.height + .3), true);
  addPaintedBand(site, room.x0 + .05, room.x1 - .05, room.height - .14);
  addPlates(site, site.door.top + .12);
  latticeWindow(site, .35, .58);
  forecourt(site, room.x1);
};

/** Low courtyard wall with rounded copings and a gap toward the front; a water jar and a shrub inside. */
const forecourt = (site: ResidenceSite, x0: number) => {
  const x1 = 1.52, back = -1, front = .3, height = .62;
  const runs: Array<[Point3, Point3]> = [[[x1 - .06, height / 2, (back + front) / 2], [.12, height, front - back]],
    [[(x0 + x1) / 2, height / 2, back + .06], [x1 - x0, height, .12]], [[x0 + .16, height / 2, front - .06], [.2, height, .12]]];
  for (const [position, size] of runs) {
    site.add({ position, shape: "box", size, stage: 2, surface: "plaster" });
    site.add({ position: [position[0], height + .02, position[2]], shape: "bevel-box",
      size: [size[0] + .04, .05, size[2] + .04], stage: 3, surface: "paint", tint: LIME });
  }
  site.add({ position: [1.2, .15, -.7], shape: "clay-jar", size: [.18, .3, .18], stage: 3, surface: "paint",
    tint: OCHRE });
  if (site.detailed) site.add({ position: [1.25, .2, -.2], radialSegments: 6, shape: "sphere", size: [.36, .4, .36],
    stage: 3, surface: "leaf" });
};

/** Big residence: a terraced ground floor, a vaulted upper room and a palm-mat shade on the terrace. */
const nubianTownHouse = (site: ResidenceSite) => {
  const ground: Room = { back: -1.4, base: 0, front: site.front, height: site.wallTop, x0: -1.74, x1: 1.74 };
  const kit = buildRoom(site, ground);
  nubianRoof(kit, roofOver([-1.78, -1.44], [1.78, site.front + .05], ground.height, ground.height + .3), false);
  const upper: Room = { back: -1.32, base: ground.height + .06, front: -.25, height: .72, x0: -1.25, x1: .55 };
  buildRoom(site, upper, false);
  addVault(site, upper);
  shade(site, ground.height + .06);
  addPaintedBand(site, ground.x0 + .05, ground.x1 - .05, ground.height - .14);
  addPlates(site, site.door.top + .12);
  for (const x of [-1.1, 1.1]) latticeWindow(site, x, .6);
};

/** Palm-mat shade on four poles over the east end of the terrace. */
const shade = (site: ResidenceSite, deck: number) => {
  const height = .6, x0 = .75, x1 = 1.55, z0 = -1.2, z1 = .3;
  for (const x of [x0, x1]) for (const z of [z0, z1]) site.add({ position: [x, deck + height / 2, z],
    radialSegments: 6, shape: "cylinder", size: [.05, height, .05], stage: 3, surface: "wood" });
  site.add({ position: [(x0 + x1) / 2, deck + height + .02, (z0 + z1) / 2], shape: "box",
    size: [x1 - x0 + .12, .03, z1 - z0 + .12], stage: 4, surface: "straw" });
};

const DESIGNS: Readonly<Record<number, (site: ResidenceSite) => void>> = {
  57: nubianCottage, 58: nubianHouse, 59: nubianTownHouse
};

/** Nubian residences: vaulted cottage, domed terrace house and terraced town house. */
export const createNubianResidence = (original: BuildingRecipe, site: ResidenceSite): BuildingRecipe => {
  DESIGNS[site.typeId]!(site);
  return finishResidence(original, site);
};
