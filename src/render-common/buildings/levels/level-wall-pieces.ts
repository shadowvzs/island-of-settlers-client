import type { WorkerNation } from "../../workers/worker-unit";
import type { Point3 } from "../building-recipe";
import type { WallRun } from "../nation-kit-classify";
import {
  type Box, boxOf, groundWalls, isFree, isInsidePlot, type LevelKit, onWallFace, spansClearOfDoor, wallFace
} from "./level-kit";

/**
 * Wall-mounted alternatives for buildings whose roof, door or yard has no room for a level's usual
 * pieces: a lantern on a bracket (levels 2-3) and a side canopy (4).
 */
export interface WallPiece {
  /** Width along the wall, height and reach out from its face. */
  size: [number, number, number];
  /** Bottoms of the piece over the ground tried on this wall, best first. */
  bottoms: (kit: LevelKit, wall: WallRun) => readonly number[];
  /** Wall trims (timber framing, bands) up to this far out from the face lie behind the piece. */
  overTrim?: number;
  /** The piece may not stand in front of a window opening (an oriel or annex, not a lamp). */
  clearOfWindows?: boolean;
}
/** `standoff`: how far past the plan's wall face the actual (thicker, Nubian) wall stands. */
interface WallSpot { wall: WallRun; t: number; bottom: number; facing: number; standoff: number }

const SPOT_STEPS = [.5, .3, .7, .15, .85];
const STANDOFFS = [0, .05, .1];
/** Spots this close to an earlier wall piece are taken. */
const PIECE_SPACING = .45;

/** Pieces keep this far beside the doorway: the settlers' lane and the leaf's sweep stay open. */
const DOOR_CLEARANCE = .2;
/** Pieces hang clear of the plinth and the yard props below them. */
const MIN_BOTTOM = .25;

const wallTop = (wall: WallRun) => wall.base + wall.height;

/** The piece's box against a wall at fraction `t`, from `bottom` up, `standoff` out from the face. */
const pieceBox = (kit: LevelKit, wall: WallRun, t: number, bottom: number, standoff: number,
  [width, height, reach]: WallPiece["size"]) => {
  const at = onWallFace(kit.site, wall, t, bottom + height / 2, standoff + reach / 2 + .01);
  const size: Point3 = wall.along === 0 ? [width, height, reach] : [reach, height, width];
  return boxOf(at, size);
};

/** Walls in front of the door keep the door lane clear: the piece lies inside one of its open spans. */
const clearOfDoor = (kit: LevelKit, wall: WallRun, t: number, width: number) => {
  const half = width / 2 / wall.length;
  return spansClearOfDoor(kit.site, wall, DOOR_CLEARANCE).some(([from, to]) => t - half >= from && t + half <= to);
};

/** The settlers' lane in front of the door, up to head height over the door (walls split by the door included). */
const crossesDoorLane = (kit: LevelKit, box: Box) => {
  const { door } = kit.site;
  return box.max[2] > door.z - .05 && box.min[1] < door.top + .08 &&
    box.max[0] > door.left - DOOR_CLEARANCE && box.min[0] < door.right + DOOR_CLEARANCE;
};

interface SpotTry { wall: WallRun; t: number; bottom: number; standoff: number }

/** True when a window opening on the wall's face overlaps the piece's box along the wall and in height. */
export const coversWindow = (kit: LevelKit, wall: WallRun, box: Box) => {
  const { axis, face } = wallFace(kit.site, wall), along = wall.along;
  return kit.site.parts.some(part => {
    if (!part.windowShadow) return false;
    const at = part.windowOpeningPosition ?? part.position, size = part.windowOpeningSize ?? part.size;
    if (Math.abs(at[axis]! - face) > .15) return false;
    return at[along]! + size[along]! / 2 > box.min[along]! && at[along]! - size[along]! / 2 < box.max[along]! &&
      at[1] + size[1] / 2 > box.min[1] && at[1] - size[1] / 2 < box.max[1];
  });
};

