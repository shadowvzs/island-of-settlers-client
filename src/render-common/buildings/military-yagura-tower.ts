import { DMath } from "../../shared/math/deterministic-math";
import type { Point3 } from "./building-recipe";
import { createWindowShadowPane } from "./building-window-shadows";
import { DARK_DEPTH, faceSize } from "./military-round-tower";
import type { TowerPlan, TowerWindow } from "./military-tower-plan";
import type { Add } from "./nation-kit-parts";

/**
 * Japanese yagura: a square timber-framed tower on a battered (sloped) stone base, an open deck
 * behind a plaster parapet with a tiled coping. `front` keeps a flat front face for a door.
 */
export interface YaguraForm {
  /** Height of the battered stone base and how far each sloped face leans in. */
  base: number;
  batter: number;
  width: number;
  depth: number;
  /** Deck and parapet outline when it overhangs the tower (a gallery); else the base footprint. */
  gallery?: { depth: number; width: number };
  front?: number;
}
/**
 * A taller look-out opening for a garrisoned tower: the lintel stays put, the sill drops by `drop`
 * and a deeper sill ledge (`sillDepth` proud of the frame) hides the leaning soldier's waist.
 * Omitted: the original yagura window (rollback).
 */
export interface YaguraLookout { drop: number; sillDepth: number; width: number }
/** Garrisoned watchtower look-out: 12 cm taller opening (same lintel), wider, with a 9 cm sill ledge. */
export const YAGURA_WATCHTOWER_LOOKOUT: YaguraLookout = { drop: .12, sillDepth: .09, width: .27 };

export interface YaguraTower {
  detailed: boolean; form: YaguraForm; lookout?: YaguraLookout; plan: TowerPlan; x: number; z: number;
}

const DECK_FLOOR = .06;
/** A gallery parapet is thicker: the watchtower flag stands on its back wall. */
const PARAPET = { gallery: .1, height: .2, thickness: .08 };
const COPING = .04;
const COPING_OVERHANG = .02;
const SKIRT_THICKNESS = .03;
const POST = .06;
const WINDOW = { height: .3, width: .23 };

/** Opening of one window: the shared yagura size, or the garrison look-out enlarged downward. */
const windowOpening = (tower: YaguraTower, window: TowerWindow) => {
  const drop = tower.lookout?.drop ?? 0;
  return { height: WINDOW.height + drop, sill: window.sill - drop, width: tower.lookout?.width ?? WINDOW.width };
};

/** Plan extents of the stone base and of the tower body standing on it. */
const outline = ({ form, z }: YaguraTower) => {
  const back = z - form.depth / 2, front = form.front ?? z + form.depth / 2;
  const bodyFront = form.front ?? front - form.batter;
  return { back, bodyBack: back + form.batter, bodyFront, front, halfWidth: form.width / 2 - form.batter };
};

/** Battered stone base: every face leans in, except a flat front carrying a door. */
const addBase = (add: Add, tower: YaguraTower) => {
  const { form, plan, x } = tower, { back, front } = outline(tower), depth = front - back;
  const flatFront = form.front !== undefined;
  const scaleZ = (depth - form.batter * (flatFront ? 1 : 2)) / depth;
  add({ position: [x, plan.base + form.base / 2, (back + front) / 2], shape: "box",
    size: [form.width, form.base, depth], stage: 1, surface: "stone",
    topOffset: flatFront ? [0, 0, depth * (1 - scaleZ) / 2] : undefined,
    topScale: [(form.width - form.batter * 2) / form.width, 1, scaleZ] });
};

