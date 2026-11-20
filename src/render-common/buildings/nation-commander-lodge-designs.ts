import type { WorkerNation } from "../workers/worker-unit";
import type { BuildingPart, BuildingRecipe, BuildingSurface, Point3 } from "./building-recipe";
import { createDecorativeWeaponRack } from "./national-decorative-weapons";
import { COMMANDER_LODGE } from "./roman-commander-lodge";

type LodgeNation = WorkerNation;
type Add = (surface: BuildingSurface, position: Point3, size: Point3, stage?: number,
  shape?: BuildingPart["shape"], rotation?: Point3, tint?: Point3) => BuildingPart;

const FRONT = COMMANDER_LODGE.centreZ + COMMANDER_LODGE.depth / 2;
/** Stable/mount bay: open to the front-east, attached to the hall's camera-side wall. */
const BAY = { back: -.18, front: .44, inner: .64, outer: 1.42, roofY: .91, wallTop: .98 } as const;
const OUTWARD = Math.sign(BAY.outer - BAY.inner);
/** Mustering-yard fence line: outside the door lane and the keeper's work point. */
const FENCE = { left: -1.55, leftInner: -.65, right: .9, rightOuter: 1.55, z: .98 } as const;
const STANDARD = { height: 1.55, x: -1.48, z: .62 } as const;

interface LodgeStyle {
  banner: Point3;
  emblem: Point3;
  floor: BuildingSurface;
  post: BuildingSurface;
  postRound: boolean;
  roof: BuildingSurface;
  trim: Point3;
}

const STYLES: Readonly<Record<LodgeNation, LodgeStyle>> = {
  maya: { banner: [.55, .09, .06], emblem: [.88, .7, .3], floor: "stone", post: "stone", postRound: true,
    roof: "roof", trim: [.84, .69, .34] },
  persian: { banner: [.55, .09, .06], emblem: [.88, .7, .3], floor: "stone", post: "stone", postRound: true,
    roof: "roof", trim: [.84, .69, .34] },
  chinese: { banner: [.55, .09, .06], emblem: [.88, .7, .3], floor: "stone", post: "stone", postRound: true,
    roof: "roof", trim: [.84, .69, .34] },
  indigenous: { banner: [.55, .09, .06], emblem: [.88, .7, .3], floor: "stone", post: "stone", postRound: true,
    roof: "roof", trim: [.84, .69, .34] },
  japanese: { banner: [.12, .16, .32], emblem: [.88, .84, .7], floor: "planks", post: "wood", postRound: true,
    roof: "roof-shingles", trim: [.82, .72, .48] },
  nubian: { banner: [.72, .45, .12], emblem: [.1, .36, .34], floor: "stone", post: "plaster", postRound: true,
    roof: "roof", trim: [.34, .48, .42] },
  roman: { banner: [.55, .09, .06], emblem: [.88, .7, .3], floor: "stone", post: "stone", postRound: true,
    roof: "roof", trim: [.84, .69, .34] },
  viking: { banner: [.45, .08, .07], emblem: [.86, .78, .56], floor: "planks", post: "bark", postRound: true,
    roof: "roof", trim: [.78, .63, .32] }
};

/** Authored cue points shared by the design tests and the native review framing. */
export const COMMANDER_LODGE_CUES = Object.freeze({
  bay: BAY,
  fence: FENCE,
  front: FRONT,
  standard: STANDARD
});

const adder = (parts: BuildingPart[]): Add => (surface, position, size, stage = 2, shape = "box", rotation, tint) => {
  const part: BuildingPart = { compactGeometry: true, position, rotation, shape, size, stage, surface, tint };
  parts.push(part);
  return part;
};

const addPost = (add: Add, style: LodgeStyle, x: number, z: number, height: number, width = .07) => {
  add(style.post, [x, height / 2, z], [width, height, width], 2, style.postRound ? "cylinder" : "bevel-box");
};

