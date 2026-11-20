import type { Point3 } from "./building-recipe";
import { rotateByEuler } from "./recipe-rotation";
import type { RomanDesignContext } from "./roman-design-kit";

export const ROMAN_ROOF_TILE_SCALE = 0.65;
export const ROMAN_ROOF_COURSE_LENGTH_SCALE = 0.6;


/** Straight pottery channels overlap down the slope; neighboring courses never change lanes. */
export const addRomanRoofTiles = ({ part, parts }: RomanDesignContext) => {
  const planes = parts.filter(
    (piece) =>
      piece.surface === "roof" && piece.stage === 4 && piece.shape === "box" && piece.size[1] < 0.1
  );
  for (const plane of planes) {
    const rows = Math.ceil(
      plane.size[0] / (0.3 * ROMAN_ROOF_TILE_SCALE * ROMAN_ROOF_COURSE_LENGTH_SCALE)
    );
    const columns = Math.ceil(plane.size[2] / (0.22 * ROMAN_ROOF_TILE_SCALE));
    const stepX = plane.size[0] / rows;
    const stepZ = plane.size[2] / columns;
    const rotation: Point3 = plane.rotation ?? [0, 0, 0];
    const tileRotation: Point3 =
      rotateByEuler([1, 0, 0], rotation)[1] > 0
        ? [-rotation[0], rotation[1] + Math.PI, rotation[2]]
        : rotation;
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const seed = ((row * 17 + column * 31) % 23) / 23;
        const left = Math.max(-plane.size[2] / 2, -plane.size[2] / 2 + column * stepZ);
        const right = Math.min(plane.size[2] / 2, -plane.size[2] / 2 + (column + 1) * stepZ);
        const local: Point3 = [
          -plane.size[0] / 2 + (row + 0.5) * stepX,
          plane.size[1] / 2 - 0.0005,
          (left + right) / 2
        ];
        const offset = rotateByEuler(local, rotation);
        part(
          "roof",
          plane.position.map((value, axis) => value + offset[axis]!) as Point3,
          [
            stepX + 0.035 * ROMAN_ROOF_TILE_SCALE * ROMAN_ROOF_COURSE_LENGTH_SCALE,
            0.085 * ROMAN_ROOF_TILE_SCALE,
            right - left + 0.002 * ROMAN_ROOF_TILE_SCALE
          ],
          4,
          "tile",
          tileRotation,
          [0.95 + seed * 0.035, 0.96 + seed * 0.03, 0.965 + seed * 0.025]
        );
      }
  }
};
