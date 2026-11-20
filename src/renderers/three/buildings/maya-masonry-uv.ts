import type { BufferGeometry } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";
import { MAYA_STONE_BLOCKS, MAYA_STONE_COURSES } from "./maya-stone-detail";

/** Recipe-space projection keeps both sides of every wall corner on the same staggered grid. */
export const applyMayaMasonryUv = (geometry: BufferGeometry, part: BuildingPart) => {
  if (!part.mayaMasonryUv) return;
  const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  const uvs = geometry.getAttribute("uv");
  if (!normals || !uvs) return;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, size = bounds.max.clone().sub(bounds.min);
  const coordinate = (value: number, axis: "x" | "y" | "z") =>
    Math.max(0, Math.min(1, (value - bounds.min[axis]) / Math.max(1e-8, size[axis])));
  const pick = Math.abs(Math.round((part.position[0] * 3 + part.position[1] * 7 + part.position[2] * 5) * 10));
  const column = pick % MAYA_STONE_BLOCKS, row = 2 * (Math.floor(pick / MAYA_STONE_BLOCKS) % 2);
  const scale = part.worldUv ?? 1;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    const horizontal = Math.abs(normals.getY(index)) > .7;
    if (part.mayaMasonryUv === "block") {
      const u = Math.abs(normals.getX(index)) > Math.abs(normals.getZ(index)) && !horizontal
        ? coordinate(z, "z") : coordinate(x, "x");
      const v = horizontal ? coordinate(z, "z") : coordinate(y, "y");
      uvs.setXY(index, (column + .04 + u * .92) / MAYA_STONE_BLOCKS,
        (row + .04 + v * .92) / MAYA_STONE_COURSES);
    } else if (part.mayaMasonryUv === "course") {
      let v = coordinate(y, "y");
      if (horizontal) v = size.x > size.z ? coordinate(z, "z") : coordinate(x, "x");
      uvs.setXY(index, (x + z) * scale, (.08 + v * .84) / MAYA_STONE_COURSES);
    } else if (!horizontal) uvs.setXY(index, (x + z) * scale, y * scale);
  }
  uvs.needsUpdate = true;
};