/** Plaster body with dark corner posts, and on High a sill and a tie beam round every face. */
const addBody = (add: Add, tower: YaguraTower) => {
  const { detailed, form, plan, x } = tower, { bodyBack, bodyFront, halfWidth } = outline(tower);
  const bottom = plan.base + form.base, top = plan.deck - DECK_FLOOR, height = top - bottom;
  const z = (bodyBack + bodyFront) / 2, depth = bodyFront - bodyBack;
  const centreY=bottom+height/2;
  const openings=tower.plan.windows.map(window=>{
    const opening=windowOpening(tower,window);
    return {axis:window.axis,sign:window.sign,width:opening.width,bottom:opening.sill-centreY,
      top:opening.sill+opening.height-centreY};
  });
  if(form.front!==undefined)openings.push({axis:2,sign:1,width:.46,bottom:-height/2,top:.77-centreY});
  add({ position: [x, centreY, z], shape: openings.length?"yagura-wall":"box",
    yaguraOpenings:openings,size: [halfWidth * 2, height, depth], stage: 1,
    surface: "plaster",interiorShade:[.72,.74,.77] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add({ position: [x + sx * halfWidth, bottom + height / 2,
    z + sz * depth / 2], shape: "box", size: [POST, height, POST], stage: 2, surface: "wood" });
  if (!detailed) return;
  for (const y of [bottom + .03, bottom + height * .55]) {
    for (const side of [-1, 1]) {
      add({ position: [x + side * (halfWidth + .008), y, z], shape: "box", size: [.02, .05, depth], stage: 2,
        surface: "wood" });
      add({ position: [x, y, z + side * (depth / 2 + .008)], shape: "box", size: [halfWidth * 2, .05, .02], stage: 2,
        surface: "wood" });
    }
  }
};

/** Deck floor, the parapet round it and its tiled coping; the deck top is the plan's deck. */
const addDeck = (add: Add, tower: YaguraTower) => {
  const { detailed, form, plan, x } = tower, { back, front } = outline(tower), { height } = PARAPET;
  // The coping overhangs the parapet: together they stay on the tower's footprint.
  const width = (form.gallery?.width ?? form.width) - COPING_OVERHANG * 2;
  const depth = (form.gallery?.depth ?? front - back) - COPING_OVERHANG * 2;
  const z = form.gallery ? tower.z : (back + front) / 2;
  const thickness = form.gallery ? PARAPET.gallery : PARAPET.thickness;
  add({ position: [x, plan.deck - DECK_FLOOR / 2, z], shape: "box", size: [width, DECK_FLOOR, depth], stage: 2,
    surface: "wood" });
  const y = plan.deck + height / 2, capY = plan.deck + height + COPING / 2;
  for (const side of [-1, 1]) {
    add({ position: [x + side * (width - thickness) / 2, y, z], shape: "box", size: [thickness, height, depth],
      stage: 2, surface: "plaster" });
    add({ position: [x, y, z + side * (depth - thickness) / 2], shape: "box",
      size: [width - thickness * 2, height, thickness], stage: 2, surface: "plaster" });
    add({ position: [x + side * (width - thickness) / 2, capY, z], shape: "box",
      size: [thickness + COPING_OVERHANG * 2, COPING, depth + COPING_OVERHANG * 2], stage: 3, surface: "roof-slate" });
    add({ position: [x, capY, z + side * (depth - thickness) / 2], shape: "box",
      size: [width - thickness * 2, COPING, thickness + COPING_OVERHANG * 2], stage: 3, surface: "roof-slate" });
  }
  if (!detailed) return;
  // Gilded finials on the coping corners, as on castle ridges.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add({ position: [x + sx * (width - thickness) / 2,
    plan.deck + height + COPING + .04, z + sz * (depth - thickness) / 2], shape: "cone", size: [.05, .08, .05],
  stage: 3, surface: "gold" });
};

/**
 * A narrow tiled pent roof (hisashi) round the body just under the look-out windows; it reaches
 * no further than the battered base, so the tower keeps its footprint.
 */