const isOpenSpot = (kit: LevelKit, { bottom, standoff, t, wall }: SpotTry, piece: WallPiece, taken: readonly Point3[]) => {
  const top = bottom + piece.size[1];
  if (bottom < MIN_BOTTOM || top > wallTop(wall) - .03 || !clearOfDoor(kit, wall, t, piece.size[0])) return false;
  const box = pieceBox(kit, wall, t, bottom, standoff, piece.size), { axis, face, sign } = wallFace(kit.site, wall);
  const centre: Point3 = [(box.min[0] + box.max[0]) / 2, 0, (box.min[2] + box.max[2]) / 2];
  if (taken.some(point => Math.hypot(point[0] - centre[0], point[2] - centre[2]) < PIECE_SPACING)) return false;
  // The wall it hangs on (and what lies behind its face) never blocks it.
  const reach = standoff + .015 + (piece.overTrim ?? 0);
  const behind = (bounds: Box) => sign > 0 ? bounds.max[axis]! <= face + reach : bounds.min[axis]! >= face - reach;
  if (piece.clearOfWindows && coversWindow(kit, wall, box)) return false;
  return isInsidePlot(kit.site, box) && !crossesDoorLane(kit, box) && isFree(kit.site, box, .02, behind);
};

/** The first open spot on a wall: closest to the face, then by height, then along the wall. */
const firstOpenSpot = (kit: LevelKit, wall: WallRun, piece: WallPiece, taken: readonly Point3[]) => {
  for (const standoff of STANDOFFS) for (const bottom of piece.bottoms(kit, wall)) for (const t of SPOT_STEPS) {
    const spot = { bottom, standoff, t, wall };
    if (isOpenSpot(kit, spot, piece, taken)) return spot;
  }
  return null;
};

/** The open wall spot that best faces the usual camera (south-east), or null. */
export const findWallSpot = (kit: LevelKit, piece: WallPiece, taken: readonly Point3[] = []): WallSpot | null => {
  let best: WallSpot | null = null;
  for (const wall of groundWalls(kit.site, piece.size[0] + .1)) {
    const { axis, sign } = wallFace(kit.site, wall), facing = axis === 2 ? sign * .8 : sign * .6;
    // The default camera looks from +X/+Z: hidden -X/-Z walls are left to the caller's fallbacks.
    if (facing <= 0) continue;
    if (best && facing <= best.facing) continue;
    const found = firstOpenSpot(kit, wall, piece, taken);
    if (found) best = { ...found, facing };
  }
  return best;
};

/**
 * A point `out` from the spot's (plan) wall face at height `y`, the face's outward axis and sign and
 * the standoff: parts fixed to the wall start at the plan face and reach that much further.
 */
export const spotFrame = (kit: LevelKit, spot: WallSpot) => {
  const { axis, sign } = wallFace(kit.site, spot.wall);
  return { along: spot.wall.along, axis, at: (y: number, out: number) => onWallFace(kit.site, spot.wall, spot.t, y, out),
    sign, standoff: spot.standoff };
};

/** Size along the wall, the outward axis and up, as a box size. */
export const oriented = (along: 0 | 2, alongSize: number, height: number, outSize: number): Point3 =>
  along === 0 ? [alongSize, height, outSize] : [outSize, height, alongSize];

const LANTERN: WallPiece = { bottoms: (kit, wall) => [Math.min(kit.site.door.top - .12, wallTop(wall) - .36)],
  overTrim: .05, size: [.14, .3, .22] };

