import { DMath } from "../../shared/math/deterministic-math";
import type { Point3 } from "./building-recipe";
import type { AddPart } from "./roman-resource-workshops";
import { type HidePoint,stretchedHideLacingPoints } from "./stretched-hide-outline";

/**
 * The Skinner's and Tanner's stretching frame (shared by every nation, which keeps these props):
 * two posts and two rails, with one whole hide laced in by cords from its edge to the timbers.
 */
export interface HideFrame { x: number; z: number }

const FRAME = { bottomRail: .42, centreY: .8, postHeight: 1.24, postOffset: .33, topRail: 1.39 } as const;
const HIDE = { centreY: .91, depth: .05, height: .8, width: .5 } as const;
const HIDE_TINT: Point3 = [.42, .23, .1];

/** Where a cord from the hide centre through `hole` meets the frame's posts or rails. */
const frameAnchor = (frame: HideFrame, hole: readonly [number, number]): readonly [number, number] => {
  const dx = hole[0] - frame.x, dy = hole[1] - HIDE.centreY;
  const toPost = Math.abs(dx) > 1e-6 ? FRAME.postOffset / Math.abs(dx) : Infinity;
  const rail = dy > 0 ? FRAME.topRail : FRAME.bottomRail;
  const toRail = Math.abs(dy) > 1e-6 ? Math.abs(rail - HIDE.centreY) / Math.abs(dy) : Infinity;
  const reach = Math.min(toPost, toRail);
  return [frame.x + dx * reach, HIDE.centreY + dy * reach];
};

/** A taut cord between two points in the frame's plane. */
const addCord = (part: AddPart, from: readonly [number, number], to: readonly [number, number],
  z: number, thickness: number) => {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  part("rope", [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, z], [thickness, DMath.hypot(dx, dy), thickness],
    3, "cord", [0, 0, DMath.atan2(-dx, dy)]);
};

const holePosition = (frame: HideFrame, [x, y]: HidePoint): readonly [number, number] =>
  [frame.x + x * HIDE.width, HIDE.centreY + y * HIDE.height];

export const addHideFrameTimbers = (part: AddPart, frame: HideFrame) => {
  for (const side of [-1, 1])
    part("wood", [frame.x + side * FRAME.postOffset, FRAME.centreY, frame.z], [.045, FRAME.postHeight, .045], 2);
  for (const y of [FRAME.bottomRail, FRAME.topRail])
    part("wood", [frame.x, y, frame.z], [FRAME.postOffset * 2 + .04, .04, .04], 3);
};

/**
 * One continuous hide with its lacing; `hidePart` may scope both to an inventory slot so an
 * empty frame shows neither skin nor loose cords.
 */
export const addLacedHide = (hidePart: AddPart, frame: HideFrame, detailed: boolean) => {
  hidePart("hide", [frame.x, HIDE.centreY, frame.z], [HIDE.width, HIDE.height, HIDE.depth], 3, "stretched-hide");
  for (const hole of stretchedHideLacingPoints(detailed)) {
    const start = holePosition(frame, hole);
    addCord(hidePart, start, frameAnchor(frame, start), frame.z, detailed ? .007 : .01);
  }
};

/** Rollback: the original hide of five overlapping lobes and two horizontal ties per side. */
export const addLobedHide = (part: AddPart, hidePart: AddPart, frame: HideFrame) => {
  hidePart("paint", [frame.x, .91, frame.z], [.43, .68, .045], 3, "sphere", undefined, HIDE_TINT);
  for (const side of [-1, 1])
    for (const y of [.64, 1.19]) {
      hidePart("paint", [frame.x + side * .18, y, frame.z], [.22, .2, .04], 3, "sphere", undefined, HIDE_TINT);
      part("rope", [frame.x + side * .27, y, frame.z], [.12, .012, .012], 3);
    }
};
