import { describe, expect, it } from "vitest";

import { computeVertexNormals, smoothNormals } from "../src/render-common/rocks/helpers";
import { createLabCliffTerrain } from "../src/render-common/rocks/lab-cliff";
import { MACRO_FORM_SKIN } from "../src/render-common/rocks/rock-mesh";
import {
  buildRockSkin,
  getRenderedSkinWeight,
  getSkinWeight
} from "../src/render-common/rocks/rock-skin";
import { getOverhang, getWallExposure } from "../src/render-common/rocks/rock-zones";
import {
  createSkinFields,
  getWallForms,
  getWallLevel
} from "../src/render-common/rocks/skin-relief";
import {
  findLevelCrossing,
  type LevelPoint,
  listLevelCrossings,
  type SkinGrid,
  tessellateSkinGrid,
  type TessellationInput
} from "../src/render-common/rocks/skin-tessellation";

const GRID: SkinGrid = { columns: 8, rows: 8, step: 0.5, x: 0, z: 0 };
/** Height of one level in the test fields (like the wall rows). */
const ROW = 0.4;

/** A steep, curved face: levels rise fast along x and wave along z. */
const steepLevel = (x: number, z: number) => x * 9 + Math.sin(z * 2.3) * 2 + Math.sin(x * 4) * 0.8;

const splitAtCrossings =
  (level: (x: number, z: number) => number) => (from: LevelPoint, to: LevelPoint) =>
    listLevelCrossings(from.level, to.level, 12).map((target) => ({
      level: target,
      t: findLevelCrossing([from.level, to.level], target, (t) =>
        level(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t)
      )
    }));

const createInput = (
  level: (x: number, z: number) => number,
  overrides: Partial<TessellationInput> = {}
): TessellationInput => ({
  grid: GRID,
  includes: () => true,
  isDetailed: () => true,
  level,
  split: splitAtCrossings(level),
  ...overrides
});

const flatInput = (isDetailed: () => boolean) =>
  createInput(() => 0, { isDetailed, split: () => [] });

const signedArea = (points: number[], a: number, b: number, c: number) =>
  (points[b * 2]! - points[a * 2]!) * (points[c * 2 + 1]! - points[a * 2 + 1]!) -
  (points[c * 2]! - points[a * 2]!) * (points[b * 2 + 1]! - points[a * 2 + 1]!);

/** How often each undirected edge is used by a triangle. */
const countEdges = (indices: number[]) => {
  const counts = new Map<string, number>();
  for (let index = 0; index < indices.length; index += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = indices[index + corner]!;
      const b = indices[index + ((corner + 1) % 3)]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
};

const isOnGridOutline = (points: number[], vertex: number) => {
  const x = points[vertex * 2]!;
  const z = points[vertex * 2 + 1]!;
  const size = GRID.columns * GRID.step;
  return x === GRID.x || z === GRID.z || x === GRID.x + size || z === GRID.z + size;
};

/** Closed surface checks: no holes, no overlaps, no T-junctions, one winding. */
const expectWatertight = ({ indices, points }: { indices: number[]; points: number[] }) => {
  let area = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const value = signedArea(points, indices[index]!, indices[index + 1]!, indices[index + 2]!);
    expect(value).toBeLessThan(0);
    area -= value / 2;
  }
  expect(area).toBeCloseTo((GRID.columns * GRID.step) ** 2, 9);
  for (const [key, count] of countEdges(indices)) {
    const [a, b] = key.split(",").map(Number) as [number, number];
    if (count === 1) {
      expect(isOnGridOutline(points, a) && isOnGridOutline(points, b)).toBe(true);
    } else expect(count).toBe(2);
  }
};

describe("skin level crossings", () => {
  it("lists the integer levels strictly between two levels, in walking order", () => {
    expect(listLevelCrossings(0.5, 3.2, 12)).toEqual([1, 2, 3]);
    expect(listLevelCrossings(3.2, 0.5, 12)).toEqual([3, 2, 1]);
    expect(listLevelCrossings(1, 2, 12)).toEqual([]);
    expect(listLevelCrossings(-1.5, 0.5, 12)).toEqual([-1, 0]);
  });

  it("thins the levels evenly beyond the split limit", () => {
    const levels = listLevelCrossings(0, 30.5, 10);
    expect(levels.length).toBeLessThanOrEqual(10);
    expect(levels[1]! - levels[0]!).toBe(3);
  });

  it("finds where the level is reached, also on a curved field", () => {
    expect(findLevelCrossing([0, 4], 1, (t) => t * 4)).toBeCloseTo(0.25, 9);
    const curved = (t: number) => 4 * t * t;
    expect(curved(findLevelCrossing([0, 4], 1, curved))).toBeCloseTo(1, 1);
  });
});

