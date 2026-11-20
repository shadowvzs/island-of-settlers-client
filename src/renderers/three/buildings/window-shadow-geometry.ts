import { PlaneGeometry, Shape, ShapeGeometry } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";

/** A single alpha surface avoids the accidental 75% opacity of two faces of a transparent box. */
export const createWindowShadowGeometry = (part: BuildingPart) => {
  let geometry: PlaneGeometry | ShapeGeometry;
  if (part.windowShadowContour) {
    const outline = new Shape();
    part.windowShadowContour.forEach(([x, y], index) => index ? outline.lineTo(x, y) : outline.moveTo(x, y));
    outline.closePath(); geometry = new ShapeGeometry(outline);
  } else geometry = new PlaneGeometry(1, 1);
  const across = part.size.indexOf(Math.min(...part.size));
  if (across === 0) geometry.rotateY(Math.PI / 2);
  if (across === 1) geometry.rotateX(-Math.PI / 2);
  return geometry;
};