/** Wall lantern: an iron bracket from the wall, a glazed lamp hanging from its end and a small cap. */
export const addWallLantern = (kit: LevelKit) => {
  const taken = kit.site.parts.filter(part => part.stage === 3 && part.surface === "amber").map(part => part.position);
  const spot = findWallSpot(kit, LANTERN, taken);
  if (!spot) return;
  const frame = spotFrame(kit, spot), armY = spot.bottom + .27, arm = .2 + frame.standoff;
  kit.add({ position: frame.at(armY, arm / 2 - .01), shape: "box", size: oriented(frame.along, .022, .022, arm),
    surface: "iron" });
  const lampTop = armY - .011, lamp = frame.at(lampTop - .055, .16 + frame.standoff);
  kit.add({ position: lamp, shape: "box", size: [.07, .11, .07], surface: "amber", nightLamp: true });
  if (kit.detailed) kit.add({ position: [lamp[0], lamp[1] - .062, lamp[2]], shape: "box", size: [.08, .016, .08],
    surface: "iron" });
  kit.add({ position: [lamp[0], lampTop + .02, lamp[2]], radialSegments: 4, rotation: [0, Math.PI / 4, 0],
    shape: "cone", size: [.11, .05, .11], surface: "iron" });
};

export const CANOPY: WallPiece = { bottoms: (kit, wall) => [Math.min(kit.site.door.top + .02, wallTop(wall) - .33)],
  overTrim: .05, size: [.5, .28, .3] };
const CANOPY_PITCH = .32;
export const CANOPY_SURFACE: Readonly<Record<WorkerNation, "roof" | "straw">> = {
  maya: "straw",
  persian: "roof",
  chinese: "roof",
  indigenous: "straw",
  japanese: "roof", nubian: "straw", roman: "roof", viking: "roof"
};

/** Side canopy: a small pent roof on two diagonal struts over a plain stretch of wall. */
export const addSideCanopy = (kit: LevelKit) => {
  const spot = findWallSpot(kit, CANOPY);
  if (!spot) return;
  const frame = spotFrame(kit, spot), [width, height] = CANOPY.size, top = spot.bottom + height;
  const reach = CANOPY.size[2] + frame.standoff;
  const drop = Math.tan(CANOPY_PITCH) * reach, length = reach / Math.cos(CANOPY_PITCH);
  const slope: Point3 = frame.along === 0 ? [frame.sign * CANOPY_PITCH, 0, 0] : [0, 0, -frame.sign * CANOPY_PITCH];
  kit.add({ position: frame.at(top - drop / 2 - .02, reach / 2), rotation: slope, shape: "box",
    size: oriented(frame.along, width, .035, length), stage: 4, surface: CANOPY_SURFACE[kit.site.nation] });
  const strut = Math.hypot(.18, reach * .7), angle = Math.atan2(.18, reach * .7);
  const tilt: Point3 = frame.along === 0 ? [-frame.sign * angle, 0, 0] : [0, 0, frame.sign * angle];
  for (const side of [-1, 1]) {
    const centre = frame.at(top - drop * .7 - .12, reach * .35);
    centre[frame.along] += side * (width / 2 - .05);
    kit.add({ position: centre, rotation: tilt, shape: kit.detailed ? "bevel-box" : "box",
      size: oriented(frame.along, .035, .04, strut), stage: 3, surface: "wood" });
  }
};

/** Bearings (radians from +x towards +z) tried round a round tower: camera-facing first (+X/+Z), then the back. */
const SHAFT_BEARINGS = [Math.PI / 4, 0, Math.PI / 2, Math.PI * 3 / 4, Math.PI, -Math.PI / 2];

/** Shaft lantern: the wall lantern on a round tower body, on an open bearing away from the door. */
export const addShaftLantern = (kit: LevelKit) => {
  const y = kit.site.door.top + .15;
  for (const shaft of kit.site.roundShafts) for (const bearing of SHAFT_BEARINGS) {
    const out = (reach: number): Point3 => [shaft.x + Math.cos(bearing) * (shaft.radius + reach), y,
      shaft.z + Math.sin(bearing) * (shaft.radius + reach)];
    const lamp = out(.16);
    const box = boxOf([lamp[0], y - .04, lamp[2]], [.14, .2, .14]);
    // The tower body itself does not block its own lantern (as for the shaft banner).
    const free = isFree(kit.site, box, .02, bounds => Math.hypot((bounds.min[0] + bounds.max[0]) / 2 - shaft.x,
      (bounds.min[2] + bounds.max[2]) / 2 - shaft.z) < shaft.radius + .02) &&
      isInsidePlot(kit.site, box) && !crossesDoorLane(kit, box);
    if (!free || y + .1 > shaft.top) continue;
    kit.add({ position: out(.09), rotation: [0, -bearing, 0], shape: "box", size: [.22, .022, .022], surface: "iron" });
    const lampTop = y - .011;
    kit.add({ position: [lamp[0], lampTop - .055, lamp[2]], shape: "box", size: [.07, .11, .07], surface: "amber",
      nightLamp: true });
    kit.add({ position: [lamp[0], lampTop + .02, lamp[2]], radialSegments: 4, rotation: [0, Math.PI / 4, 0],
      shape: "cone", size: [.11, .05, .11], surface: "iron" });
    return;
  }
};

