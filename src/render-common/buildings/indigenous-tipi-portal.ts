import type { Point3 } from "./building-recipe";

export type ClothPanelCorners = readonly [Point3, Point3, Point3, Point3];
export interface TipiPortalPanel {
  position: Point3;
  size: Point3;
  corners: ClothPanelCorners;
}

/** Normalized quadrilateral plus its real shared bounds; no deep rectangular entrance boxes. */
const panel = (corners: ClothPanelCorners): TipiPortalPanel => {
  const min = [0, 1, 2].map(axis => Math.min(...corners.map(point => point[axis]!)) - .008);
  const max = [0, 1, 2].map(axis => Math.max(...corners.map(point => point[axis]!)) + .008);
  const position = min.map((value, axis) => (value + max[axis]!) / 2) as Point3;
  const size = min.map((value, axis) => max[axis]! - value) as Point3;
  return { position, size, corners: corners.map(point => point.map((value, axis) =>
    (value - position[axis]!) / size[axis]!) as Point3) as unknown as ClothPanelCorners };
};

/** Sew the short sloped porch into the cone's actual surface, keeping the authored door corridor. */
export const createTipiPortalPanels = (centre: readonly [number, number], width: number, depth: number,
  rise: number, door: { left: number; right: number; top: number; z: number }): TipiPortalPanel[] => {
  const frontY = door.top + .09, rearY = Math.min(rise * .8, door.top + .24);
  const frontZ = door.z + .014, left = door.left - .105, right = door.right + .105;
  const skinZ = (x: number, y: number) => centre[1] + depth / 2 * Math.sqrt(Math.max(0,
    (1 - y / rise) ** 2 - ((x - centre[0]) * 2 / width) ** 2)) - .012;
  const rearLeft: Point3 = [left, rearY, skinZ(left, rearY)];
  const rearRight: Point3 = [right, rearY, skinZ(right, rearY)];
  return [
    panel([[left, .015, frontZ], [left, .015, skinZ(left, .015)], rearLeft, [left, frontY, frontZ]]),
    panel([[right, .015, skinZ(right, .015)], [right, .015, frontZ], [right, frontY, frontZ], rearRight]),
    panel([[left, frontY, frontZ], [right, frontY, frontZ], rearRight, rearLeft])
  ];
};
