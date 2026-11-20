import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { stoneLanternParts } from "./japanese-stone-lantern";
import { japaneseDoor, japaneseRoof, japaneseWall } from "./nation-kit-japanese";
import {
  addRoomFloor, finishResidence, residenceKit, type ResidenceSite, roofOver, type Room, roomWalls
} from "./nation-residence-kit";
import { JAPANESE_ROOF_TINTS, japaneseRoofClass } from "./nation-roof-palette";

const SHOJI: Point3 = [.95, .93, .86];
const BAMBOO: Point3 = [.78, .74, .42];

const roofTint = (site: ResidenceSite) => JAPANESE_ROOF_TINTS[japaneseRoofClass(site.typeId)];

const buildRoom = (site: ResidenceSite, room: Room, door = true) => {
  const walls = roomWalls(room, door ? site.door : undefined), kit = residenceKit(site, walls);
  for (const wall of walls) japaneseWall(kit, wall);
  if (door) japaneseDoor(kit);
  addRoomFloor(site, room);
  return kit;
};

/** Shoji window: white paper behind a dark lattice (High) in a timber frame. */
const shoji = (site: ResidenceSite, x: number, y: number, width = .34) => {
  const face = site.front + .07;
  site.add({ position: [x, y, face], shape: "box", size: [width + .05, .3, .02], stage: 3, surface: "wood" });
  site.add({ position: [x, y, face + .011], shape: "box", size: [width, .25, .004], stage: 3, surface: "paint", tint: SHOJI });
  if (!site.detailed) return;
  for (let index = 1; index < 4; index++) site.add({ position: [x - width / 2 + index * width / 4, y, face + .015],
    shape: "box", size: [.012, .25, .006], stage: 3, surface: "wood" });
  site.add({ position: [x, y, face + .015], shape: "box", size: [width, .012, .006], stage: 3, surface: "wood" });
};

/** Engawa: a raised board veranda on stone feet along the front wall, clear of the door lane. */
const engawa = (site: ResidenceSite, x0: number, x1: number) => {
  const depth = .3, z = site.front + .055 + depth / 2;
  site.add({ position: [(x0 + x1) / 2, .15, z], shape: "box", size: [x1 - x0, .04, depth], stage: 2, surface: "planks" });
  const feet = site.detailed ? 4 : 2;
  for (let index = 0; index < feet; index++) site.add({
    position: [x0 + .06 + index * (x1 - x0 - .12) / (feet - 1), .065, z + .08], shape: "box", size: [.08, .13, .08],
    stage: 1, surface: "cut-stone" });
};

/** A pent roof (hisashi) along the whole front, on brackets, above the door head. */
const frontPentRoof = (site: ResidenceSite, x0: number, x1: number, y: number) => {
  const depth = .3, pitch = .35, face = site.front + .055;
  site.add({ position: [(x0 + x1) / 2, y - DMath.tan(pitch) * depth / 2, face + depth / 2], rotation: [pitch, 0, 0],
    shape: "box", size: [x1 - x0, .04, depth / DMath.cos(pitch)], stage: 4, surface: "roof", tint: roofTint(site) });
  for (const x of [x0 + .1, (x0 + x1) / 2 + .3, x1 - .1]) site.add({ position: [x, y - .12, face + .1],
    rotation: [-.8, 0, 0], shape: "bevel-box", size: [.035, .04, .24], stage: 3, surface: "wood" });
};

/** Small residence: timber walls and shoji under the same swept kawara roof as the Japanese houses. */
const japaneseMinka = (site: ResidenceSite) => {
  const room: Room = { back: -1.05, base: 0, front: site.front, height: site.wallTop, x0: -1, x1: 1 };
  const kit = buildRoom(site, room);
  japaneseRoof(kit, roofOver([room.x0 - .11, room.back - .11], [room.x1 + .11, room.front + .11],
    room.height, room.height + .5), true, room.height);
  shoji(site, .5, .52);
  engawa(site, .14, .98);
};

/** Medium residence: a machiya town house with a pent roof over a latticed front and a garden lantern. */
const japaneseMachiya = (site: ResidenceSite) => {
  const room: Room = { back: -1.15, base: 0, front: site.front, height: site.wallTop, x0: -1.45, x1: .95 };
  const kit = buildRoom(site, room);
  japaneseRoof(kit, roofOver([-1.55, -1.26], [1.05, site.front + .12], room.height, room.height + .5), true);
  frontPentRoof(site, room.x0 + .04, room.x1 - .04, site.door.top + .3);
  shoji(site, .35, .5, .42);
  garden(site, room.x1);
};

/** Garden beside the house: a bamboo fence and a stone lantern. */
const garden = (site: ResidenceSite, x0: number) => {
  for (const part of stoneLanternParts(1.25, -.35, site.detailed)) site.add({ stage: 3, ...part } as BuildingPart);
  const posts = site.detailed ? 9 : 4, back = -1, front = .25;
  for (let index = 0; index < posts; index++) site.add({ position: [1.5, .25, back + index * (front - back) / (posts - 1)],
    radialSegments: 5, shape: "cylinder", size: [.04, .5, .04], stage: 2, surface: "wood", tint: BAMBOO });
  for (const y of [.18, .4]) site.add({ position: [1.5, y, (back + front) / 2], shape: "box", size: [.03, .025, front - back],
    stage: 2, surface: "wood", tint: BAMBOO });
  site.add({ position: [(x0 + 1.5) / 2, .03, back + .04], shape: "box", size: [1.5 - x0, .06, .06], stage: 2,
    surface: "cut-stone" });
};

/** Big residence: a two-storey house — a skirt roof round the ground floor and a hip roof on the upper storey. */
const japaneseTownHouse = (site: ResidenceSite) => {
  const ground: Room = { back: -1.4, base: 0, front: site.front, height: site.wallTop, x0: -1.8, x1: 1.8 };
  const kit = buildRoom(site, ground);
  japaneseRoof(kit, roofOver([-1.83, -1.42], [1.83, site.front + .13], ground.height, ground.height + .45), false);
  const upper: Room = { back: -1.2, base: ground.height + .02, front: -.05, height: .95, x0: -1.15, x1: 1.15 };
  const upperKit = buildRoom(site, upper, false);
  japaneseRoof(upperKit, roofOver([-1.32, -1.37], [1.32, .12], upper.base + upper.height,
    upper.base + upper.height + .5), true);
  for (const x of [-.6, .6]) {
    site.add({ position: [x, upper.base + .55, upper.front + .07], shape: "box", size: [.42, .3, .02], stage: 3,
      surface: "wood" });
    site.add({ position: [x, upper.base + .55, upper.front + .081], shape: "box", size: [.37, .25, .004], stage: 3,
      surface: "paint", tint: SHOJI });
  }
  for (const x of [-1.15, 1.15]) shoji(site, x, .55);
};

const DESIGNS: Readonly<Record<number, (site: ResidenceSite) => void>> = {
  57: japaneseMinka, 58: japaneseMachiya, 59: japaneseTownHouse
};

/** Japanese residences: tiled timber house, machiya and two-storey town house. */
export const createJapaneseResidence = (original: BuildingRecipe, site: ResidenceSite): BuildingRecipe => {
  DESIGNS[site.typeId]!(site);
  return finishResidence(original, site);
};