/** Shaft banner: the wall banner hung on a round tower body, its cloth tangent to the tower's face. */
export const addShaftBanner = (kit: LevelKit) => {
  const colours = BANNER_COLOURS[kit.site.nation];
  for (const shaft of kit.site.roundShafts) for (const bearing of SHAFT_BEARINGS) for (const share of [.62, .5, .75, .42]) {
    const rodY = shaft.top * share, out = shaft.radius + BANNER_OUT, cos = Math.cos(bearing), sin = Math.sin(bearing);
    const at = (reach: number, along: number, y: number): Point3 =>
      [shaft.x + cos * reach - sin * along, y, shaft.z + sin * reach + cos * along];
    const cloth = at(out, 0, rodY - .23), box = boxOf(cloth, [.36, .5, .36]);
    if (rodY - .45 < kit.site.door.top || !isInsidePlot(kit.site, box) || crossesDoorLane(kit, box) ||
      !isFree(kit.site, box, .01, bounds => Math.hypot((bounds.min[0] + bounds.max[0]) / 2 - shaft.x,
        (bounds.min[2] + bounds.max[2]) / 2 - shaft.z) < shaft.radius + .02)) continue;
    const yaw = -(bearing + Math.PI / 2);
    for (const side of [-1, 1]) kit.add({ position: at(shaft.radius + BANNER_OUT / 2 - .01, side * .12, rodY),
      rotation: [0, -bearing, 0], shape: "box", size: [BANNER_OUT + .04, .016, .016], surface: "iron" });
    kit.add({ position: at(out, 0, rodY), rotation: [0, yaw, 0], shape: "box", size: [.32, .018, .018], stage: 4,
      surface: "wood" });
    kit.add({ position: cloth, rotation: [0, yaw, 0], shape: "box", size: [.24, .44, .012], stage: 4, surface: "cloth",
      tint: colours.cloth });
    if (kit.detailed) kit.add({ position: at(out + .008, 0, rodY - .2), rotation: [0, -bearing + Math.PI / 2, 0],
      shape: "paint-ellipse", size: [.12, .12, .001], stage: 4, surface: "paint", tint: colours.emblem });
    return;
  }
};

/** How far the rod and cloth hang out from the wall face, in front of its trims. */
const BANNER_OUT = .095;

/** Each nation's banner colours: the cloth and, on High, its emblem. */
export const BANNER_COLOURS: Readonly<Record<WorkerNation, { cloth: Point3; emblem: Point3 }>> = {
  maya: { cloth: [.5, .05, .04], emblem: [.86, .66, .22] },
  persian: { cloth: [.5, .05, .04], emblem: [.86, .66, .22] },
  chinese: { cloth: [.5, .05, .04], emblem: [.86, .66, .22] },
  indigenous: { cloth: [.77, .61, .39], emblem: [.2, .16, .1] },
  japanese: { cloth: [.06, .1, .26], emblem: [.86, .82, .7] },
  nubian: { cloth: [.16, .42, .24], emblem: [.86, .66, .22] },
  roman: { cloth: [.5, .05, .04], emblem: [.86, .66, .22] },
  viking: { cloth: [.78, .72, .6], emblem: [.06, .05, .05] }
};