describe("skin tessellation", () => {
  it("keeps gentle quads as two triangles and merges gentle blocks", () => {
    expect(tessellateSkinGrid(flatInput(() => true)).indices.length / 3).toBe(128);
    expect(tessellateSkinGrid(flatInput(() => false)).indices.length / 3).toBe(32);
  });

  it("splits steep faces into rows: short edges instead of tall stretched triangles", () => {
    const { indices, points } = tessellateSkinGrid(createInput(steepLevel));
    let longest = 0;
    for (let index = 0; index < indices.length; index += 3) {
      for (let corner = 0; corner < 3; corner += 1) {
        const a = indices[index + corner]!;
        const b = indices[index + ((corner + 1) % 3)]!;
        const [ax, az, bx, bz] = [
          points[a * 2]!,
          points[a * 2 + 1]!,
          points[b * 2]!,
          points[b * 2 + 1]!
        ];
        const rise = (steepLevel(bx, bz) - steepLevel(ax, az)) * ROW;
        longest = Math.max(longest, Math.hypot(bx - ax, rise, bz - az));
      }
    }
    const unsplit = GRID.step * 9 * ROW;
    expect(longest).toBeLessThan(GRID.step * Math.SQRT2 + ROW * 1.5);
    expect(longest).toBeLessThan(unsplit * 0.6);
  });

  it("is watertight on steep faces, mixed block detail and coarse gentle blocks", () => {
    const checker = (column: number, row: number) => (column + row) % 2 === 0;
    expectWatertight(tessellateSkinGrid(createInput(steepLevel)));
    expectWatertight(tessellateSkinGrid(createInput(steepLevel, { isDetailed: checker })));
    expectWatertight(tessellateSkinGrid(createInput(steepLevel, { isDetailed: () => false })));
    const saddle = (x: number, z: number) => (x - 2) * (z - 2) * 6;
    expectWatertight(tessellateSkinGrid(createInput(saddle, { isDetailed: checker })));
  });

  it("puts the same points on the border shared by two neighbouring areas", () => {
    const size = GRID.columns * GRID.step;
    const isDetailed = (column: number, row: number) => (column * 3 + row) % 4 !== 0;
    const borderPoints = (grid: SkinGrid) => {
      const { points } = tessellateSkinGrid(
        createInput(steepLevel, {
          grid,
          isDetailed: (column, row) => isDetailed(column + grid.x / (GRID.step * 2), row)
        })
      );
      const found: string[] = [];
      for (let index = 0; index < points.length; index += 2) {
        if (points[index] === size) found.push(`${points[index]},${points[index + 1]}`);
      }
      return found.sort();
    };
    const left = borderPoints(GRID);
    expect(left.length).toBeGreaterThan(GRID.rows + 1);
    expect(borderPoints({ ...GRID, x: size })).toEqual(left);
  });
});

