import type { Point3 } from "../building-recipe";
import { addShingledSlab } from "../nation-roof-shingles";
import { boxOf, doorFront, isFree, type LevelKit } from "./level-kit";
import { isLeanPiece } from "./level-lean";

/** Hood over the door: wider than the door lane, well above the settler's head and the door frame. */
const HOOD = { pitch: .32, rise: .22, sideReach: .16, thickness: .04 } as const;
const PROJECTIONS = [.34, .24];

interface HoodFrame { centreX: number; face: number; projection: number; top: number; width: number }

const findHood = (kit: LevelKit): HoodFrame | null => {
  const front = doorFront(kit.site);
  if (!front) return null;
  const { door } = kit.site, { face } = front, top = door.top + HOOD.rise;
  const width = door.right - door.left + HOOD.sideReach * 2, centreX = (door.left + door.right) / 2;
  for (const projection of PROJECTIONS) {
    const box = boxOf([centreX, top - .03, face + projection / 2 + .05], [width + .06, .16, projection - .1]);
    if (isFree(kit.site, box, .015, bounds => bounds.max[2] <= face + .015)) return { centreX, face, projection, top, width };
  }
  return null;
};

/** The sloping hood slab (centre and size), falling from the wall to its front edge. */
const slab = (hood: HoodFrame) => {
  const drop = Math.tan(HOOD.pitch) * hood.projection, length = hood.projection / Math.cos(HOOD.pitch);
  return { centre: [hood.centreX, hood.top - drop / 2, hood.face + hood.projection / 2] as Point3, drop, length };
};

/** Diagonal timber struts from the wall up to the hood's front underside. */
const addBrackets = (kit: LevelKit, hood: HoodFrame, drop: number) => {
  const height = .2, run = hood.projection * .7, angle = Math.atan2(height, run), length = Math.hypot(height, run);
  for (const side of [-1, 1]) {
    const x = hood.centreX + side * (hood.width / 2 - .05);
    kit.add({ position: [x, hood.top - drop * .7 - height / 2 - .03, hood.face + run / 2], rotation: [-angle, 0, 0],
      shape: "bevel-box", size: [.04, .045, length], stage: 3, surface: "wood" });
  }
};

const tiledHood = (kit: LevelKit, hood: HoodFrame) => {
  const { centre, drop, length } = slab(hood);
  kit.add({ position: centre, rotation: [HOOD.pitch, 0, 0], shape: "box", size: [hood.width, HOOD.thickness, length],
    stage: 4, surface: "roof" });
  kit.add({ position: [hood.centreX, hood.top + .02, hood.face + .02], shape: "bevel-box",
    size: [hood.width + .02, .05, .045], stage: 4, surface: kit.site.nation === "japanese" ? "roof" : "cut-stone" });
  if (kit.site.nation === "japanese") kit.add({ position: [hood.centreX, hood.top - drop - .02, hood.face +
    hood.projection - .01], shape: "box", size: [hood.width + .04, .04, .035], stage: 4, surface: "wood" });
  addBrackets(kit, hood, drop);
};

const shingledHood = (kit: LevelKit, hood: HoodFrame) => {
  const { centre, drop, length } = slab(hood);
  addShingledSlab(kit.add, { bare: .02, centre, depth: length, length: hood.width, slope: HOOD.pitch, yaw: 0 },
    kit.detailed);
  addBrackets(kit, hood, drop);
  // Carved bargeboards along both open ends.
  for (const side of [-1, 1]) kit.add({ position: [hood.centreX + side * (hood.width / 2 + .015), centre[1] - .02,
    centre[2]], rotation: [HOOD.pitch, 0, 0], shape: "bevel-box", size: [.03, .07, length + .03], stage: 4,
  surface: "wood" });
};

/** Nubian palm awning: beams let into the wall carry a woven palm mat with a hanging fringe. */
const palmAwning = (kit: LevelKit, hood: HoodFrame) => {
  const beams = kit.detailed ? 4 : 2, y = hood.top - .06;
  for (let index = 0; index < beams; index++) {
    const x = hood.centreX - hood.width / 2 + .04 + index * (hood.width - .08) / (beams - 1);
    kit.add({ position: [x, y, hood.face + hood.projection / 2 - .02], radialSegments: 6, rotation: [Math.PI / 2, 0, 0],
      shape: "cylinder", size: [.04, hood.projection + .04, .04], stage: 3, surface: "wood" });
  }
  kit.add({ position: [hood.centreX, y + .035, hood.face + hood.projection / 2], rotation: [.08, 0, 0], shape: "box",
    size: [hood.width + .04, .03, hood.projection], stage: 4, surface: "straw" });
  if (kit.detailed) kit.add({ position: [hood.centreX, y - .01, hood.face + hood.projection + .005], shape: "box",
    size: [hood.width + .04, .07, .012], stage: 4, surface: "straw" });
};

/** Level 4 door hood in the nation's own form, clear of everything already on the front wall. */
export const addDoorHood = (kit: LevelKit) => {
  if (isLeanPiece(kit.site, "door-hood")) return;
  const hood = findHood(kit);
  if (!hood) return;
  if (kit.site.nation === "viking") shingledHood(kit, hood);
  else if (["nubian", "maya", "indigenous"].includes(kit.site.nation)) palmAwning(kit, hood);
  else tiledHood(kit, hood);
};
