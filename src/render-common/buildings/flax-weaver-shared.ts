import { srgbToLinear } from "../color";
import type { WorkerNation } from "../workers/worker-unit";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, Point3 } from "./building-recipe";
import type { WallRun } from "./nation-kit-classify";
import type { DoorGap } from "./nation-kit-parts";

/** The shared Flax Farm/Weaver footprint: Roman authoring space, door and stock anchors fixed. */
export interface FlaxWeaverSite {
  add: (part: Omit<BuildingPart, "stage"> & { stage?: number }) => void;
  /** Vertical authoring offset: Roman parts are shifted down after the design, nations are not. */
  base: number;
  definition: BuildingDefinition;
  detailed: boolean;
  door: DoorGap;
  front: number;
  limit: { extentX: number; extentZ: number };
  nation: WorkerNation;
  parts: BuildingPart[];
  typeId: number;
  wallTop: number;
}

export const FLAX_FARM_TYPE = 60;
export const WEAVER_TYPE = 61;
export const WALL_THICKNESS = .11;

/** The house the farm/workshop occupies; the Weaver's open loom bay is attached outside it. */
export const houseRoom = (site: FlaxWeaverSite) => {
  const depth = site.typeId === FLAX_FARM_TYPE ? .8 : 1.1;
  return { back: site.front - depth, base: site.base, front: site.front,
    height: site.wallTop - site.base, x0: site.typeId === FLAX_FARM_TYPE ? -.48 : -.6,
    x1: site.typeId === FLAX_FARM_TYPE ? .48 : .6 };
};

const wallBox = (add: FlaxWeaverSite["add"], min: Point3, max: Point3, surface: BuildingPart["surface"],
  stage = 1) => add({ position: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2], shape: "box", size: [Math.max(.001, max[0] - min[0]),
    Math.max(.001, max[1] - min[1]), Math.max(.001, max[2] - min[2])], stage, surface });

/** A hollow house with the shared door opening: back, two sides, front pieces and the lintel. */
export const houseWallRuns = (site: FlaxWeaverSite): WallRun[] => {
  const { back, base, front, height, x0, x1 } = houseRoom(site), top = base + height;
  const door = site.door, t = WALL_THICKNESS / 2, runs: WallRun[] = [
    { along: 0, base, height, length: x1 - x0, max: [x1, top, back + WALL_THICKNESS], min: [x0, base, back] },
    { along: 2, base, height, length: front - back, max: [x0 + WALL_THICKNESS, top, front], min: [x0, base, back] },
    { along: 2, base, height, length: front - back, max: [x1, top, front], min: [x1 - WALL_THICKNESS, base, back] },
    { along: 0, base, height, length: door.left - x0, max: [door.left, top, front + t], min: [x0, base, front - t] },
    { along: 0, base, height, length: x1 - door.right, max: [x1, top, front + t], min: [door.right, base, front - t] },
    { along: 0, base: base + door.top, height: height - door.top, length: door.right - door.left,
      max: [door.right, top, front + t], min: [door.left, base + door.top, front - t] }
  ];
  return runs;
};