/** A national lean-to roof over the open mount bay, carried by the hall wall and two posts. */
const addBayRoof = (add: Add, style: LodgeStyle, detailed: boolean) => {
  const centreX = (BAY.inner + BAY.outer) / 2, span = Math.abs(BAY.inner - BAY.outer);
  add(style.roof, [centreX, BAY.roofY, (BAY.back + BAY.front) / 2],
    [span, .045, BAY.front - BAY.back], 4, "box", [0, 0, -.19 * OUTWARD]);
  for (const z of [BAY.back + .06, BAY.front - .06]) addPost(add, style, BAY.outer, z, .84);
  add("wood", [BAY.outer, .84, (BAY.back + BAY.front) / 2],
    [.07, .06, BAY.front - BAY.back], 3, "bevel-box");
  add("wood", [BAY.inner, .84, (BAY.back + BAY.front) / 2],
    [.07, .06, BAY.front - BAY.back], 3, "bevel-box");
  if (!detailed) return;
  for (const z of [BAY.back + .06, BAY.front - .06])
    add("wood", [BAY.outer - OUTWARD * .06, .78, z], [.08, .08, .08], 3, "bevel-box");
};

/** Hay, saddle, water and a hitching rail: the mount is kept here, never as loose horse stock. */
const addStableCues = (add: Add, style: LodgeStyle, detailed: boolean) => {
  const floorX = (BAY.inner + BAY.outer) / 2, floorZ = (BAY.back + BAY.front) / 2;
  add(style.floor, [floorX, .012, floorZ],
    [Math.abs(BAY.inner - BAY.outer) - .04, .024, BAY.front - BAY.back - .04], 1);
  const hayX = BAY.outer - OUTWARD * .3, troughX = BAY.outer - OUTWARD * .22;
  // Straw bale and its two rope bands.
  add("straw", [hayX, .14, .27], [.32, .28, .24], 3);
  for (const z of [.18, .36]) add("rope", [hayX, .14, z], [.33, .018, .018], 3);
  // Saddle on a wall rack, with stirrup leathers.
  const rackX = BAY.inner + OUTWARD * .035, saddleX = rackX + OUTWARD * .045;
  add("wood", [rackX, .52, .02], [.07, .06, .36], 3, "bevel-box");
  add("hide", [saddleX, .60, .02], [.16, .1, .24], 3, "bevel-box");
  add("wood", [saddleX + OUTWARD * .01, .66, .02], [.1, .05, .06], 3, "bevel-box");
  if (detailed) for (const z of [-.07, .11])
    add("rope", [saddleX + OUTWARD * .07, .5, z], [.025, .08, .025], 3, "cylinder");
  // Water trough with a real water surface.
  add("wood", [troughX, .09, -.11], [.3, .18, .24], 3, "bevel-box");
  add("paint", [troughX, .185, -.11], [.22, .012, .16], 3, "box", undefined, [.18, .4, .5]);
  // Hitching rail at the open end of the bay.
  const railX = BAY.outer - OUTWARD * .03;
  for (const z of [.34, .58]) addPost(add, style, railX, z, .5, .055);
  add("wood", [railX, .44, .46], [.05, .05, .28], 3, "bevel-box");
  if (detailed) add("rope", [railX, .39, .46], [.018, .1, .2], 3, "ring", [0, 0, Math.PI / 2]);
};

/** Low fence and gate posts of the small mustering yard, clear of the door and keeper lane. */
const addYardFence = (add: Add, style: LodgeStyle, detailed: boolean) => {
  const segments: Array<[number, number]> = [[FENCE.left, FENCE.leftInner], [FENCE.right, FENCE.rightOuter]];
  for (const [from, to] of segments) {
    const posts = detailed ? 4 : 2;
    for (let index = 0; index < posts; index++) {
      const x = from + (to - from) * index / (posts - 1);
      addPost(add, style, x, FENCE.z, .56, .075);
      if (!detailed) continue;
      add(style.post, [x, .585, FENCE.z], [.11, .05, .11], 3, "bevel-box");
    }
    for (const y of [.28, .44]) add("wood", [(from + to) / 2, y, FENCE.z], [to - from, .045, .05], 3, "bevel-box");
  }
  for (const x of [FENCE.leftInner, FENCE.right]) {
    addPost(add, style, x, FENCE.z, .7, .09);
    add("gold", [x, .685, FENCE.z], [.1, .1, .1], 3, "sphere");
  }
};

