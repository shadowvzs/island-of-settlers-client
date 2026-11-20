import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingSurface, Point3 } from "./building-recipe";
import type { TowerPlan, TowerWindow } from "./military-tower-plan";
import type { Add, DoorGap } from "./nation-kit-parts";

/** Shaft radius at the foot and under the deck, and the outer radius of the parapet crown. */
export interface RoundTowerForm { base: number; crown: number; top: number }
export interface RoundTowerStyle { deck: BuildingSurface; shaft: BuildingSurface; trim: BuildingSurface }
/**
 * A round tower on its plan: `x`/`z` may differ from the plan where the round crown needs room;
 * `stretch` scales its x and z radii (an oval tower where the plan is narrow).
 */
/**
 * A taller look-out for a garrisoned watchtower: the lintel stays put, the sill drops by `drop` and
 * the sill block stands `sillDepth` proud so it hides the leaning soldier's waist. Omitted: the
 * original window (rollback).
 */
export interface RoundTowerLookout { drop: number; sillDepth: number }
export interface RoundTower { detailed: boolean; form: RoundTowerForm; lookout?: RoundTowerLookout; plan: TowerPlan;
  style: RoundTowerStyle; stretch?: readonly [number, number]; x: number; z: number }

/** Look-out window panel (recognised by the garrison view) and its surround. */
const WINDOW = { height: .3, width: .23 };
const FRAME = { depth: .07, height: .38, proud: .012, width: .31 };
const GALLERY_FLOOR = .08;
const SLIT = { height: .26, width: .045 };
/**
 * Dark doorways are deep blocks, never thin panels, so the garrison view does not take them for
 * look-out windows; the passage behind a door clears its leaf by this gap.
 */
export const DARK_DEPTH = .07;
const DOORWAY_GAP = .03;
export const GATE_JAMB = .14;
export const GATE_HEAD = .22;

export const towerSegments = (detailed: boolean, radius: number) =>
  Math.max(detailed ? 16 : 8, Math.round(radius * (detailed ? 40 : 18)));

/** Where the shaft ends: the deck itself, or the underside of an overhanging gallery floor. */
export const shaftTop = ({ form, plan }: RoundTower) =>
  form.crown > form.top + .02 ? plan.deck - GALLERY_FLOOR : plan.deck;

const corbelHeight = (form: RoundTowerForm) => Math.min(.3, Math.max(.08, (form.crown - form.top) * 1.3));

/** Shaft radius at height `y` (tapered shafts narrow linearly towards the deck). */
export const shaftRadius = (tower: RoundTower, y: number) => {
  const { form, plan } = tower, top = shaftTop(tower);
  const fraction = Math.max(0, Math.min(1, (y - plan.base) / (top - plan.base)));
  return form.base + (form.top - form.base) * fraction;
};

/** Radius multiplier along a horizontal axis. */
const stretchOf = (tower: RoundTower, axis: 0 | 2) => tower.stretch?.[axis === 0 ? 0 : 1] ?? 1;

/** Horizontal size of a disc of `radius` (oval when the tower is stretched). */
export const discSize = (tower: RoundTower, radius: number, height: number): Point3 =>
  [radius * 2 * stretchOf(tower, 0), height, radius * 2 * stretchOf(tower, 2)];

/** A point `distance` out from the tower centre on a cardinal face, `along` sideways. */
const onFace = (tower: RoundTower, axis: 0 | 2, sign: number, distance: number, y: number, along = 0): Point3 =>
  axis === 0 ? [tower.x + sign * distance, y, tower.z + along] : [tower.x + along, y, tower.z + sign * distance];

/** Distance from the centre to the shaft surface on a cardinal face at height `y`. */
const faceDistance = (tower: RoundTower, axis: 0 | 2, y: number) => shaftRadius(tower, y) * stretchOf(tower, axis);

/** A box `thick` across the face, `wide` along it. */
export const faceSize = (axis: 0 | 2, thick: number, tall: number, wide: number): Point3 =>
  axis === 0 ? [thick, tall, wide] : [wide, tall, thick];