/** Roman walls and gable ends on the shared runs; the main roof comes from the recipe's roof helper. */
export const addRomanHouse = (site: FlaxWeaverSite) => {
  for (const run of houseWallRuns(site)) {
    wallBox(site.add, run.min, run.max, "plaster");
  }
  const { back, base, front, x0, x1 } = houseRoom(site);
  // A dressed stone plinth and corner quoins keep the plastered farmhouse grounded. The doorway
  // itself gets only a low threshold step, never a wall-high sill across the worker lane.
  wallBox(site.add, [x0 - .015, base, back - .015], [x1 + .015, base + .24, back + .1], "stone", 1);
  for (const [left, right] of [[x0 - .015, x0 + .1], [x1 - .1, x1 + .015]] as const)
    wallBox(site.add, [left, base, back], [right, base + .24, front + .015], "stone", 1);
  const door = site.door;
  for (const [left, right] of [[x0 - .015, door.left], [door.right, x1 + .015]] as const)
    wallBox(site.add, [left, base, front - .08], [right, base + .24, front + .015], "stone", 1);
  wallBox(site.add, [door.left, base, front - .06], [door.right, base + .03, front + .015], "stone", 1);
  for (const x of [x0 + .03, x1 - .03]) for (const z of [back + .03, front - .03])
    site.add({ position: [x, base + .51, z], shape: "box", size: [.13, .54, .13], stage: 2, surface: "stone" });
  for (const x of [door.left - .035, door.right + .035])
    site.add({ position: [x, base + .05 + door.top / 2, front + .055], shape: "bevel-box",
      size: [.08, door.top + .1, .12], stage: 2, surface: "cut-stone" });
  site.add({ position: [(door.left + door.right) / 2, base + door.top + .07, front + .055], shape: "bevel-box",
    size: [door.right - door.left + .2, .1, .13], stage: 2, surface: "cut-stone" });
  site.add({ position: [0, base + .012, (back + front) / 2], shape: "box", size: [x1 - x0 - .16, .024,
    front - back - .16], stage: 0, surface: "mosaic" });
  // Two timber porch posts and a lintel beam, clear of the shared door lane.
  for (const x of [x0 + .12, x1 - .12]) site.add({ position: [x, base + .5, front + .18], shape: "box",
    size: [.08, 1.0, .08], stage: 2, surface: "wood" });
  site.add({ position: [0, base + .99, front + .18], shape: "bevel-box", size: [x1 - x0 - .1, .08, .1],
    stage: 2, surface: "wood" });
};

/** The drying/stock rack on the left of the farm, and the cloth shelf of the Weaver. */
const stockMarker = (site: FlaxWeaverSite, ware: string, kind: "input" | "output", slot: number,
  position: Point3, rotation?: Point3) => site.add({ position, rotation, shape: "box",
  size: [.18, .02, .14], stage: 1, surface: "wood", stock: { kind, slot, ware } });

const rackFrame = (site: FlaxWeaverSite, x0: number, x1: number, z: number, tiers: readonly number[],
  surface: BuildingPart["surface"]) => {
  const centre = (x0 + x1) / 2, depth = .32, top = Math.max(...tiers) + .28;
  for (const x of [x0 + .035, x1 - .035]) for (const side of [-1, 1])
    site.add({ position: [x, site.base + top / 2, z + side * (depth / 2 - .035)], shape: "box",
      size: [.06, top, .06], stage: 1, surface });
  for (const y of tiers) site.add({ position: [centre, site.base + y - .025, z], shape: "box",
    size: [x1 - x0, .03, depth], stage: 2, surface });
  // An open top rail keeps the hanging bundles visible above the shelves.
  site.add({ position: [centre, site.base + top, z], shape: "box",
    size: [x1 - x0, .04, depth], stage: 3, surface });
};

/** Six flax bundles on a two-tier drying rack, left of the farmhouse. */
export const addFlaxStockRack = (site: FlaxWeaverSite, surface: BuildingPart["surface"], detailed: boolean,
  origin = { x0: -.94, x1: -.56 }) => {
  const { x0, x1 } = origin, z = site.front + .15, tiers = [.23, .55, .87];
  rackFrame(site, x0, x1, z, tiers, surface);
  const xs = [x0 + .1, x1 - .1];
  for (const [tier, y] of tiers.entries()) for (const [column, x] of xs.entries())
    stockMarker(site, "flax", "output", tier * 2 + column, [x, site.base + y + .01, z]);
  if (!detailed) return;
  // A spare bundle hangs from the top rail, showing the drying form beside the shelf stock.
  for (let index = 0; index < 4; index++) site.add({ position: [x1 - .16 + index * .022, site.base + .46, z + .19],
    shape: "cylinder", size: [.012, .34, .012], stage: 3, surface: "straw" });
  site.add({ position: [x1 - .13, site.base + .3, z + .19], shape: "box", size: [.12, .025, .08], stage: 3,
    surface: "cloth" });
};

