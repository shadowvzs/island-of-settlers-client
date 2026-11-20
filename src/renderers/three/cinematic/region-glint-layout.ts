/**
 * Region glint layout (CIN6, pure CPU): where the sparkles and the edge glow of one highlighted area sit. The
 * sparkles lie on the surface (terrain, or the water surface over water cells) inside the area's rasterized cells;
 * the edge dots outline the area along its boundary cells, ordered around it so the shader's slow chase runs along
 * the outline. Owner review 2026-11-11: small, on the ground, gentle, reads as "this area".
 */

type GroundHeight = (x: number, z: number) => number;

/** Instance kinds of the one glint draw. */
export const GLINT_SPARKLE = 0;
export const GLINT_EDGE = 1;

/** Floats per instance: offset xyz, then phase, size and kind. */
export const GLINT_OFFSET_STRIDE = 3;
export const GLINT_PARAM_STRIDE = 3;

/** Surface lift (world units): a few centimetres, against z-fighting with the drawn ground. */
const SURFACE_LIFT = 0.05;
/** Sparkle half size range (world units): about a third of the CIN2 sparkle, varied per sparkle. */
const SPARKLE_SIZE = 0.15;
const SPARKLE_SIZE_SPREAD = 0.5;
/** Edge dot radius (world units) relative to the spacing of the dots along the outline, and its floor. */
const EDGE_SIZE_PER_SPACING = 0.8;
const EDGE_MIN_SIZE = 0.7;
const GOLDEN = 0.618034;
const TURN = Math.PI * 2;

export interface GlintBuffers {
  offsets: Float32Array;
  params: Float32Array;
}

export interface GlintArea {
  cells: Readonly<Int32Array>;
  cellsX: number;
  groundHeight: GroundHeight;
  /** Upper bound of sparkles and of edge dots (QualityPreset.cinematicView.glintSprites). */
  spritesPerArea: number;
}

/** Sparkles and edge dots one area gets: a sparkle per half cell at most, an edge dot per boundary cell at most. */
export const glintInstanceCounts = (cellCount: number, edgeCellCount: number, spritesPerArea: number) => ({
  edges: Math.min(spritesPerArea, edgeCellCount),
  sparkles: Math.min(spritesPerArea, cellCount * 2)
});

/** Deterministic 0..1 hash of a number (the layout must not flicker between rebuilds). */
const hash = (value: number) => {
  const sine = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return sine - Math.floor(sine);
};

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Boundary cells (a 4-neighbour outside the area), ordered by angle around the area's centre. */
export const regionEdgeCells = (cells: Readonly<Int32Array>, cellsX: number) => {
  const inside = new Set(cells);
  let sumX = 0, sumZ = 0;
  for (const cell of cells) {
    sumX += cell % cellsX;
    sumZ += Math.floor(cell / cellsX);
  }
  const centreX = sumX / Math.max(1, cells.length), centreZ = sumZ / Math.max(1, cells.length);
  const edges: { angle: number; cell: number }[] = [];
  for (const cell of cells) {
    const x = cell % cellsX, z = Math.floor(cell / cellsX);
    const open = NEIGHBOURS.some(([dx, dz]) => x + dx < 0 || x + dx >= cellsX || !inside.has(cell + dx + dz * cellsX));
    if (open) edges.push({ angle: Math.atan2(z - centreZ, x - centreX), cell });
  }
  return edges.sort((first, second) => first.angle - second.angle);
};

const writeInstance = (buffers: GlintBuffers, slot: number, point: readonly [number, number, number],
  phase: number, size: number, kind: number) => {
  buffers.offsets.set(point, slot * GLINT_OFFSET_STRIDE);
  buffers.params.set([phase, size, kind], slot * GLINT_PARAM_STRIDE);
};

const writeSparkles = (buffers: GlintBuffers, start: number, area: GlintArea, seedBase: number, count: number) => {
  const { cells, cellsX, groundHeight } = area;
  for (let index = 0; index < count; index++) {
    const seed = seedBase + index;
    const cell = cells[Math.floor(((index * GOLDEN + hash(seed)) % 1) * cells.length)]!;
    const x = (cell % cellsX) + hash(seed + 0.31);
    const z = Math.floor(cell / cellsX) + hash(seed + 0.67);
    const size = SPARKLE_SIZE * (1 - SPARKLE_SIZE_SPREAD / 2 + hash(seed + 0.13) * SPARKLE_SIZE_SPREAD);
    writeInstance(buffers, start + index, [x, groundHeight(x, z) + SURFACE_LIFT, z], hash(seed + 0.91), size,
      GLINT_SPARKLE);
  }
};

/** Edge dots spread evenly along the ordered outline; their phase is the position around it (0..1). */
const writeEdges = (buffers: GlintBuffers, start: number, area: GlintArea, edges: readonly { angle: number;
  cell: number }[], count: number) => {
  const { cellsX, groundHeight } = area;
  const spacing = edges.length / Math.max(1, count);
  const size = Math.max(EDGE_MIN_SIZE, spacing * EDGE_SIZE_PER_SPACING);
  for (let index = 0; index < count; index++) {
    const edge = edges[Math.floor(index * spacing)]!;
    const x = (edge.cell % cellsX) + 0.5, z = Math.floor(edge.cell / cellsX) + 0.5;
    const phase = (edge.angle + Math.PI) / TURN;
    writeInstance(buffers, start + index, [x, groundHeight(x, z) + SURFACE_LIFT, z], phase, size, GLINT_EDGE);
  }
};

/** Writes one area's instances from `start`; returns how many were written. `areaIndex` varies the layout seed. */
export const writeGlintArea = (buffers: GlintBuffers, start: number, area: GlintArea, areaIndex: number) => {
  const edges = regionEdgeCells(area.cells, area.cellsX);
  const counts = glintInstanceCounts(area.cells.length, edges.length, area.spritesPerArea);
  writeSparkles(buffers, start, area, areaIndex * 7919, counts.sparkles);
  writeEdges(buffers, start + counts.sparkles, area, edges, counts.edges);
  return counts.sparkles + counts.edges;
};