/** Weapon rack, training post and a woven mat: a working muster ground, not a decorative lawn. */
const addMusterCues = (add: Add, style: LodgeStyle, nation: LodgeNation, detailed: boolean) => {
  for (const part of createDecorativeWeaponRack(nation, 62, [-1.06, 0, .73], detailed, .28, .76))
    Object.assign(add(part.surface, part.position, part.size, part.stage, part.shape, part.rotation, part.tint), part);
  // Training post with a straw body and crossbar.
  addPost(add, style, 1.12, .64, .92, .09);
  add("wood", [1.12, .7, .64], [.62, .06, .06], 3, "bevel-box");
  add("straw", [1.12, .52, .64], [.28, .32, .2], 3);
  add("straw", [1.12, .78, .64], [.18, .18, .18], 3, "sphere");
  if (detailed) add("paint", [1.12, .78, .745], [.12, .12, .012], 3, "box", undefined, style.banner);
  add("straw", [.68, .014, .78], [.44, .028, .46], 3);
  add("straw", [-.86, .014, .8], [.36, .028, .4], 3);
};

/** The national commander's standard: cloth, trim, emblem and a gilded finial. */
const addStandard = (add: Add, style: LodgeStyle, nation: LodgeNation, detailed: boolean) => {
  const { height, x, z } = STANDARD;
  add("wood", [x, height / 2, z], [.07, height, .07], 2, "cylinder");
  add("stone", [x, .05, z], [.24, .1, .24], 2, "bevel-box");
  add("gold", [x, height + .04, z], [.12, .12, .12], 3, "sphere");
  add("wood", [x + .2, height - .03, z], [.42, .05, .05], 3, "bevel-box");
  add("cloth", [x + .2, height - .29, z + .012], [.4, .48, .02], 3, "box", undefined, style.banner);
  add("cloth", [x + .2, height - .53, z + .012], [.4, .04, .022], 3, "box", undefined, style.trim);
  if (detailed) for (const side of [-1, 1])
    add("cloth", [x + .2 + side * .19, height - .29, z + .012], [.02, .48, .022], 3, "box", undefined, style.trim);
  addStandardEmblem(add, style, nation, x + .2, height - .3, z + .026, detailed);
};

const addStandardEmblem = (add: Add, style: LodgeStyle, nation: LodgeNation, x: number, y: number, z: number,
  detailed: boolean) => {
  if (nation === "japanese") {
    add("paint", [x, y, z], [.18, .18, .012], 3, "sphere", undefined, style.emblem);
    if (detailed) add("paint", [x, y, z + .008], [.1, .1, .01], 3, "sphere", undefined, style.banner);
    return;
  }
  if (nation === "viking") {
    add("gold", [x, y, z], [.34, .035, .012], 3, "box", [0, 0, .55]);
    add("gold", [x, y, z], [.34, .035, .012], 3, "box", [0, 0, -.55]);
    return;
  }
  if (nation === "nubian") {
    add("gold", [x, y, z], [.26, .03, .014], 3, "box", [0, 0, Math.PI / 4]);
    add("gold", [x, y, z], [.26, .03, .014], 3, "box", [0, 0, -Math.PI / 4]);
    return;
  }
  // Roman laurel disc with a small gilded boss.
  add("gold", [x, y, z], [.22, .22, .012], 3, "ring");
  add("gold", [x, y, z + .01], [.07, .07, .012], 3, "sphere");
  if (!detailed) return;
  for (let index = 0; index < 6; index++) {
    const angle = index * Math.PI / 3;
    add("gold", [x + Math.cos(angle) * .09, y + Math.sin(angle) * .09, z + .012],
      [.035, .07, .012], 3, "box", [0, 0, angle]);
  }
};

