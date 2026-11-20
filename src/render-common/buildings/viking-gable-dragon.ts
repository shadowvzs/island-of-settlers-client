import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, Point3 } from "./building-recipe";
import { eulerFromRotation, rotatePoint, rotationFromUpForward } from "./recipe-rotation";
import { ornamentOffset, ornamentSize } from "./viking-ornament-boxes";

/** Head height ≈ 0.25: its neck matches a 0.045 × 0.07 barge board. */
const DRAGON_SCALE = .22;
/** The neck is let into the board end, so the joint never shows a gap. */
const NECK_EMBED = .02;

/**
 * Carved dragon head continuing a crossed barge board past the ridge (stave-church gable heads):
 * the neck follows the board from `foot` to `tip`, the jaws look out over the gable.
 */
export const gableDragon = (foot: Point3, tip: Point3, scale = DRAGON_SCALE): BuildingPart => {
  const run: Point3 = [tip[0] - foot[0], tip[1] - foot[1], tip[2] - foot[2]], length = DMath.hypot(...run);
  const up: Point3 = [run[0] / length, run[1] / length, run[2] / length], level = DMath.hypot(up[0], up[2]);
  // In the board's plane, perpendicular to the neck and pointing outward and down.
  const forward: Point3 = [up[0] / level * up[1], -level, up[2] / level * up[1]];
  const rotation = rotationFromUpForward(up, forward);
  const offset = rotatePoint(rotation, ornamentOffset("dragon-head", [0, 0, 0], scale));
  const base = tip.map((value, axis) => value - up[axis]! * NECK_EMBED) as Point3;
  return { position: [base[0] - offset[0], base[1] - offset[1], base[2] - offset[2]],
    rotation: eulerFromRotation(rotation), shape: "dragon-head", size: ornamentSize("dragon-head", scale), stage: 4,
    surface: "wood" };
};