/** Six folded cloth bolts on a three-tier shelf before the Weaver's front wall. */
export const addClothStockShelf = (site: FlaxWeaverSite, surface: BuildingPart["surface"], detailed: boolean) => {
  const x0 = -.98, x1 = -.42, z = site.front + .18, tiers = [.27, .51, .75];
  rackFrame(site, x0, x1, z, tiers, surface);
  const xs = [-.84, -.56];
  for (const [tier, y] of tiers.entries()) for (const [column, x] of xs.entries())
    stockMarker(site, "cloth", "output", tier * 2 + column, [x, site.base + y + .01, z],
      [0, Math.PI / 2, 0]);
  if (!detailed) return;
  // A finished bolt lies open on the lowest shelf, its woven face visible.
  site.add({ position: [-.7, site.base + .3, z + .01], shape: "box", size: [.22, .012, .3], stage: 3,
    surface: "cloth" });
};

/** One flax input basket on the loom's front tray; the weaver reaches it from the front. */
export const addWeaverInput = (site: FlaxWeaverSite, surface: BuildingPart["surface"], loomX: number,
  loomZ: number) => {
  site.add({ position: [loomX, site.base + .26, loomZ + .18], shape: "box", size: [.34, .05, .28],
    stage: 2, surface });
  stockMarker(site, "flax", "input", 0, [loomX, site.base + .295, loomZ + .18]);
};

const flaxStem = (site: FlaxWeaverSite, x: number, z: number, height: number, lean: number,
  flower: boolean) => {
  site.add({ position: [x + lean * height * .35, site.base + height / 2, z], rotation: [0, 0, -lean],
    shape: "cylinder", size: [.006, height, .006], stage: 2, surface: "straw" });
  for (const side of [-1, 1]) site.add({ position: [x + lean * height * .55 + side * .022,
    site.base + height * .8, z + .006], rotation: [.35, 0, side * .55], shape: "box",
    size: [.04, .006, .012], stage: 3, surface: "leaf" });
  if (!flower) return;
  const top = [x + lean * height, site.base + height + .02, z] as Point3;
  site.add({ position: top, shape: "sphere", size: [.03, .018, .03], stage: 3, surface: "paint",
    tint: srgbToLinear(.28, .43, .82) });
};

/** A small flax bed beside the work area: blue flax flowers on slender stems, not a wheat patch. */
export const addFlaxBed = (site: FlaxWeaverSite, x: number, z: number, detailed: boolean) => {
  site.add({ position: [x, site.base + .012, z], shape: "box", size: [.5, .024, .34], stage: 0,
    surface: "dark" });
  const stems = detailed ? 11 : 6;
  for (let index = 0; index < stems; index++) {
    const angle = index * 2.4, radius = .03 + (index % 4) * .04;
    flaxStem(site, x + Math.cos(angle) * radius, z + Math.sin(angle) * radius * .6,
      .3 + (index % 3) * .045, Math.cos(angle) * .07, detailed || index % 3 === 0);
  }
};

const bench = (site: FlaxWeaverSite, x: number, z: number, width: number, depth: number,
  surface: BuildingPart["surface"]) => {
  site.add({ position: [x, site.base + .3, z], shape: "box", size: [width, .055, depth], stage: 2, surface });
  for (const side of [-1, 1]) for (const end of [-1, 1]) site.add({ position: [x + side * (width / 2 - .04),
    site.base + .145, z + end * (depth / 2 - .04)], shape: "box", size: [.055, .29, .055], stage: 1, surface });
};

