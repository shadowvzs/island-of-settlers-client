import { srgbToLinear } from "../color";
import type { SettlerNation as WorkerNation } from "../workers/worker-unit";
import {
  addBayPosts, addBayWalls, addClothStockShelf, addJar, addLeanToRoof, addLoom, addRomanHouse,
  addThatchGableRoof,
  addWeaverInput, type FlaxWeaverSite, houseRoom, houseWallRuns, loomBay, TERRACOTTA
} from "./flax-weaver-shared";
import { japaneseRoof, japaneseWall } from "./nation-kit-japanese";
import { nubianRoof, nubianWall } from "./nation-kit-nubian";
import { bodyCenter, type KitContext } from "./nation-kit-parts";
import { vikingRoof, vikingWall } from "./nation-kit-viking";
import { roofOver } from "./nation-residence-kit";
import { WEAVER_LOOM as LOOM } from "./weaver-loom";

const WOOL = srgbToLinear(.8, .7, .52);
const DYED_WOOL = srgbToLinear(.55, .22, .18);
const BAMBOO = srgbToLinear(.55, .62, .3);

const contextFor = (site: FlaxWeaverSite, walls: KitContext["walls"]): KitContext => ({
  add: site.add, center: bodyCenter(walls), detailed: site.detailed, door: site.door, lean: false,
  limit: site.limit, tower: false, typeId: site.typeId, walls
});

const addFloor = (site: FlaxWeaverSite) => {
  const room = houseRoom(site);
  site.add({ position: [0, site.base + .012, (room.back + room.front) / 2], shape: "box",
    size: [room.x1 - room.x0 - .16, .024, room.front - room.back - .16], stage: 0, surface: "mosaic" });
};

const addWoolBaskets = (site: FlaxWeaverSite, x: number, z: number, surface: "wood" | "plaster") => {
  for (const [index, tint] of [WOOL, DYED_WOOL].entries()) site.add({ position: [x + index * .24, site.base + .13, z],
    shape: "cylinder", size: [.2, .26, .2], stage: 3, surface, tint });
  if (!site.detailed) return;
  for (const index of [0, 1]) site.add({ position: [x + index * .24, site.base + .25, z], shape: "cylinder",
    size: [.17, .04, .17], stage: 3, surface: "cloth", tint: index ? DYED_WOOL : WOOL });
};

const addRomanWeaver = (site: FlaxWeaverSite,
  roof: (x: number, y: number, z: number, width: number, depth: number) => void) => {
  addRomanHouse(site);
  const room = houseRoom(site), bay = loomBay(site);
  roof(0, site.wallTop + .02, (room.back + room.front) / 2, room.x1 - room.x0 + .22,
    room.front - room.back + .22);
  addBayWalls(site, "plaster");
  addBayPosts(site, "wood");
  addLeanToRoof(site, bay.x0, bay.x1, bay.back + .05, bay.front + .02, site.wallTop + .04,
    site.wallTop - .16, "roof");
  site.add({ position: [bay.x1 + .02, site.wallTop - .1, (bay.back + bay.front) / 2], shape: "box",
    size: [.06, .09, bay.front - bay.back + .06], stage: 4, surface: "cut-stone" });
  addLoom(site, LOOM.x, LOOM.z, "wood", site.detailed);
  addWeaverInput(site, "wood", LOOM.x, LOOM.z);
  addClothStockShelf(site, "wood", site.detailed);
  addWoolBaskets(site, .92, -.08, "wood");
  addJar(site, .6, .76, .24, TERRACOTTA, site.detailed);
  // A warp-weighted upright loom needs a row of clay weights behind its beam.
  for (let index = 0; index < (site.detailed ? 7 : 4); index++) site.add({ position: [LOOM.x - .32 + index * .105,
    site.base + .05, LOOM.z + .13], shape: "sphere", size: [.06, .1, .05], stage: 3, surface: "paint",
    tint: TERRACOTTA });
};

const addVikingWeaver = (site: FlaxWeaverSite) => {
  const walls = houseWallRuns(site), context = contextFor(site, walls);
  for (const wall of walls) vikingWall(context, wall, site.detailed);
  addFloor(site);
  const room = houseRoom(site), bay = loomBay(site);
  if (site.detailed) vikingRoof(context, roofOver([room.x0 - .12, room.back - .12], [room.x1 + .12, room.front + .12],
    site.wallTop - .1, site.wallTop + .52, .62), true);
  else addThatchGableRoof(site, room.x0 - .08, room.x1 + .08, room.back - .08, room.front + .08,
    site.wallTop - .08, .56);
  addBayWalls(site, "planks");
  addBayPosts(site, "bark");
  addLeanToRoof(site, bay.x0, bay.x1, bay.back + .04, bay.front + .02, site.wallTop + .04,
    site.wallTop - .14, "roof");
  for (const x of [bay.x0 + .08, bay.x1 - .08]) site.add({ position: [x, site.base + .5, bay.front + .02],
    shape: "cylinder", size: [.05, 1.0, .05], stage: 2, surface: "bark" });
  addLoom(site, LOOM.x, LOOM.z, "wood", site.detailed);
  addWeaverInput(site, "bark", LOOM.x, LOOM.z);
  addClothStockShelf(site, "bark", site.detailed);
  addWoolBaskets(site, .92, -.08, "wood");
  // A small carved loom weight row and a shield on the timber wall.
  for (let index = 0; index < (site.detailed ? 6 : 3); index++) site.add({ position: [LOOM.x - .28 + index * .11,
    site.base + .06, LOOM.z + .14], shape: "stone-block", size: [.08, .12, .06], stage: 3, surface: "stone" });
  site.add({ position: [room.x1 + .05, site.base + .66, room.back + .35], rotation: [Math.PI / 2, 0, 0],
    shape: "cylinder", size: [.3, .035, .3], stage: 3, surface: "wood" });
  if (site.detailed) site.add({ position: [room.x1 + .075, site.base + .66, room.back + .35], shape: "sphere",
    size: [.06, .06, .04], stage: 3, surface: "iron" });
};

