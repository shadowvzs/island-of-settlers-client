import { createMeshBuilder, type MeshBuilder } from "./skin-mesh-builder";

/**
 * Adaptive tessellation of the rock skin. Steep grid edges are split where they cross the integer
 * levels of a level field (rows of constant height up a face), so a steep quad becomes strips
 * along its contour lines: evenly sampled in 3D, every row at the same height across the face
 * (strata steps stay straight instead of zigzagging between quads). Gentle 2 x 2 blocks merge into
 * one coarse quad. Neighbours share each edge with the same split points: no T-junctions,
 * watertight across quads, blocks, chunks and the steep / gentle seam.
 */
export interface SkinGrid {
  /** Quads along x (even: the grid is made of 2 x 2 blocks). */
  columns: number;
  /** Quads along z (even). */
  rows: number;
  step: number;
  x: number;
  z: number;
}

/** A point of the tessellation and its level (integer on split points). */
export interface LevelPoint {
  level: number;
  x: number;
  z: number;
}

/** A split point along an edge: its parameter 0..1 from the edge start and its level. */
export interface EdgeSplit {
  level: number;
  t: number;
}

export interface TessellationInput {
  grid: SkinGrid;
  /** Whether the quad at (column, row) belongs to the surface. */
  includes: (column: number, row: number) => boolean;
  /**
   * Whether the 2 x 2 block at (blockColumn, blockRow) keeps the full resolution; asked for the
   * blocks around the grid too (their shared sides must match).
   */
  isDetailed: (blockColumn: number, blockRow: number) => boolean;
  /** Level field of the ground (rows follow its integer levels). */
  level: (x: number, z: number) => number;
  /** Split points of the edge from `from` to `to`, sorted by t; none keeps it whole. */
  split: (from: LevelPoint, to: LevelPoint) => EdgeSplit[];
}

export interface SkinTessellation {
  indices: number[];
  /** Sample points of the vertices as x, z pairs. */
  points: number[];
}

/**
 * Integer levels strictly between two levels, at most `max` of them (evenly thinned beyond),
 * in the order from `from` to `to`.
 */
export const listLevelCrossings = (from: number, to: number, max: number) => {
  const first = Math.floor(Math.min(from, to)) + 1;
  const last = Math.ceil(Math.max(from, to)) - 1;
  const count = last - first + 1;
  if (count <= 0 || max <= 0) return [];
  const stride = Math.ceil(count / max);
  const levels: number[] = [];
  for (let level = first; level <= last; level += stride) levels.push(level);
  return from <= to ? levels : levels.reverse();
};

/** Refinements of a level crossing on the real field. */
const CROSSING_STEPS = 4;

/**
 * Parameter 0..1 where the level along an edge reaches `target`: false position from the linear
 * guess, refined on the real field (Illinois variant, it does not stall on curved fields).
 * Deterministic, so shared edges get the same point from either side.
 */
export const findLevelCrossing = (
  [fromLevel, toLevel]: [number, number],
  target: number,
  levelAt: (t: number) => number
) => {
  const bracket = { high: 1, highValue: toLevel - target, low: 0, lowValue: fromLevel - target };
  let kept = 0;
  let t = bracket.lowValue / (bracket.lowValue - bracket.highValue);
  for (let step = 0; step < CROSSING_STEPS; step += 1) {
    const value = levelAt(t) - target;
    if (value === 0) return t;
    if (Math.sign(value) === Math.sign(bracket.lowValue)) {
      Object.assign(bracket, { low: t, lowValue: value });
      if (kept === 1) bracket.highValue /= 2;
      kept = 1;
    } else {
      Object.assign(bracket, { high: t, highValue: value });
      if (kept === -1) bracket.lowValue /= 2;
      kept = -1;
    }
    const { high, highValue, low, lowValue } = bracket;
    t = low + ((high - low) * lowValue) / (lowValue - highValue);
  }
  return t;
};

