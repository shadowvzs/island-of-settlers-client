import type { BuildingPart } from "./building-recipe";
import type { RomanDesignContext } from "./roman-design-kit";

interface WallCorner {
  side: BuildingPart;
  xDirection: number;
  zDirection: number;
  bottom: number;
  top: number;
}
const masonryCorners = (walls: BuildingPart[]): WallCorner[] => {
  const corners: WallCorner[] = [];
  for (const side of walls.filter((wall) => wall.size[0] === 0.11))
    for (const end of [-1, 1]) {
      const z = side.position[2] + (end * side.size[2]) / 2;
      const face = walls.find(
        (wall) =>
          wall.size[2] === 0.11 &&
          Math.abs(wall.position[2] - z) < 0.12 &&
          Math.abs(wall.position[0] - side.position[0]) <= wall.size[0] / 2 + 0.065 &&
          Math.abs(wall.position[1] - side.position[1]) < (wall.size[1] + side.size[1]) / 2
      );
      if (!face) continue;
      const bottom = Math.max(
        side.position[1] - side.size[1] / 2,
        face.position[1] - face.size[1] / 2
      );
      const top = Math.min(
        side.position[1] + side.size[1] / 2,
        face.position[1] + face.size[1] / 2
      );
      if (top - bottom < 0.35) continue;
      corners.push({
        side,
        bottom,
        top,
        xDirection: Math.sign(side.position[0] - face.position[0]),
        zDirection: end
      });
    }
  return corners.sort(
    (a, b) =>
      b.side.position[2] +
      (b.zDirection * b.side.size[2]) / 2 -
      a.side.position[2] -
      (a.zDirection * a.side.size[2]) / 2
  );
};

/** Unequal corner courses break the silhouette and remain bonded to the real wall. */
export const addRomanMasonryRelief = ({ detailed, part, parts }: RomanDesignContext) => {
  const walls = parts.filter(
    (wall) =>
      wall.surface === "stone" &&
      wall.stage === 1 &&
      wall.shape === "box" &&
      wall.size[1] > 0.45 &&
      (wall.size[0] === 0.11 || wall.size[2] === 0.11)
  );
  const corners = masonryCorners(walls);
  let blocks = 0;
  for (const [index, corner] of corners.entries()) {
    if (blocks >= (detailed ? 32 : 2)) break;
    const { bottom, side, top, xDirection, zDirection } = corner;
    const rows = detailed ? Math.min(6, Math.ceil((top - bottom) / 0.24)) : 1;
    const pitch = (top - bottom) / rows;
    for (let row = 0; row < rows; row++) {
      if (blocks >= (detailed ? 32 : 2)) break;
      const y = bottom + pitch * (row + 0.5);
      const fraction = (y - side.position[1] + side.size[1] / 2) / side.size[1];
      const scaleZ = 1 + ((side.topScale?.[2] ?? 1) - 1) * fraction;
      const x =
        side.position[0] + (xDirection * side.size[0]) / 2 + (side.topOffset?.[0] ?? 0) * fraction;
      const z =
        side.position[2] +
        (zDirection * side.size[2] * scaleZ) / 2 +
        (side.topOffset?.[2] ?? 0) * fraction;
      const variation = ((row * 7 + index * 11) % 5) / 5;
      part(
        "stone",
        [x - xDirection * 0.045, y, z - zDirection * 0.045],
        [0.19 + variation * 0.075, Math.min(pitch - 0.012, 0.22), 0.25 - variation * 0.055],
        2,
        "stone-block"
      );
      blocks++;
    }
  }
};
