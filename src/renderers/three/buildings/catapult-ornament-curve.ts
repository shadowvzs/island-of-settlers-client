import type { BufferGeometry } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";

/** A bonded roundel follows its actual circular wall instead of floating away at the edges. */
export const applyCatapultOrnamentCurve = (geometry: BufferGeometry, part: BuildingPart) => {
  if (!part.catapultWallOrnament) return;
  const positions = geometry.getAttribute("position"), radius = .82;
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const x = positions.getX(vertex);
    positions.setZ(vertex, positions.getZ(vertex) + Math.sqrt(Math.max(0, radius * radius - x * x)) - radius);
  }
  geometry.computeVertexNormals();
};