/** A national crest beside the door, on the front wall; it never enters the entrance lane. */
const addFacadeCrest = (add: Add, style: LodgeStyle, nation: LodgeNation, detailed: boolean) => {
  const x = -.43, y = .78, z = FRONT + .075;
  if (nation === "viking") {
    add("paint", [x, y, z], [.27, .27, .04], 3, "round-shield");
    add("steel", [x, y, z + .025], [.08, .08, .025], 3, "sphere");
    return;
  }
  if (nation === "japanese") {
    add("paint", [x, y, z], [.3, .18, .025], 3, "folding-fan");
    return;
  }
  if (nation === "nubian") {
    add("paint", [x, y, z], [.28, .42, .022], 3, "nubian-textile");
    add("gold", [x, y + .23, z - .005], [.32, .025, .025], 3, "cylinder", [0, 0, Math.PI / 2]);
    return;
  }
  add("paint", [x, y, z], [.28, .1, .03], 3, "box", undefined, [.62, .08, .06]);
  add("steel", [x, y, z + .02], [.22, .06, .02], 3, "box");
  if (detailed) for (const side of [-1, 1])
    add("gold", [x + side * .18, y, z - .005], [.03, .28, .02], 3, "box", [0, 0, side * .25]);
};

/** National extras: a few signature props that make each lodge recognisably its nation's. */
const addNationalProps = (add: Add, style: LodgeStyle, nation: LodgeNation, detailed: boolean) => {
  if (nation === "roman") {
    add("stone", [.55, .11, .55], [.34, .22, .28], 3, "bevel-box");
    add("gold", [.55, .24, .55], [.3, .025, .24], 3, "bevel-box");
    if (!detailed) return;
    add("paint", [.55, .27, .55], [.22, .03, .18], 3, "box", undefined, [.56, .1, .07]);
    return;
  }
  if (nation === "viking") {
    add("wood", [BAY.outer - OUTWARD * .19, .18, .35], [.22, .36, .22], 3, "cylinder", undefined, [.45, .3, .16]);
    for (const y of [.12, .3]) add("iron", [BAY.outer - OUTWARD * .19, y, .35], [.24, .022, .24], 3, "ring");
    add("paint", [BAY.inner + OUTWARD * .02, .62, .3], [.26, .26, .04], 3, "round-shield");
    return;
  }
  if (nation === "nubian") {
    for (const step of detailed ? [.28, .1] : [.2]) {
      const x = BAY.outer - OUTWARD * step;
      add("paint", [x, .16, .38], [.18, .3, .18], 3, "clay-jar", undefined, [.6, .32, .14]);
      add("gold", [x, .32, .38], [.12, .02, .12], 3, "ring");
    }
    add("paint", [BAY.inner + OUTWARD * .015, .68, .35], [.34, .5, .02], 3, "nubian-textile",
      undefined, style.trim);
    return;
  }
  add("straw", [BAY.outer - OUTWARD * .22, .12, .34], [.3, .24, .22], 3);
  add("wood", [BAY.outer - OUTWARD * .22, .26, .34], [.32, .025, .24], 3, "bevel-box");
  add("paint", [BAY.inner + OUTWARD * .08, .72, .32], [.16, .26, .022], 3, "paper-lantern");
  add("rope", [BAY.inner + OUTWARD * .08, .88, .32], [.012, .13, .012], 3, "cylinder");
};

/**
 * Post-national-kit lodge design: the stable/mount bay, mustering yard, national standard,
 * facade crest and signature props. Every addition is grounded or attached to the hall; the
 * canonical door, worker exit, work point, stock contacts and level-1 anchors are untouched.
 */
export const applyCommanderLodgeDesign = (
  recipe: BuildingRecipe, nation: LodgeNation, detailed: boolean
): BuildingRecipe => {
  const parts = [...recipe.parts];
  const add = adder(parts);
  const style = STYLES[nation];
  addStableCues(add, style, detailed);
  addBayRoof(add, style, detailed);
  addYardFence(add, style, detailed);
  if (nation !== "roman") addMusterCues(add, style, nation, detailed);
  // The Commander's Lodge is military (owner 2026-11-09): every national lodge keeps its standard.
  addStandard(add, style, nation, detailed);
  addFacadeCrest(add, style, nation, detailed);
  if (nation !== "roman") addNationalProps(add, style, nation, detailed);
  return { ...recipe, parts };
};