describe("rock skin walls", () => {
  const terrain = createLabCliffTerrain({
    erosion: 0.1,
    geology: "mountain",
    height: 10,
    seed: 38192
  });
  const skin = buildRockSkin(terrain, { size: 16, x: 16, z: 12 }, 38192, () => 0)!;

  it("marks mountain skin for the gravel finish without covering non-mountain terrain", () => {
    for (let vertex = 0; vertex < skin.vertexCount; vertex += 1) {
      expect(skin.extra[vertex * 4]).toBe(MACRO_FORM_SKIN);
    }
    const cliff = buildRockSkin({ ...terrain, mountain: () => 0 },
      { size: 16, x: 16, z: 12 }, 38192, () => 0);
    expect(cliff).toBeNull();
  });

  it("covers narrow high mountain shelves without filling broad flat or building ground", () => {
    const shelves = { ...terrain, height: (x: number) => 6 + Math.floor(x), mountain: () => 1 };
    expect(getRenderedSkinWeight(shelves, 8.5, 20)).toBeGreaterThan(0.7);
    expect(getSkinWeight(shelves, 8.5, 20)).toBe(0);
    expect(getRenderedSkinWeight({ ...shelves, height: () => 10 }, 8.5, 20)).toBe(0);
    expect(getRenderedSkinWeight({ ...shelves, isBuildLand: () => true }, 8.5, 20)).toBe(0);
    expect(getRenderedSkinWeight({ ...shelves, river: () => 0 }, 8.5, 20)).toBe(0);
  });

  it("keeps rock cover across narrow shelves even when opposing slopes cancel", () => {
    const ridge = {
      ...terrain,
      height: (x: number) => 8 - Math.max(0, Math.abs(x) - 0.25) * 2,
      mountain: () => 1
    };
    // Both local and broad central differences vanish here. The surrounding face is
    // still steep: opening the skin fringe here used to produce a rectangular cavity.
    expect(getSkinWeight(ridge, 0, 20)).toBe(0);
    expect(getRenderedSkinWeight(ridge, 0, 20)).toBe(1);
  });

  it("keeps wall relief continuous across paired bedding layers", () => {
    const fields = createSkinFields(38192);
    for (const [x, z] of [
      [20, 20],
      [32, 16],
      [48, 40]
    ] as const) {
      for (const level of [6, 12, 18, 24]) {
        let low = -10;
        let high = 20;
        for (let step = 0; step < 40; step += 1) {
          const middle = (low + high) / 2;
          if (getWallLevel(x, middle, z) < level) low = middle;
          else high = middle;
        }
        const height = (low + high) / 2;
        const below = getWallForms(fields, x, height - 0.0001, z);
        const above = getWallForms(fields, x, height + 0.0001, z);
        expect(Math.abs(above.offset - below.offset)).toBeLessThan(0.001);
      }
    }
  });

  it.each(["full", "coarse"] as const)("keeps matching neighbour seams and normals on %s", (detail) => {
    const left = buildRockSkin(terrain, { size: 8, x: 16, z: 12 }, 38192, () => 0, detail)!;
    const right = buildRockSkin(terrain, { size: 8, x: 24, z: 12 }, 38192, () => 0, detail)!;
    const normals = new Map<string, number[]>();
    for (let vertex = 0; vertex < left.vertexCount; vertex += 1) {
      const offset = vertex * 3;
      normals.set(left.positions.slice(offset, offset + 3).join(","), Array.from(left.normals.slice(offset, offset + 3)));
    }
    let shared = 0;
    for (let vertex = 0; vertex < right.vertexCount; vertex += 1) {
      const offset = vertex * 3;
      const normal = normals.get(right.positions.slice(offset, offset + 3).join(","));
      if (!normal) continue;
      shared += 1;
      expect(Array.from(right.normals.slice(offset, offset + 3))).toEqual(normal);
    }
    expect(shared).toBeGreaterThan(8);
  });

  it("coarsens the whole Minimal skin without changing its terrain authority", () => {
    const area = { size: 8, x: 16, z: 12 };
    const full = buildRockSkin(terrain, area, 38192, () => 0, "full")!;
    const coarse = buildRockSkin(terrain, area, 38192, () => 0, "coarse")!;
    expect(coarse.triangles).toBeLessThan(full.triangles * 0.8);
    expect([...coarse.positions].every(Number.isFinite)).toBe(true);
  });

  it("samples steep faces evenly: no tall stretched triangles", () => {
    const spans: number[] = [];
    for (let index = 0; index < skin.indices.length; index += 3) {
      const heights = [0, 1, 2].map(
        (corner) => skin.positions[skin.indices[index + corner]! * 3 + 1]!
      );
      spans.push(Math.max(...heights) - Math.min(...heights));
    }
    spans.sort((a, b) => a - b);
    expect(skin.triangles).toBeGreaterThan(1000);
    expect(spans[Math.floor(spans.length * 0.99)]).toBeLessThan(0.9);
    expect(spans.filter((span) => span > 1).length).toBeLessThan(spans.length * 0.002);
  });

  it("has unit normals, finite positions and no edge shared by more than two triangles", () => {
    for (let index = 0; index < skin.vertexCount; index += 1) {
      const normal = [0, 1, 2].map((axis) => skin.normals[index * 3 + axis]!);
      expect(Math.hypot(...normal)).toBeCloseTo(1, 4);
      expect(skin.positions.slice(index * 3, index * 3 + 3).every(Number.isFinite)).toBe(true);
    }
    const counts = [...countEdges([...skin.indices]).values()];
    expect(Math.max(...counts)).toBeLessThanOrEqual(2);
  });

  it("shades undersides and keeps joints weathered on walls", () => {
    expect(getOverhang(-0.8)).toBe(1);
    expect(getOverhang(0.3)).toBe(0);
    expect(getWallExposure(1, 1, 0)).toBeGreaterThan(getWallExposure(1, 1, 1));
    expect(getWallExposure(0, 1, 0)).toBe(0);
  });
});

describe("rock normal smoothing", () => {
  it("keeps unit normals and softens a sharp crease between two faces", () => {
    const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1]);
    const indices = [0, 2, 1, 1, 2, 3];
    const flat = computeVertexNormals(positions, indices);
    const smooth = smoothNormals(flat, indices);
    const dot = (a: Float32Array, i: number, j: number) =>
      a[i * 3]! * a[j * 3]! + a[i * 3 + 1]! * a[j * 3 + 1]! + a[i * 3 + 2]! * a[j * 3 + 2]!;
    expect(dot(smooth, 0, 0)).toBeCloseTo(1, 4);
    expect(dot(smooth, 0, 3)).toBeGreaterThan(dot(flat, 0, 3));
  });
});