/** The field-side brake: a clamped bundle on a low bench, ready for scutching. */
export const addFlaxWorkBench = (site: FlaxWeaverSite, x: number, z: number, surface: BuildingPart["surface"],
  detailed: boolean, width = .56) => {
  bench(site, x, z, width, .32, surface);
  site.add({ position: [x - .02, site.base + .36, z], rotation: [0, 0, Math.PI / 2], shape: "cylinder",
    size: [.035, .36, .035], stage: 3, surface });
  for (let index = 0; index < (detailed ? 7 : 4); index++) site.add({ position: [x - .02 + (index - 2) * .018,
    site.base + .43, z + .02], shape: "cylinder", size: [.006, .36, .006], stage: 3, surface: "straw" });
  site.add({ position: [x - .02, site.base + .4, z + .02], shape: "box", size: [.12, .03, .08], stage: 3,
    surface: "cloth" });
};

/** The Weaver's upright loom: frame, warp threads, heddle, cloth beam and a finished panel. */
export const addLoom = (site: FlaxWeaverSite, x: number, z: number, surface: BuildingPart["surface"],
  detailed: boolean) => {
  const width = .58, height = .88, top = site.base + height;
  // A pale woven hanging behind the warp makes the dark frame and threads read in the bay shade.
  site.add({ position: [x, site.base + .52, z - .16], shape: "box", size: [width * .86, .56, .012], stage: 3,
    surface: "cloth", tint: LINEN });
  for (const side of [-1, 1]) site.add({ position: [x + side * (width / 2 - .03), site.base + height / 2, z],
    shape: "box", size: [.07, height, .07], stage: 1, surface });
  for (const y of [site.base + .14, site.base + .46, site.base + .82]) site.add({ position: [x, y, z],
    shape: "box", size: [width, .06, .08], stage: 2, surface });
  site.add({ position: [x, site.base + .88, z], rotation: [0, 0, Math.PI / 2], shape: "cylinder",
    size: [.05, width + .08, .05], stage: 3, surface });
  const threads = detailed ? 13 : 7;
  for (let index = 0; index < threads; index++) {
    const tx = x - width * .4 + index * width * .8 / (threads - 1);
    site.add({ position: [tx, site.base + .53, z + .03], shape: "cylinder", size: [.0035, .55, .0035],
      stage: 3, surface: "rope" });
  }
  site.add({ position: [x, site.base + .48, z + .03], shape: "box", size: [width * .84, .035, .04],
    stage: 3, surface: "wood" });
  // Finished cloth rolls over the lower beam; the weaver works above it.
  site.add({ position: [x, site.base + .26, z + .06], rotation: [0, 0, Math.PI / 2], shape: "cylinder",
    size: [.11, width * .72, .11], stage: 3, surface: "cloth" });
  if (!detailed) return;
  for (const side of [-1, 1]) site.add({ position: [x + side * (width / 2 + .03), top - .02, z + .02],
    shape: "cone", size: [.05, .12, .05], stage: 3, surface });
  site.add({ position: [x + .2, site.base + .72, z + .07], shape: "box", size: [.18, .025, .06], stage: 3,
    surface });
  if (site.detailed) for (const y of [.36, .68]) site.add({ position: [x, site.base + y, z - .15],
    shape: "box", size: [width * .8, .035, .014], stage: 3, surface: "paint", tint: INDIGO });
};

/** The open lean-to loom bay right of the Weaver, with its front posts and national roof. */
export const loomBay = (site: FlaxWeaverSite) => ({
  back: -.35, front: site.front, height: site.wallTop - site.base, x0: .6, x1: 1.26
});

export const addBayPosts = (site: FlaxWeaverSite, surface: BuildingPart["surface"]) => {
  const bay = loomBay(site), base = site.base, top = base + bay.height - .02;
  for (const z of [bay.back + .05, bay.front - .04]) site.add({ position: [bay.x1 - .06, (base + top) / 2, z],
    shape: "box", size: [.09, bay.height, .09], stage: 1, surface });
  site.add({ position: [bay.x1 - .06, top - .03, (bay.back + bay.front) / 2], shape: "bevel-box",
    size: [.1, .08, bay.front - bay.back], stage: 2, surface });
};

