import { srgbToLinear } from "../color";
import type { SettlerNation as WorkerNation } from "../workers/worker-unit";
import {
  addFlaxBed, addFlaxStockRack, addFlaxWorkBench, addJar, addLeanToRoof, addRomanHouse,
  addThatchGableRoof, type FlaxWeaverSite, houseRoom, houseWallRuns, TERRACOTTA
} from "./flax-weaver-shared";
import { japaneseRoof, japaneseWall } from "./nation-kit-japanese";
import { nubianWall } from "./nation-kit-nubian";
import { bodyCenter, type KitContext } from "./nation-kit-parts";
import { vikingRoof, vikingWall } from "./nation-kit-viking";
import { roofOver } from "./nation-residence-kit";

const WINDOW = { y: .53, height: .24, width: .3 };

const addRomanWindow = (site: FlaxWeaverSite) => {
  const { x1 } = houseRoom(site), y = site.base + WINDOW.y, z = 0;
  site.add({ position: [x1 + .004, y, z], shape: "box", size: [.02, WINDOW.height, WINDOW.width], stage: 2,
    surface: "dark" });
  for (const side of [-1, 1]) site.add({ position: [x1 + .025, y, z + side * (WINDOW.width / 2 + .02)],
    shape: "box", size: [.05, WINDOW.height + .08, .04], stage: 2, surface: "cut-stone" });
  site.add({ position: [x1 + .025, y + WINDOW.height / 2 + .03, z], shape: "box",
    size: [.05, .05, WINDOW.width + .08], stage: 2, surface: "cut-stone" });
};

export const createRomanFlaxFarm = (site: FlaxWeaverSite,
  roof: (x: number, y: number, z: number, width: number, depth: number) => void) => {
  addRomanHouse(site);
  const room = houseRoom(site);
  roof(0, site.wallTop + .02, (room.back + room.front) / 2, room.x1 - room.x0 + .22,
    room.front - room.back + .22);
  addRomanWindow(site);
  addFlaxStockRack(site, "wood", site.detailed, { x0: .54, x1: .92 });
  addFlaxWorkBench(site, -.74, -.1, "wood", site.detailed, .48);
  addFlaxBed(site, -.74, .3, site.detailed);
  addJar(site, .42, .72, .27, TERRACOTTA, site.detailed);
  addJar(site, -.5, .7, .22, TERRACOTTA, site.detailed);
};

const addNationalFloor = (site: FlaxWeaverSite) => {
  const room = houseRoom(site);
  site.add({ position: [0, site.base + .012, (room.back + room.front) / 2], shape: "box",
    size: [room.x1 - room.x0 - .16, .024, room.front - room.back - .16], stage: 0, surface: "mosaic" });
};

const contextFor = (site: FlaxWeaverSite, walls: KitContext["walls"]): KitContext => ({
  add: site.add, center: bodyCenter(walls), detailed: site.detailed, door: site.door, lean: false,
  limit: site.limit, tower: false, typeId: site.typeId, walls
});

const addVikingWindow = (site: FlaxWeaverSite) => {
  const { x1 } = houseRoom(site), y = site.base + WINDOW.y, z = 0;
  site.add({ position: [x1 + .004, y, z], shape: "box", size: [.02, WINDOW.height, WINDOW.width], stage: 2,
    surface: "dark" });
  for (const side of [-1, 1]) site.add({ position: [x1 + .03, y, z + side * (WINDOW.width / 2 + .02)],
    shape: "box", size: [.05, WINDOW.height + .1, .045], stage: 2, surface: "wood" });
  site.add({ position: [x1 + .03, y + WINDOW.height / 2 + .04, z], shape: "box",
    size: [.05, .06, WINDOW.width + .09], stage: 2, surface: "wood" });
};

