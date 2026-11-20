import type { BuildingPart, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { type Bounds, facePoint, faceSize, mergeBounds, type WallFace } from "./nubian-decor-faces";
import {
  eulerFromRotation, multiplyRotations, rotatePoint, type Rotation3,
rotationFromEuler} from "./recipe-rotation";
import { ornamentOffset, ornamentSize, type VikingOrnamentShape } from "./viking-ornament-boxes";

export type VikingDecorKind = "antler-helmet" | "axe-trophy" | "double-axe-trophy" | "longship-relief" | "winged-helmet";

/**
 * Where an assembly hangs: `along` is its centre on the wall, `y` its centre height; `scale` enlarges the
 * authored ornament where the wall has room for it (1 is the authored size).
 */
export interface VikingSpot { along: number; detailed: boolean; face: WallFace; scale: number; y: number }
/** One ornament assembly: its parts and the space it takes in front of the wall (pegs excluded). */
export interface VikingAssembly { occupied: Bounds; parts: BuildingPart[] }

const STAGE = 4;
/** Ornament backs stand this far off the wall plane: clear of the battens and the log rounds. */
const OUT = .03;
/** Pegs are set this deep into the wall. */
const EMBED = .006;
const NO_TURN: Rotation3 = rotationFromEuler([0, 0, 0]);

/** Maps assembly space (x along the wall, y up, z out of the wall) onto the face at the spot. */
const spotFrame = (spot: VikingSpot) => {
  const facing = rotationFromEuler([0, spot.face.yaw, 0]), origin = facePoint(spot.face, spot.along, spot.y, 0);
  const point = (local: Point3) => rotatePoint(facing, local).map((value, axis) => value + origin[axis]!) as Point3;
  const turn = (local: Rotation3) => eulerFromRotation(multiplyRotations(facing, local));
  return { point, turn };
};

type Frame = ReturnType<typeof spotFrame>;

/** A sculpted ornament whose authoring point `anchor` sits at assembly point `at`, turned by `turn`. */
const ornament = (frame: Frame, shape: VikingOrnamentShape, scale: number, anchor: Point3, at: Point3,
  surface: BuildingPart["surface"], turn = NO_TURN): BuildingPart => {
  const offset = rotatePoint(turn, ornamentOffset(shape, anchor, scale));
  return { position: frame.point([at[0] - offset[0], at[1] - offset[1], at[2] - offset[2]]),
    rotation: frame.turn(turn), shape, size: ornamentSize(shape, scale), stage: STAGE, surface };
};

/** A square peg from inside the wall out to `out` (hidden behind what it carries). */
const peg = (spot: VikingSpot, along: number, y: number, out: number): BuildingPart => ({
  position: facePoint(spot.face, along, y, (out - EMBED) / 2), shape: "box",
  size: faceSize(spot.face, .018, .018, out + EMBED), stage: STAGE, surface: "wood"
});

const assembled = (parts: BuildingPart[], pegs: BuildingPart[]): VikingAssembly =>
  ({ occupied: mergeBounds(parts.map(part => getRomanPartBounds(part))), parts: [...pegs, ...parts] });

const HAFT = { length: .44, radius: .011, roll: .62 } as const;
const SHIELD_SCALE = .27;

/** One axe: an ash haft rolled in the wall plane and its head on the upper end, blade facing out. */
const crossedAxe = (frame: Frame, side: -1 | 1, double: boolean, centre: Point3, scale: number) => {
  const roll = rotationFromEuler([0, 0, -side * HAFT.roll]), length = HAFT.length * scale;
  const top = rotatePoint(roll, [0, length / 2 - .03 * scale, 0])
    .map((value, axis) => value + centre[axis]!) as Point3;
  const haft: BuildingPart = { position: frame.point(centre), rotation: frame.turn(roll), shape: "cylinder",
    size: [HAFT.radius * 2 * scale, length, HAFT.radius * 2 * scale], stage: STAGE, surface: "wood" };
  // A bearded blade points away from the crossing: the left axe is turned about its haft.
  const turn = side < 0 ? multiplyRotations(roll, rotationFromEuler([0, Math.PI, 0])) : roll;
  const head = double ? ornament(frame, "double-axe-head", .1 * scale, [0, 0, 0], top, "steel", roll)
    : ornament(frame, "bearded-axe-head", .11 * scale, [-.04, 0, 0], top, "steel", turn);
  return [haft, head];
};

/** Painted round shield over two crossed axes (bearded or two-bladed), hung on a peg. */
const axeTrophy = (spot: VikingSpot, double: boolean): VikingAssembly => {
  const { scale } = spot, frame = spotFrame(spot), radius = HAFT.radius * scale;
  const hafts: Point3 = [0, -.02 * scale, OUT + radius], shieldBack = OUT + radius * 2;
  const parts = [...crossedAxe(frame, -1, double, hafts, scale), ...crossedAxe(frame, 1, double, hafts, scale),
    ornament(frame, "round-shield", SHIELD_SCALE * scale, [0, 0, -.03], [0, 0, shieldBack], "paint")];
  return assembled(parts, [peg(spot, spot.along, spot.y, shieldBack)]);
};

const HELMET_SCALE = .2;

/** A spangenhelm on a wall peg, crowned with red-deer antlers or a valkyrie's feathered wings. */
const helmetTrophy = (spot: VikingSpot, crest: "antler" | "feather-wing"): VikingAssembly => {
  const frame = spotFrame(spot), back = -.54, helmet = HELMET_SCALE * spot.scale;
  const parts = [ornament(frame, "viking-helmet", helmet, [0, 0, back], [0, 0, OUT], "steel")];
  const crestScale = (crest === "antler" ? .22 : .2) * spot.scale;
  for (const side of [-1, 1] as const) {
    // The crest roots sit in the helmet's sides just above the brow band; the left one is turned over.
    const root: Point3 = [side * .46 * helmet, .18 * helmet, OUT - back * helmet];
    const turn = rotationFromEuler([0, side < 0 ? Math.PI : 0, side * -.15]);
    parts.push(ornament(frame, crest, crestScale, [0, 0, 0], root, "paint", turn));
  }
  return assembled(parts, [peg(spot, spot.along, spot.y, OUT + .05 * spot.scale)]);
};

const LONGSHIP_SCALE = .55;

/** Painted half-model of a longship (dragon stem, shields, striped sail) on two pegs. */
const longshipRelief = (spot: VikingSpot): VikingAssembly => {
  const frame = spotFrame(spot);
  const relief = ornament(frame, "longship-relief", LONGSHIP_SCALE * spot.scale, [0, .4, 0], [0, 0, OUT], "paint");
  const hull = spot.y - .16 * spot.scale;
  return assembled([relief], [-.12, .12].map(along => peg(spot, spot.along + along * spot.scale, hull, OUT)));
};

export const vikingAssembly = (kind: VikingDecorKind, spot: VikingSpot) => {
  if (kind === "axe-trophy" || kind === "double-axe-trophy") return axeTrophy(spot, kind === "double-axe-trophy");
  if (kind === "longship-relief") return longshipRelief(spot);
  return helmetTrophy(spot, kind === "antler-helmet" ? "antler" : "feather-wing");
};