const addSkirt = (add: Add, tower: YaguraTower) => {
  const { form, plan, x } = tower, { bodyBack, bodyFront, halfWidth } = outline(tower);
  if (!plan.windows.length) return;
  const edge = Math.min(...plan.windows.map(window => windowOpening(tower, window).sill)) - .1, tilt = .6;
  const reach = form.batter, slope = reach / DMath.cos(tilt), drop = reach * DMath.tan(tilt) / 2;
  const z = (bodyBack + bodyFront) / 2, depth = bodyFront - bodyBack, y = edge - drop;
  for (const side of [-1, 1]) {
    add({ position: [x + side * (halfWidth + reach / 2), y, z], rotation: [0, 0, -side * tilt], shape: "box",
      size: [slope, SKIRT_THICKNESS, depth + reach * 2], stage: 3, surface: "roof-slate" });
    const face = side > 0 ? bodyFront : bodyBack;
    add({ position: [x, y, face + side * reach / 2], rotation: [side * tilt, 0, 0], shape: "box",
      size: [halfWidth * 2 + reach * 2, SKIRT_THICKNESS, slope], stage: 3, surface: "roof-slate" });
  }
};

/** Timber brackets carrying an overhanging gallery. */
const addBrackets = (add: Add, tower: YaguraTower) => {
  const { form, plan, x } = tower;
  if (!form.gallery) return;
  const { bodyBack, bodyFront, halfWidth } = outline(tower), y = plan.deck - DECK_FLOOR - .07;
  const reachX = form.gallery.width / 2 - halfWidth, z = (bodyBack + bodyFront) / 2;
  for (const side of [-1, 1]) for (const along of [-.3, .3]) add({ position: [x + side * (halfWidth + reachX / 2), y,
    z + along], shape: "box", size: [reachX, .14, .06], stage: 2, surface: "wood" });
  const galleryEdge = (side: number) => tower.z + side * form.gallery!.depth / 2;
  for (const [side, face] of [[-1, bodyBack], [1, bodyFront]] as const) {
    const reach = Math.abs(galleryEdge(side) - face);
    for (const along of [-.4, 0, .4]) add({ position: [x + along, y, face + side * reach / 2], shape: "box",
      size: [.06, .14, reach], stage: 2, surface: "wood" });
  }
};

/** A look-out window in a dark timber frame on the body face. */
export const addYaguraWindow = (add: Add, tower: YaguraTower, window: TowerWindow) => {
  const { axis, sign } = window, { bodyBack, bodyFront, halfWidth } = outline(tower);
  const { height, sill, width } = windowOpening(tower, window);
  const zFace = sign > 0 ? bodyFront : bodyBack, middle = sill + height / 2;
  const face = axis === 0 ? tower.x + sign * halfWidth : zFace;
  const along = axis === 0 ? (bodyBack + bodyFront) / 2 : tower.x;
  const at = (offset: number): Point3 =>
    axis === 0 ? [face + sign * offset, middle, along] : [along, middle, face + sign * offset];
  let frameYaw=sign<0?Math.PI:0;
  if(axis===0)frameYaw=sign*Math.PI/2;
  add({ position: at(.006), shape: "yagura-window-frame",size:[width+.07,height+.07,.024],
    rotation:[0,frameYaw,0],stage:2,surface:"wood" });
  add(createWindowShadowPane({ position: at(.023),shape:"box",
    size:faceSize(axis,.01,height,width),stage:2,surface:"dark",windowOpening:true }));
  const ledge = tower.lookout?.sillDepth;
  if (!ledge) return;
  // A timber sill ledge resting on the frame's bottom rail and fixed into the wall face below it.
  const ledgeAt = at(ledge / 2);
  ledgeAt[1] = sill - .035 - .02;
  add({ position: ledgeAt, shape: "box", size: faceSize(axis, ledge, .04, width + .11), stage: 2, surface: "wood" });
};

/** The shared door in the flat front of the base: a dark passage just behind the outward-opening leaf. */
export const addYaguraDoorway = (add: Add, tower: YaguraTower, door: { left: number; right: number; top: number }) => {
  const front = tower.form.front;
  if (front === undefined) return;
  add({ position: [(door.left + door.right) / 2, tower.plan.base + door.top / 2, front + .003 - DARK_DEPTH / 2],
    doorwayShadow: true, shape: "box", size: [door.right - door.left, door.top, DARK_DEPTH], stage: 1, surface: "dark" });
};

export const addYaguraTower = (add: Add, tower: YaguraTower) => {
  addBase(add, tower);
  addBody(add, tower);
  addSkirt(add, tower);
  addDeck(add, tower);
  addBrackets(add, tower);
};
