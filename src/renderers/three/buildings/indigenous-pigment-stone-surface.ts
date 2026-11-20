import { BoxGeometry, BufferGeometry, Float32BufferAttribute } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";
import { createIndigenousWorkshopStoneGeometry } from "./indigenous-workshop-stone-geometry";

/** Normalize existing physical stone triangles into the painting's projection rectangle.
 * Source normals remain world-facing for clipping; final storage converts them to paint-local space. */
export const createIndigenousPigmentStoneSurface = (part: BuildingPart, detailed: boolean) => {
  const positions: number[] = [], normals: number[] = [];
  for (const carrier of part.indigenousPigmentCarriers ?? []) {
    const geometry = carrier.masonry ? createIndigenousWorkshopStoneGeometry(detailed, carrier.variant)
      : new BoxGeometry(1, 1, 1).toNonIndexed();
    geometry.scale(...carrier.size); geometry.translate(...carrier.position);
    const points = geometry.getAttribute("position"), sourceNormals = geometry.getAttribute("normal");
    for (let index = 0; index < points.count; index++) {
      positions.push((points.getX(index) - part.position[0]) / part.size[0],
        (points.getY(index) - part.position[1]) / part.size[1],
        (points.getZ(index) - part.position[2]) / part.size[2]);
      normals.push(sourceNormals.getX(index), sourceNormals.getY(index), sourceNormals.getZ(index));
    }
    geometry.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(positions.filter((_, index) => index % 3 !== 2), 2));
  return geometry;
};