/** Point lists of the edges (corners included), split once and shared by both sides. */
const createEdgeCache = (input: TessellationInput, builder: MeshBuilder) => {
  const { grid } = input;
  const edges = new Map<number, number[]>();
  const splitEdge = (from: number, to: number, alongX: boolean, span: number) => {
    const start = builder.getPoint(from);
    const list = [from];
    for (const { level, t } of input.split(start, builder.getPoint(to))) {
      const offset = grid.step * span * t;
      list.push(
        alongX
          ? builder.addPoint(start.x + offset, start.z, level)
          : builder.addPoint(start.x, start.z + offset, level)
      );
    }
    list.push(to);
    return list;
  };
  /** Edge from corner (column, row) over `span` quads along x or z. */
  return (column: number, row: number, alongX: boolean, span: 1 | 2) => {
    const key = ((row * (grid.columns + 1) + column) * 2 + (alongX ? 0 : 1)) * 2 + span - 1;
    const known = edges.get(key);
    if (known) return known;
    const from = builder.getCorner(column, row);
    const to = alongX
      ? builder.getCorner(column + span, row)
      : builder.getCorner(column, row + span);
    const list = splitEdge(from, to, alongX, span);
    edges.set(key, list);
    return list;
  };
};

type EdgeCache = ReturnType<typeof createEdgeCache>;

/** Outline of a quad or block: four sides, each from its low to its high corner. */
interface Outline {
  bottom: number[];
  left: number[];
  right: number[];
  top: number[];
}

const isNonDecreasing = (chain: number[], levels: number[]) =>
  chain.every((point, index) => index === 0 || levels[point]! >= levels[chain[index - 1]!]!);

/**
 * The outline as two chains from its lowest to its highest point, or null when the levels do
 * not rise monotonically along both (a saddle or a crest inside).
 */
const findLevelChains = ({ bottom, left, right, top }: Outline, levels: number[]) => {
  const loop = [
    ...bottom.slice(0, -1),
    ...right.slice(0, -1),
    ...[...top].reverse().slice(0, -1),
    ...[...left].reverse().slice(0, -1)
  ];
  let lowest = 0;
  let highest = 0;
  loop.forEach((point, index) => {
    if (levels[point]! < levels[loop[lowest]!]!) lowest = index;
    if (levels[point]! > levels[loop[highest]!]!) highest = index;
  });
  const walk = (direction: 1 | -1) => {
    const chain = [loop[lowest]!];
    for (let index = lowest; index !== highest;) {
      index = (index + direction + loop.length) % loop.length;
      chain.push(loop[index]!);
    }
    return chain;
  };
  const chains = [walk(1), walk(-1)];
  return chains.every((chain) => isNonDecreasing(chain, levels)) ? chains : null;
};

/** Inner lattice of a split outline: (columns - 1) x (rows - 1) points, row major. */
const addInnerLattice = (
  builder: MeshBuilder,
  origin: [number, number],
  size: number,
  [columns, rows]: [number, number]
) => {
  const lattice: number[][] = [];
  for (let row = 1; row < rows; row += 1) {
    const line: number[] = [];
    for (let column = 1; column < columns; column += 1) {
      const x = origin[0] + (size * column) / columns;
      const z = origin[1] + (size * row) / rows;
      line.push(builder.addPoint(x, z, Number.NaN));
    }
    lattice.push(line);
  }
  for (let row = 0; row < lattice.length - 1; row += 1) {
    for (let column = 0; column < lattice[row]!.length - 1; column += 1) {
      const a = lattice[row]![column]!;
      const b = lattice[row]![column + 1]!;
      const c = lattice[row + 1]![column]!;
      const d = lattice[row + 1]![column + 1]!;
      builder.addTriangle(a, c, b);
      builder.addTriangle(b, c, d);
    }
  }
  return lattice;
};

/**
 * Fallback for outlines that are not monotone in level (like a GPU quad tessellator): an inner
 * lattice from the larger split of each direction, stitched to each side by a zip.
 */