const addNubianWindow = (site: FlaxWeaverSite) => {
  const { x1 } = houseRoom(site), y = site.base + WINDOW.y, z = 0;
  site.add({ position: [x1 + .004, y, z], shape: "box", size: [.02, WINDOW.height, WINDOW.width], stage: 2,
    surface: "dark" });
  for (let index = -2; index <= 2; index++) site.add({ position: [x1 + .02, y, z + index * .06],
    shape: "box", size: [.014, WINDOW.height, .014], stage: 2, surface: "wood" });
  for (const dy of [-.06, .06]) site.add({ position: [x1 + .02, y + dy, z], shape: "box",
    size: [.016, .016, WINDOW.width], stage: 2, surface: "wood" });
  site.add({ position: [x1 + .05, y + WINDOW.height / 2 + .06, z], rotation: [0, 0, -.42], shape: "box",
    size: [.18, .025, .4], stage: 3, surface: "straw" });
};

const addJapaneseWindow = (site: FlaxWeaverSite) => {
  const { x1 } = houseRoom(site), y = site.base + WINDOW.y, z = 0;
  site.add({ position: [x1 + .004, y, z], shape: "box", size: [.02, WINDOW.height, WINDOW.width], stage: 2,
    surface: "dark" });
  site.add({ position: [x1 + .012, y, z], shape: "box", size: [.012, WINDOW.height - .04, WINDOW.width - .04],
    stage: 3, surface: "paint", tint: srgbToLinear(.93, .91, .84) });
  for (let index = -2; index <= 2; index++) site.add({ position: [x1 + .022, y, z + index * .06],
    shape: "box", size: [.014, WINDOW.height, .012], stage: 3, surface: "wood" });
  for (const dy of [-.06, .06]) site.add({ position: [x1 + .022, y + dy, z], shape: "box",
    size: [.014, .012, WINDOW.width], stage: 3, surface: "wood" });
};

const addVikingFarm = (site: FlaxWeaverSite) => {
  const walls = houseWallRuns(site), context = contextFor(site, walls);
  for (const wall of walls) vikingWall(context, wall, site.detailed);
  addNationalFloor(site);
  const room = houseRoom(site);
  const envelope = roofOver([room.x0 - .12, room.back - .12], [room.x1 + .12, room.front + .12],
    site.wallTop - .1, site.wallTop + .52, .62);
  if (site.detailed) vikingRoof(context, envelope, true);
  else addThatchGableRoof(site, room.x0 - .08, room.x1 + .08, room.back - .08, room.front + .08,
    site.wallTop - .08, .56);
  addVikingWindow(site);
  for (const x of [-.34, .34]) site.add({ position: [x, .06, room.front + .02], shape: "stone-block",
    size: [.2, .12, .16], stage: 1, surface: "stone" });
  addFlaxStockRack(site, "bark", site.detailed, { x0: .54, x1: .92 });
  addFlaxWorkBench(site, -.74, -.1, "bark", site.detailed, .48);
  addFlaxBed(site, -.74, .3, site.detailed);
  // A tall drying pole with a linen marker beside the yard.
  site.add({ position: [-.72, .07, room.front + .5], shape: "cylinder", size: [.08, .52, .08], stage: 2,
    surface: "bark" });
  site.add({ position: [-.72, .34, room.front + .5], shape: "box", size: [.32, .025, .025], stage: 3,
    surface: "wood" });
  site.add({ position: [-.78, .34, room.front + .5], shape: "box", size: [.012, .16, .01], stage: 3,
    surface: "cloth", tint: srgbToLinear(.55, .16, .1) });
};