/** Shaft, corbel and gallery floor: the deck top is exactly the plan's deck, under every archer post. */
export const addRoundTowerBody = (add: Add, tower: RoundTower) => {
  const { detailed, form, plan, style, x, z } = tower, top = shaftTop(tower);
  const taper = form.top / form.base, segments = towerSegments(detailed, form.base);
  add({ position: [x, (plan.base + top) / 2, z], radialSegments: segments, shape: "cylinder",
    size: discSize(tower, form.base, top - plan.base), stage: 1, surface: style.shaft,
    topScale: taper === 1 ? undefined : [taper, 1, taper] });
  if (top === plan.deck) return;
  const corbel = corbelHeight(form), spread = form.crown / form.top;
  add({ position: [x, top - corbel / 2, z], radialSegments: segments, shape: "cylinder",
    size: discSize(tower, form.top, corbel), stage: 2, surface: style.trim, topScale: [spread, 1, spread] });
  add({ position: [x, plan.deck - GALLERY_FLOOR / 2, z], radialSegments: towerSegments(detailed, form.crown),
    shape: "cylinder", size: discSize(tower, form.crown, GALLERY_FLOOR), stage: 2, surface: style.deck });
};

/** The parapet ring on the deck edge (crown details stand on it). */
export const addRoundParapet = (add: Add, tower: RoundTower, height: number, thickness: number,
  surface: BuildingSurface) => {
  const { detailed, form, plan, x, z } = tower;
  add({ innerRadius: .5 * (form.crown - thickness) / form.crown, position: [x, plan.deck + height / 2, z],
    radialSegments: towerSegments(detailed, form.crown), shape: "ring", size: discSize(tower, form.crown, height),
    stage: 2, surface });
};

/** `count` pieces evenly round the crown at `radius`, each turned to face outwards. */
export const aroundCrown = (tower: RoundTower, count: number, radius: number, offset = .5) =>
  Array.from({ length: count }, (_, index) => {
    const angle = (index + offset) / count * Math.PI * 2;
    return { angle, x: tower.x + DMath.sin(angle) * radius * stretchOf(tower, 0),
      z: tower.z + DMath.cos(angle) * radius * stretchOf(tower, 2) };
  });

/** Roman crenellation: a low parapet ring with merlons standing on it. */
export const addMerlonCrown = (add: Add, tower: RoundTower, surface: BuildingSurface) => {
  const { form, plan } = tower, thickness = .1, wall = .14, merlon = .14;
  addRoundParapet(add, tower, wall, thickness, surface);
  const count = Math.max(6, Math.round(form.crown * Math.PI * 2 / .3));
  for (const { angle, x, z } of aroundCrown(tower, count, form.crown - thickness / 2))
    add({ position: [x, plan.deck + wall + merlon / 2, z], rotation: [0, angle, 0], shape: "box",
      size: [.13, merlon, thickness], stage: 3, surface });
};

/** A framed look-out window on the shaft: the dark panel stands just proud of its surround. */
export const addRoundTowerWindow = (add: Add, tower: RoundTower, window: TowerWindow) => {
  const drop = tower.lookout?.drop ?? 0, sillDepth = tower.lookout?.sillDepth ?? .07;
  const { axis, sign } = window, sill = window.sill - drop, height = WINDOW.height + drop;
  const middle = sill + height / 2, frameHeight = FRAME.height + drop;
  const radius = faceDistance(tower, axis, middle + frameHeight / 2);
  const frameFront = radius + FRAME.proud, surface = tower.style.trim;
  add({ position: onFace(tower, axis, sign, frameFront - FRAME.depth / 2, middle), shape: "box",
    size: faceSize(axis, FRAME.depth, frameHeight, FRAME.width), stage: 2, surface });
  add({ position: onFace(tower, axis, sign, frameFront + .005, middle), shape: "box",
    size: faceSize(axis, .01, height, WINDOW.width), stage: 2, surface: "dark" });
  // The sill block keeps its back against the frame and grows outward.
  add({ position: onFace(tower, axis, sign, frameFront + (sillDepth - .07) / 2, sill - .06), shape: "box",
    size: faceSize(axis, sillDepth, .04, FRAME.width + .04), stage: 2, surface });
};

