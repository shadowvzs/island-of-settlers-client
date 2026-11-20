import type { BufferGeometry } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../../../render-common/buildings/building-recipe-fit";
import { romanConstructionStage } from "./roman-construction";

/** Only exact, opaque, stationary boxes can prove a triangle hidden throughout construction. */
export const buildingSolidBoxes = (parts: readonly BuildingPart[]) => parts.filter(part =>
  part.shape === "box" && !part.fireboxCut && !part.stock && !part.swayPivot && !part.catapultPart && !part.drinkTool &&
  part.windCordSlot === undefined && !part.topOffset && !part.topScale &&
  !part.rotation?.some(angle => Math.abs(angle) > 1e-8)).map(part => ({ part, ...getRomanPartBounds(part) }));
type SolidBox = ReturnType<typeof buildingSolidBoxes>[number];
const AXES = [0, 1, 2] as const;

/** Remove only triangles contained by a completed earlier/same-stage solid box with an interior centroid.
 * Convex containment proves the entire triangle invisible; visible/coplanar faces stay intact.
 * Geometry is already in recipe coordinates. Stock and moving parts never participate.
 */
export const removeHiddenBuildingTriangles = (
  geometry: BufferGeometry, part: BuildingPart, boxes: readonly SolidBox[]
) => {
  if (!boxes.length || part.stock || part.swayPivot || part.catapultPart || part.drinkTool || part.windCordSlot !== undefined) return geometry;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const occluders = boxes.filter(box => box.part !== part && romanConstructionStage(box.part) <= romanConstructionStage(part) &&
    box.max.every((value, axis) => value > bounds.min.getComponent(axis)) &&
    box.min.every((value, axis) => value < bounds.max.getComponent(axis)));
  if (!occluders.length) return geometry;
  const positions = geometry.getAttribute("position"), index = geometry.index;
  const count = index?.count ?? positions.count, kept: number[] = [];
  const inside = (vertex: number, box: SolidBox) => AXES.every(axis => {
    const value = positions.getComponent(vertex, axis);
    return value >= box.min[axis]! && value <= box.max[axis]!;
  });
  const centreInside = (a: number, b: number, c: number, box: SolidBox) => AXES.every(axis => {
    const value = (positions.getComponent(a, axis) + positions.getComponent(b, axis) + positions.getComponent(c, axis)) / 3;
    return value > box.min[axis]! + 1e-6 && value < box.max[axis]! - 1e-6;
  });
  const vertexAt = (offset: number) => index ? index.getX(offset) : offset;
  for (let offset = 0; offset < count; offset += 3) {
    const a = vertexAt(offset), b = vertexAt(offset + 1), c = vertexAt(offset + 2);
    if (!occluders.some(box => inside(a, box) && inside(b, box) && inside(c, box) && centreInside(a, b, c, box))) kept.push(a, b, c);
  }
  if (kept.length < count) geometry.setIndex(kept);
  return geometry;
};
