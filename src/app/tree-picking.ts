import type { TreeBody } from "../render-common/felling/felling-simulation";
import type { ViewportPoint } from "../render-common/iso-projection";
import { DMath } from "../shared/math/deterministic-math";

export interface ScreenPoint {
  x: number;
  y: number;
}

/** World -> viewport projection of the active camera (the renderer's projectToViewport). */
export type Projector = (x: number, y: number, z: number) => ViewportPoint;

/** Viewport position of a tree's crown centre. */
export const getCrownOnScreen = (project: Projector, tree: TreeBody) =>
  project(tree.x, tree.y + tree.canopyHeight, tree.z);

/** Crown radius on screen: the projected length of the radius standing up from the centre. */
const getCrownRadius = (project: Projector, tree: TreeBody, crown: ViewportPoint) => {
  const top = project(tree.x, tree.y + tree.canopyHeight + tree.canopyRadius, tree.z);
  return DMath.hypot(top.x - crown.x, top.y - crown.y) * 1.15;
};

/** The crown (a circle) or the trunk (a narrow column below it) contains the pointer. */
const isUnderPointer = (project: Projector, tree: TreeBody, pointer: ScreenPoint) => {
  const crown = getCrownOnScreen(project, tree);
  const radius = getCrownRadius(project, tree, crown);
  if (DMath.hypot(pointer.x - crown.x, pointer.y - crown.y) <= radius) return true;
  const foot = project(tree.x, tree.y, tree.z);
  return (
    Math.abs(pointer.x - foot.x) <= radius * 0.25 && pointer.y <= foot.y && pointer.y >= crown.y
  );
};

/**
 * Tree under the pointer with whatever camera is active (iso, rotated or cinematic); with
 * overlapping crowns the one nearest the camera wins. Returns the tree id or null.
 */
export const pickTree = (
  project: Projector,
  pointer: ScreenPoint,
  trees: Iterable<[number, TreeBody]>
) => {
  let picked: number | null = null;
  let nearest = Infinity;
  for (const [id, tree] of trees) {
    const depth = getCrownOnScreen(project, tree).depth;
    if (depth >= nearest || !isUnderPointer(project, tree, pointer)) continue;
    picked = id;
    nearest = depth;
  }
  return picked;
};