const addNubianFarm = (site: FlaxWeaverSite) => {
  const walls = houseWallRuns(site), context = contextFor(site, walls);
  for (const wall of walls) nubianWall(context, wall);
  addNationalFloor(site);
  const room = houseRoom(site), width = room.x1 - room.x0, depth = room.front - room.back;
  // Low earthen terrace with a waist-high parapet: a farmhouse, not a fortified tower.
  site.add({ position: [0, site.wallTop + .025, (room.back + room.front) / 2], shape: "box",
    size: [width + .04, .05, depth + .04], stage: 3, surface: "roof" });
  for (const z of [room.back, room.front]) site.add({ position: [0, site.wallTop + .13, z + (z > 0 ? .02 : -.02)],
    shape: "box", size: [width + .06, .26, .1], stage: 3, surface: "plaster" });
  for (const x of [room.x0, room.x1]) site.add({ position: [x + (x > 0 ? -.02 : .02), site.wallTop + .13,
    (room.back + room.front) / 2], shape: "box", size: [.1, .26, depth + .06], stage: 3, surface: "plaster" });
  addNubianWindow(site);
  for (const z of [room.back, room.front]) site.add({ position: [0, site.base + .6, z > 0 ? z + .061 : z - .006],
    shape: "box", size: [width, .1, .012], stage: 3, surface: "paint", tint: TERRACOTTA });
  addFlaxStockRack(site, "plaster", site.detailed, { x0: .54, x1: .92 });
  addFlaxWorkBench(site, -.74, -.1, "wood", site.detailed, .48);
  addFlaxBed(site, -.74, .3, site.detailed);
  // Palm-mat working porch over the left-hand brake and flax bed.
  for (const z of [-.34, .26]) site.add({ position: [-.94, .42, z], shape: "cylinder", size: [.05, .84, .05],
    stage: 2, surface: "wood" });
  addLeanToRoof(site, -.98, -.48, -.42, .32, .84, 1.0, "straw", .035);
  addJar(site, -.45, .68, .3, TERRACOTTA, site.detailed);
  addJar(site, .42, .7, .26, srgbToLinear(.62, .36, .2), site.detailed);
  site.add({ position: [-.35, site.base + .6, room.front + .006], shape: "box", size: [.18, .35, .015], stage: 3,
    surface: "nubian-textile" });
};

const addJapaneseFarm = (site: FlaxWeaverSite) => {
  const walls = houseWallRuns(site), context = contextFor(site, walls);
  for (const wall of walls) japaneseWall(context, wall);
  addNationalFloor(site);
  const room = houseRoom(site);
  const envelope = roofOver([room.x0 - .18, room.back - .18], [room.x1 + .18, room.front + .18],
    site.wallTop + .02, site.wallTop + .58);
  japaneseRoof(context, envelope, true);
  addJapaneseWindow(site);
  // Engawa boards beside the door; the shared door lane itself stays clear.
  site.add({ position: [.46, .15, room.front + .19], shape: "box", size: [.26, .04, .34], stage: 2,
    surface: "planks" });
  for (const x of [.35, .57]) site.add({ position: [x, .06, room.front + .31], shape: "box",
    size: [.06, .12, .06], stage: 1, surface: "cut-stone" });
  addFlaxStockRack(site, "wood", site.detailed, { x0: .54, x1: .92 });
  addFlaxWorkBench(site, -.74, -.1, "wood", site.detailed, .48);
  addFlaxBed(site, -.74, .3, site.detailed);
  // Bamboo drying poles beside the ordered rack.
  for (const z of [site.front + .02, site.front + .28]) site.add({ position: [-.93, .43, z],
    shape: "cylinder", size: [.022, .86, .022], stage: 2, surface: "wood",
    tint: srgbToLinear(.55, .62, .3) });
  site.add({ position: [-.93, .86, site.front + .15], rotation: [Math.PI / 2, 0, 0], shape: "cylinder",
    size: [.026, .34, .026], stage: 3, surface: "wood", tint: srgbToLinear(.55, .62, .3) });
  site.add({ position: [-.86, .86, site.front + .15], rotation: [0, 0, Math.PI / 2], shape: "cylinder",
    size: [.022, .28, .022], stage: 3, surface: "wood", tint: srgbToLinear(.55, .62, .3) });
  for (const x of [-.9, -.78]) site.add({ position: [x, .78, site.front + .15], shape: "cylinder",
    size: [.012, .24, .012], stage: 3, surface: "straw" });
};

export const NATION_FARM_DESIGNS: Readonly<Record<Exclude<WorkerNation, "roman">,
  (site: FlaxWeaverSite) => void>> = {
  japanese: addJapaneseFarm, nubian: addNubianFarm, viking: addVikingFarm
};