/** Back and outer side wall of the Weaver's lean-to bay; the house wall closes its fourth side. */
export const addBayWalls = (site: FlaxWeaverSite, surface: BuildingPart["surface"]) => {
  const bay = loomBay(site), top = site.base + bay.height, t = WALL_THICKNESS;
  site.add({ position: [(bay.x0 + bay.x1) / 2, (site.base + top) / 2, bay.back + t / 2], shape: "box",
    size: [bay.x1 - bay.x0, top - site.base, t], stage: 1, surface });
  // A waist-high side wall shelters the loom without hiding it from the yard.
  site.add({ position: [bay.x1 - t / 2, site.base + .16, (bay.back + bay.front) / 2], shape: "box",
    size: [t, .32, bay.front - bay.back], stage: 1, surface });
};

/** A single-pitch roof slab over the rack or loom bay, falling toward +x. */
export const addLeanToRoof = (site: FlaxWeaverSite, x0: number, x1: number, z0: number, z1: number,
  high: number, low: number, surface: BuildingPart["surface"], thickness = .055) => {
  const run = x1 - x0, rise = high - low, length = Math.hypot(run, rise);
  site.add({ position: [(x0 + x1) / 2, (high + low) / 2, (z0 + z1) / 2], rotation: [0, 0, Math.atan2(rise, run)],
    shape: "box", size: [length, thickness, z1 - z0], stage: 4, surface });
};

export const addJar = (site: FlaxWeaverSite, x: number, z: number, height: number,
  tint: Point3, detailed: boolean) => {
  site.add({ position: [x, site.base + height / 2, z], shape: "clay-jar", size: [height * .78, height, height * .78],
    stage: 3, surface: "paint", tint });
  if (!detailed) return;
  site.add({ position: [x, site.base + height + .008, z], shape: "cylinder", size: [height * .45, .018, height * .45],
    stage: 3, surface: "paint", tint });
};

export const TERRACOTTA = srgbToLinear(.74, .4, .24);
export const LINEN = srgbToLinear(.87, .81, .66);
export const INDIGO = srgbToLinear(.18, .3, .62);


/** Minimal Viking roof: two steep shingled slopes matching the High national roof map. */
export const addThatchGableRoof = (site: FlaxWeaverSite, x0: number, x1: number, z0: number, z1: number,
  eave: number, rise: number) => {
  const width = x1 - x0, depth = z1 - z0, run = depth / 2;
  const slope = Math.atan2(rise, run), length = Math.hypot(rise, run);
  for (const side of [-1, 1]) site.add({ position: [(x0 + x1) / 2, eave + rise / 2,
    (z0 + z1) / 2 + side * run / 2], rotation: [side * slope, 0, 0], shape: "box",
    size: [width, .09, length + .08], stage: 4, surface: "roof" });
  site.add({ position: [(x0 + x1) / 2, eave + rise + .04, (z0 + z1) / 2], rotation: [0, 0, Math.PI / 2],
    shape: "cylinder", size: [.12, width + .08, .12], stage: 4, surface: "bark" });
  for (const end of [-1, 1]) site.add({ position: [end < 0 ? x0 + .04 : x1 - .04, eave + rise / 2,
    (z0 + z1) / 2], shape: "gable", size: [.08, rise - .03, depth - .08], stage: 3, surface: "planks" });
  if (!site.detailed) return;
  for (const z of [z0 + .12, z1 - .12]) site.add({ position: [(x0 + x1) / 2, eave + rise * .45, z],
    rotation: [Math.PI / 2, 0, 0], shape: "cylinder", size: [.035, width, .035], stage: 3, surface: "bark" });
};
