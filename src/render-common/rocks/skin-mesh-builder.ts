import type { LevelPoint, SkinGrid } from "./skin-tessellation";

type Param = (index: number) => number;

/** Triangle area in the xz plane below which a triangle counts as degenerate. */
const DEGENERATE_AREA = 1e-12;

/**
 * Point and triangle store of the skin tessellation: corners shared by index, triangles wound
 * like a height field, and the zip that stitches two point chains into a band of triangles.
 */
export const createMeshBuilder = (grid: SkinGrid, getLevel: (x: number, z: number) => number) => {
  const points: number[] = [];
  const levels: number[] = [];
  const indices: number[] = [];
  const corners = new Int32Array((grid.columns + 1) * (grid.rows + 1)).fill(-1);
  const addPoint = (x: number, z: number, level: number) => {
    points.push(x, z);
    levels.push(level);
    return levels.length - 1;
  };
  const getCorner = (column: number, row: number) => {
    const key = row * (grid.columns + 1) + column;
    if (corners[key]! < 0) {
      const x = grid.x + column * grid.step;
      const z = grid.z + row * grid.step;
      corners[key] = addPoint(x, z, getLevel(x, z));
    }
    return corners[key]!;
  };
  const getPoint = (index: number): LevelPoint => ({
    level: levels[index]!,
    x: points[index * 2]!,
    z: points[index * 2 + 1]!
  });
  /** Same winding as a plain height field grid: counter-clockwise seen from above. */
  const addTriangle = (a: number, b: number, c: number) => {
    const area =
      (points[b * 2]! - points[a * 2]!) * (points[c * 2 + 1]! - points[a * 2 + 1]!) -
      (points[c * 2]! - points[a * 2]!) * (points[b * 2 + 1]! - points[a * 2 + 1]!);
    if (Math.abs(area) < DEGENERATE_AREA) return;
    if (area < 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  };
  /** Outline of the quad being tessellated (exact corner coordinates). */
  const quad = { x0: 0, x1: 0, z0: 0, z1: 0 };
  const setQuad = (lowCorner: number, highCorner: number) => {
    quad.x0 = points[lowCorner * 2]!;
    quad.z0 = points[lowCorner * 2 + 1]!;
    quad.x1 = points[highCorner * 2]!;
    quad.z1 = points[highCorner * 2 + 1]!;
  };
  /** A chord along a quad side would pass over the split points between its ends (T-junction). */
  const isOnSide = (a: number, b: number) => {
    if (a === b) return false;
    const [ax, az] = [points[a * 2]!, points[a * 2 + 1]!];
    const [bx, bz] = [points[b * 2]!, points[b * 2 + 1]!];
    const sameX = ax === bx && (ax === quad.x0 || ax === quad.x1);
    return sameX || (az === bz && (az === quad.z0 || az === quad.z1));
  };
  /**
   * Whether chain `a` may advance (its next point joins `b`'s current one): never along a quad
   * side, and into its last point only together with the other chain.
   */
  const canAdvance = (a: number[], i: number, b: number[], j: number) => {
    const isAdjacent = a[i] === b[j] || a[i + 1] === b[j + 1];
    if (i + 1 === a.length - 1 && j + 1 < b.length - 1) return false;
    return isAdjacent || !isOnSide(a[i + 1]!, b[j]!);
  };
  const chooseFirst = (
    first: number[],
    second: number[],
    [i, j]: [number, number],
    param: Param
  ) => {
    if (j === second.length - 1) return true;
    if (i === first.length - 1) return false;
    const firstAllowed = canAdvance(first, i, second, j);
    const secondAllowed = canAdvance(second, j, first, i);
    if (firstAllowed !== secondAllowed) return firstAllowed;
    return param(first[i + 1]!) <= param(second[j + 1]!);
  };
  /** Triangulates the band between two point chains sorted by `param` (a merge walk). */
  const zip = (first: number[], second: number[], param: Param) => {
    let i = 0;
    let j = 0;
    while (i < first.length - 1 || j < second.length - 1) {
      if (chooseFirst(first, second, [i, j], param)) {
        addTriangle(first[i]!, first[i + 1]!, second[j]!);
        i += 1;
      } else {
        addTriangle(first[i]!, second[j + 1]!, second[j]!);
        j += 1;
      }
    }
  };
  const byX: Param = (index) => points[index * 2]!;
  const byZ: Param = (index) => points[index * 2 + 1]!;
  const byLevel: Param = (index) => levels[index]!;
  return {
    addPoint,
    addTriangle,
    byLevel,
    byX,
    byZ,
    getCorner,
    getPoint,
    indices,
    levels,
    points,
    setQuad,
    zip
  };
};

export type MeshBuilder = ReturnType<typeof createMeshBuilder>;
