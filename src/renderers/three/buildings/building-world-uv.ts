import type { BufferGeometry } from "three";

import type { Point3 } from "../../../render-common/buildings/building-recipe";
import { STONE_BLOCKS_PER_COURSE, STONE_COURSES } from "./roman-surface-detail";

/**
 * Texture coordinates in recipe units for a scaled, not yet rotated part. Boxes are box-projected:
 * top and bottom faces map x/z, side faces their horizontal axis and height. Round parts (`girth`,
 * the circumference of a cylinder or cone) unroll their sides around it. `origin` (the part
 * position) puts unrotated parts on one shared grid, so brick courses line up wall to wall.
 */
export const applyBuildingWorldUv = (
  geometry: BufferGeometry, tilesPerUnit: number, origin: Point3 = [0, 0, 0], girth?: number
) => {
  const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  const uvs = geometry.getAttribute("uv");
  if (!normals || !uvs) return;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index) + origin[0], y = positions.getY(index) + origin[1];
    const z = positions.getZ(index) + origin[2];
    const nx = Math.abs(normals.getX(index)), ny = Math.abs(normals.getY(index)), nz = Math.abs(normals.getZ(index));
    if (girth && ny < .9) uvs.setXY(index, uvs.getX(index) * girth * tilesPerUnit, y * tilesPerUnit);
    else if (ny >= nx && ny >= nz) uvs.setXY(index, x * tilesPerUnit, z * tilesPerUnit);
    else if (nx >= nz) uvs.setXY(index, z * tilesPerUnit, y * tilesPerUnit);
    else uvs.setXY(index, x * tilesPerUnit, y * tilesPerUnit);
  }
  uvs.needsUpdate = true;
};

/**
 * A single dressed stone (corner quoin): every face shows one whole block of the ashlar map, its
 * joints on the face edges, instead of a whole tile of courses shrunk onto it. The block picked
 * varies with the stone's position; even courses keep the joints on the block edges.
 */
export const applyAshlarBlockUv = (geometry: BufferGeometry, position: Point3) => {
  const uvs = geometry.getAttribute("uv");
  if (!uvs) return;
  const pick = Math.abs(Math.round((position[0] * 3 + position[1] * 7 + position[2] * 5) * 10));
  const column = pick % STONE_BLOCKS_PER_COURSE;
  const course = 2 * (Math.floor(pick / STONE_BLOCKS_PER_COURSE) % (STONE_COURSES / 2));
  for (let index = 0; index < uvs.count; index++)
    uvs.setXY(index, (column + uvs.getX(index)) / STONE_BLOCKS_PER_COURSE, (course + uvs.getY(index)) / STONE_COURSES);
  uvs.needsUpdate = true;
};
