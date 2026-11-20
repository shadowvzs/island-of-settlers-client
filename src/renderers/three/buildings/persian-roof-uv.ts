import type { BufferGeometry } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";

/** Continuous masonry courses around a curved shell; box projection creates visible axis seams. */
export const applyPersianRoofUv = (geometry: BufferGeometry, part: BuildingPart) => {
  if (part.shape !== "persian-dome" && part.shape !== "persian-barrel") return false;
  const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  const uvs = geometry.getAttribute("uv"), repeat = part.worldUv ?? .875;
  const [width, height, depth] = part.size;
  const girthTiles = Math.max(1, Math.round(Math.PI * (width + depth) / 2 * repeat));
  const half = width / 2, difference = (half - height) ** 2 / (half + height) ** 2;
  const archLength = Math.PI * (half + height) / 2 *
    (1 + 3 * difference / (10 + Math.sqrt(4 - 3 * difference)));
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    if (part.shape === "persian-dome") {
      // Lathe U already preserves a continuous meridian on both the outer and inner shell.
      // An integer circumference tile count makes the sole meridian seam repeat exactly.
      if (y <= -height / 2 + 1e-7 && normals.getY(index) < -.5)
        uvs.setXY(index, x * repeat, z * repeat);
      else uvs.setXY(index, uvs.getX(index) * girthTiles, (y + part.position[1]) * repeat);
      continue;
    }
    if (Math.abs(normals.getZ(index)) > .5) {
      uvs.setXY(index, x * repeat, (y + part.position[1]) * repeat);
      continue;
    }
    const angle = Math.atan2(Math.max(0, y + height / 2) / height, x / half);
    uvs.setXY(index, (z + part.position[2]) * repeat, angle / Math.PI * archLength * repeat);
  }
  uvs.needsUpdate = true;
  return true;
};