/** Narrow arrow slits on the faces left free by windows, doors and the hall (High only). */
export const addRoundTowerSlits = (add: Add, tower: RoundTower, faces: ReadonlyArray<[0 | 2, 1 | -1]>) => {
  if (!tower.detailed) return;
  const { plan } = tower, y = plan.base + (plan.deck - plan.base) * .55;
  for (const [axis, sign] of faces) add({ position: onFace(tower, axis, sign, faceDistance(tower, axis, y) + .004, y),
    shape: "box", size: faceSize(axis, .012, SLIT.height, SLIT.width), stage: 2, surface: "dark" });
};

/** Faces without a window: candidates for slits. */
export const freeFaces = (tower: RoundTower, blocked: ReadonlyArray<[0 | 2, number]> = []) =>
  ([[0, 1], [0, -1], [2, 1], [2, -1]] as Array<[0 | 2, 1 | -1]>).filter(([axis, sign]) =>
    !tower.plan.windows.some(window => window.axis === axis && window.sign === sign) &&
    !blocked.some(([other, side]) => other === axis && side === sign));

/**
 * The shared entrance door set into a flat gate bay that grows out of the round shaft: jambs
 * and a lintel around the clear opening, a dark passage just behind the outward-opening leaf.
 */
export const addRoundTowerGate = (add: Add, tower: RoundTower, door: DoorGap, surface: BuildingSurface) => {
  const jamb = GATE_JAMB, head = GATE_HEAD, back = door.z - .26, front = door.z + .04, depth = front - back;
  const middle = (back + front) / 2, top = door.top + head, base = tower.plan.base;
  const width = door.right - door.left, center = door.left + width / 2;
  for (const x of [door.left - jamb / 2, door.right + jamb / 2]) add({ position: [x, base + top / 2, middle],
    shape: "box", size: [jamb, top, depth], stage: 1, surface });
  add({ position: [center, base + door.top + head / 2, middle], shape: "box", size: [width, head, depth], stage: 1,
    surface });
  add({ position: [center, base + door.top / 2, door.z - DOORWAY_GAP - DARK_DEPTH / 2], shape: "box",
    doorwayShadow: true, size: [width, door.top, DARK_DEPTH], stage: 1, surface: "dark" });
};

/** A doorway on the hall side of a guard tower, under the hall's eaves. */
export const addRoundTowerPassage = (add: Add, tower: RoundTower, sign: 1 | -1) => {
  const height = .62, distance = faceDistance(tower, 0, tower.plan.base + height);
  add({ position: onFace(tower, 0, sign, distance + .004 - DARK_DEPTH / 2, tower.plan.base + height / 2), shape: "box",
    doorwayShadow: true, size: faceSize(0, DARK_DEPTH, height, .26), stage: 2, surface: "dark" });
};

/** A block on the deck, against the parapet's inner face, carrying the flag at the parapet top. */
export const addFlagSocket = (add: Add, tower: RoundTower, flag: Point3, thickness: number,
  surface: BuildingSurface) => {
  const height = flag[1] - tower.plan.deck, dx = flag[0] - tower.x, dz = flag[2] - tower.z;
  const distance = DMath.hypot(dx, dz), wall = tower.form.crown - thickness + .02;
  if (height < .02 || !distance || distance >= wall) return;
  // From just inside the flag pole out to the parapet wall, along the radius through the pole.
  const from = distance - .08, middle = (from + wall) / 2, length = wall - from;
  const ux = dx / distance, uz = dz / distance, radial = Math.abs(uz) > Math.abs(ux);
  add({ position: [tower.x + ux * middle, tower.plan.deck + height / 2, tower.z + uz * middle], shape: "box",
    size: radial ? [.16, height, length] : [length, height, .16], stage: 2, surface });
};