const addLatticeOutline = (builder: MeshBuilder, outline: Outline, size: number) => {
  const { bottom, left, right, top } = outline;
  const columns = Math.max(bottom.length, top.length) - 1;
  const rows = Math.max(left.length, right.length) - 1;
  if (rows === 1) return builder.zip(bottom, top, builder.byX);
  if (columns === 1) return builder.zip(left, right, builder.byZ);
  const corner = builder.getPoint(bottom[0]!);
  const lattice = addInnerLattice(builder, [corner.x, corner.z], size, [columns, rows]);
  builder.zip(bottom, lattice[0]!, builder.byX);
  builder.zip(lattice[lattice.length - 1]!, top, builder.byX);
  builder.zip(
    left,
    lattice.map((line) => line[0]!),
    builder.byZ
  );
  builder.zip(
    right,
    lattice.map((line) => line[line.length - 1]!),
    builder.byZ
  );
};

/** Two triangles when no side is split, strips along the levels, else the lattice fallback. */
const addOutline = (builder: MeshBuilder, outline: Outline, size: number) => {
  const { bottom, left, right, top } = outline;
  builder.setQuad(bottom[0]!, top[top.length - 1]!);
  const isSplit = bottom.length + left.length + right.length + top.length > 8;
  if (!isSplit) return builder.zip(bottom, top, builder.byX);
  const chains = findLevelChains(outline, builder.levels);
  if (chains) return builder.zip(chains[0]!, chains[1]!, builder.byLevel);
  addLatticeOutline(builder, outline, size);
};

const getQuadOutline = (getEdge: EdgeCache, column: number, row: number): Outline => ({
  bottom: getEdge(column, row, true, 1),
  left: getEdge(column, row, false, 1),
  right: getEdge(column + 1, row, false, 1),
  top: getEdge(column, row + 1, true, 1)
});

/**
 * Outline of a coarse block: a side keeps its midpoint (two half edges) when the block across it
 * keeps the full resolution, so both see the same points.
 */
const getBlockOutline = (
  input: TessellationInput,
  getEdge: EdgeCache,
  [blockColumn, blockRow]: [number, number]
): Outline => {
  const column = blockColumn * 2;
  const row = blockRow * 2;
  const getSide = (fromColumn: number, fromRow: number, alongX: boolean, halves: boolean) => {
    if (!halves) return getEdge(fromColumn, fromRow, alongX, 2);
    const first = getEdge(fromColumn, fromRow, alongX, 1);
    const second = alongX
      ? getEdge(fromColumn + 1, fromRow, true, 1)
      : getEdge(fromColumn, fromRow + 1, false, 1);
    return [...first, ...second.slice(1)];
  };
  return {
    bottom: getSide(column, row, true, input.isDetailed(blockColumn, blockRow - 1)),
    left: getSide(column, row, false, input.isDetailed(blockColumn - 1, blockRow)),
    right: getSide(column + 2, row, false, input.isDetailed(blockColumn + 1, blockRow)),
    top: getSide(column, row + 2, true, input.isDetailed(blockColumn, blockRow + 1))
  };
};

const BLOCK_QUADS: [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1]
];

/** Tessellates the included quads of the grid (points still to be lifted onto the surface). */
export const tessellateSkinGrid = (input: TessellationInput): SkinTessellation => {
  const { grid } = input;
  const builder = createMeshBuilder(grid, input.level);
  const getEdge = createEdgeCache(input, builder);
  for (let blockRow = 0; blockRow < grid.rows / 2; blockRow += 1) {
    for (let blockColumn = 0; blockColumn < grid.columns / 2; blockColumn += 1) {
      const quads = BLOCK_QUADS.map(([column, row]): [number, number] => [
        blockColumn * 2 + column,
        blockRow * 2 + row
      ]).filter(([column, row]) => input.includes(column, row));
      if (quads.length === 0) continue;
      if (!input.isDetailed(blockColumn, blockRow)) {
        const outline = getBlockOutline(input, getEdge, [blockColumn, blockRow]);
        addOutline(builder, outline, grid.step * 2);
        continue;
      }
      for (const [column, row] of quads) {
        addOutline(builder, getQuadOutline(getEdge, column, row), grid.step);
      }
    }
  }
  return { indices: builder.indices, points: builder.points };
};