const addNubianWeaver = (site: FlaxWeaverSite) => {
  const walls = houseWallRuns(site), context = contextFor(site, walls);
  for (const wall of walls) nubianWall(context, wall);
  addFloor(site);
  const room = houseRoom(site), bay = loomBay(site);
  nubianRoof(context, roofOver([room.x0 - .1, room.back - .1], [room.x1 + .1, room.front + .1],
    site.wallTop, site.wallTop + .34), true, false);
  addBayWalls(site, "plaster");
  addBayPosts(site, "wood");
  // A woven palm-mat shade, its beams carried by the bay posts.
  addLeanToRoof(site, bay.x0, bay.x1, bay.back + .04, bay.front + .04, site.wallTop + .02,
    site.wallTop - .12, "straw", .035);
  for (const z of [bay.back + .18, bay.front - .1]) site.add({ position: [bay.x1 - .02, site.wallTop - .2, z],
    shape: "cylinder", size: [.035, .94, .035], stage: 3, surface: "wood" });
  if (site.detailed) {
    site.add({ position: [bay.x1 + .02, site.wallTop - .26, (bay.back + bay.front) / 2], shape: "box",
      size: [.035, .16, .5], stage: 3, surface: "nubian-textile" });
  }
  addLoom(site, LOOM.x, LOOM.z, "wood", site.detailed);
  addWeaverInput(site, "wood", LOOM.x, LOOM.z);
  addClothStockShelf(site, "plaster", site.detailed);
  addWoolBaskets(site, .92, -.08, "plaster");
  addJar(site, .62, .78, .28, TERRACOTTA, site.detailed);
  addJar(site, -.98, .7, .22, srgbToLinear(.62, .36, .2), site.detailed);
  for (const z of [room.back, room.front]) site.add({ position: [0, site.base + .65, z > 0 ? z + .061 : z - .006],
    shape: "box", size: [room.x1 - room.x0, .08, .01], stage: 3, surface: "paint", tint: TERRACOTTA });
};

const addJapaneseWeaver = (site: FlaxWeaverSite) => {
  const walls = houseWallRuns(site), context = contextFor(site, walls);
  for (const wall of walls) japaneseWall(context, wall);
  addFloor(site);
  const room = houseRoom(site), bay = loomBay(site);
  japaneseRoof(context, roofOver([room.x0 - .18, room.back - .18], [room.x1 + .18, room.front + .18],
    site.wallTop + .02, site.wallTop + .58), true);
  addBayWalls(site, "plaster");
  addBayPosts(site, "wood");
  addLeanToRoof(site, bay.x0, bay.x1, bay.back + .04, bay.front + .02, site.wallTop + .03,
    site.wallTop - .13, "roof", .045);
  // Deep eave fascia and rafters over the open bay.
  site.add({ position: [bay.x1 + .04, site.wallTop - .16, (bay.back + bay.front) / 2], shape: "box",
    size: [.07, .08, bay.front - bay.back + .08], stage: 4, surface: "wood" });
  const rafters = site.detailed ? 4 : 3;
  for (let index = 0; index < rafters; index++) site.add({ position: [bay.x0 + .1 +
    index * (bay.x1 - bay.x0 - .2) / (rafters - 1), site.wallTop - .12, bay.front - .06],
    rotation: [0, 0, Math.PI / 2], shape: "cylinder", size: [.018, .24, .018], stage: 3, surface: "wood" });
  addLoom(site, LOOM.x, LOOM.z, "wood", site.detailed);
  addWeaverInput(site, "wood", LOOM.x, LOOM.z);
  addClothStockShelf(site, "wood", site.detailed);
  addWoolBaskets(site, .92, -.08, "wood");
  // Shoji screen behind the loom, its paper brightly lit behind a dark lattice.
  site.add({ position: [bay.x0 + .02, site.base + .5, bay.back + .14], shape: "box", size: [.03, .5, .42],
    stage: 3, surface: "paint", tint: srgbToLinear(.93, .91, .84) });
  for (let index = -2; index <= 2; index++) site.add({ position: [bay.x0 + .04, site.base + .5, bay.back + .14 + index * .085],
    shape: "box", size: [.014, .5, .012], stage: 3, surface: "wood" });
  for (const y of [.38, .62]) site.add({ position: [bay.x0 + .04, site.base + y, bay.back + .14], shape: "box",
    size: [.014, .012, .4], stage: 3, surface: "wood" });
  site.add({ position: [.45, .15, room.front + .18], shape: "box", size: [.24, .04, .3], stage: 2,
    surface: "planks" });
  site.add({ position: [-1.0, .04, room.front + .34], shape: "cylinder", size: [.03, .72, .03], stage: 2,
    surface: "wood", tint: BAMBOO });
};

export const NATION_WEAVER_DESIGNS: Readonly<Record<Exclude<WorkerNation, "roman">,
  (site: FlaxWeaverSite) => void>> = {
  japanese: addJapaneseWeaver, nubian: addNubianWeaver, viking: addVikingWeaver
};

export const createRomanWeaver = addRomanWeaver;
