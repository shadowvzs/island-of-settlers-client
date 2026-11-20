import { displayFogAt } from "../../shared/world/fog-display";
import { FOG, type Waterfall, type WorldData } from "../../shared/world/world-data";

/** Sheet grid: columns across the fall, rows down it. */
const SHEET_COLUMNS = 6;
const SHEET_ROWS = 10;
/** Foam disc on the plunge pool: rings and segments. */
const FOAM_RINGS = 3;
const FOAM_SEGMENTS = 16;
/** The sheet starts this far (cells) behind the drop and is thrown forward as it falls. */
const LIP_BACK = 0.3;
const THROW_BASE = 0.3;
const THROW_PER_HEIGHT = 0.12;
/** The sheet starts a little above the upper water and ends below the pool surface. */
export const SHEET_LIFT = 0.04;
export const SHEET_SINK = 0.08;
/** Foam floats just above the pool surface; its radius grows with the fall. */
const FOAM_LIFT = 0.03;
const FOAM_BASE_RADIUS = 0.6;
const FOAM_PER_HEIGHT = 0.25;
const GOLDEN_RATIO = 0.618_034;

/** Part of a waterfall mesh, stored in extra.x. */
const WATERFALL_PART = { foam: 1, sheet: 0 } as const;

/**
 * Waterfall sheets and their foam discs as one mesh (world positions). uv: sheet u across, v
 * down; foam u the radius 0..1. extra: part, fog visibility, fall height, seed.
 */
export interface WaterfallMeshData {
  extra: Float32Array;
  indices: Uint32Array;
  positions: Float32Array;
  triangles: number;
  uvs: Float32Array;
}

interface MeshWriter {
  extra: number[];
  indices: number[];
  positions: number[];
  uvs: number[];
}

const getFogVisibility = (world: WorldData, x: number, z: number) => {
  const cellX = Math.min(world.cellsX - 1, Math.max(0, Math.floor(x)));
  const cellZ = Math.min(world.cellsZ - 1, Math.max(0, Math.floor(z)));
  return displayFogAt(world, cellZ * world.cellsX + cellX) / FOG.visible;
};

/** Horizontal distance (cells) of the sheet from the drop at a share of the fall. */
const getSheetForward = (fall: Waterfall, along: number) => {
  const throwLength = THROW_BASE + (fall.top - fall.bottom) * THROW_PER_HEIGHT;
  return -LIP_BACK + (LIP_BACK + throwLength) * Math.sqrt(along);
};

/** One falling ribbon along the lip: its centre across and along the fall (cells) and its width. */
interface LipRibbon {
  across: number;
  along: number;
  width: number;
}

/** Lip scan: sample spacing (cells), how far upstream/downstream and beyond the pool it looks. */
const LIP_STEP = 0.25;
const LIP_ALONG_REACH = 1.5;
const LIP_ACROSS_EXTRA = 1.5;
/** The water mesh's fall line lies about this far past the last upper pool vertex. */
const LIP_CUT_OFFSET = 0.15;
const LIP_LEVEL_TOLERANCE = 0.02;
const MIN_RIBBON_WIDTH = 0.3;

/** Ground below the upper water by at least this past the edge: a drop, not a shore. */
const LIP_DROP = 0.15;

const nearestVertex = (world: WorldData, x: number, z: number) =>
  Math.round(Math.min(world.cellsZ, Math.max(0, z))) * (world.cellsX + 1) +
  Math.round(Math.min(world.cellsX, Math.max(0, x)));

/** Whether the world vertex nearest a point holds the fall's upper pool (wet, at or above its top). */
const isUpperWater = (world: WorldData, fall: Waterfall, x: number, z: number) => {
  const index = nearestVertex(world, x, z);
  const surface = world.waterSurface[index]!;
  return surface >= fall.top - LIP_LEVEL_TOLERANCE && surface - world.heights[index]! > LIP_LEVEL_TOLERANCE;
};

/** Whether the ground drops away below the upper water at a point (the step face, not a bank). */
const isDropBelow = (world: WorldData, fall: Waterfall, x: number, z: number) =>
  world.heights[nearestVertex(world, x, z)]! < fall.top - LIP_DROP;

/**
 * The farthest downstream point (along the fall) of the upper pool at an offset across; null where it
 * is dry or where the pool ends at a bank instead of the drop.
 */
const findLipEdge = (world: WorldData, fall: Waterfall, across: number) => {
  const sideX = -fall.directionZ;
  const sideZ = fall.directionX;
  for (let along = LIP_ALONG_REACH; along >= -LIP_ALONG_REACH; along -= LIP_STEP) {
    const x = fall.x + fall.directionX * along + sideX * across;
    const z = fall.z + fall.directionZ * along + sideZ * across;
    if (!isUpperWater(world, fall, x, z)) continue;
    const isStep = isDropBelow(world, fall, x + fall.directionX * LIP_STEP * 2, z + fall.directionZ * LIP_STEP * 2);
    return isStep ? along + LIP_CUT_OFFSET : null;
  }
  return null;
};

const closeRibbon = (ribbons: LipRibbon[], edges: { across: number; along: number }[]) => {
  if (edges.length === 0) return;
  const width = (edges.length - 1) * LIP_STEP + LIP_STEP;
  if (width < MIN_RIBBON_WIDTH) return;
  ribbons.push({
    across: (edges[0]!.across + edges.at(-1)!.across) / 2,
    along: edges.reduce((sum, edge) => sum + edge.along, 0) / edges.length,
    width
  });
};

/**
 * The ribbons the water spills in over the whole wet lip: the upper pool's edge, scanned across the
 * fall, split where dry rock or a bank interrupts it (2–3 ribbons over a wide pool).
 */
const getLipRibbons = (world: WorldData, fall: Waterfall): LipRibbon[] => {
  const reach = Math.max(fall.width / 2, fall.poolRadius) + LIP_ACROSS_EXTRA;
  const ribbons: LipRibbon[] = [];
  let edges: { across: number; along: number }[] = [];
  for (let across = -reach; across <= reach; across += LIP_STEP) {
    const along = findLipEdge(world, fall, across);
    if (along !== null) {
      edges.push({ across, along });
      continue;
    }
    closeRibbon(ribbons, edges);
    edges = [];
  }
  closeRibbon(ribbons, edges);
  return withChannelSheet(ribbons, fall.width);
};

/**
 * The channel's own sheet always falls: ribbons overlapping it join it into one wider ribbon (at their
 * scanned lip), the others stay apart with dry rock between.
 */
const withChannelSheet = (ribbons: LipRibbon[], width: number): LipRibbon[] => {
  const overlaps = (ribbon: LipRibbon) => Math.abs(ribbon.across) < (ribbon.width + width) / 2;
  const joined = ribbons.filter(overlaps);
  const from = Math.min(-width / 2, ...joined.map((ribbon) => ribbon.across - ribbon.width / 2));
  const to = Math.max(width / 2, ...joined.map((ribbon) => ribbon.across + ribbon.width / 2));
  const along = joined.length > 0 ? joined.reduce((sum, ribbon) => sum + ribbon.along, 0) / joined.length : 0;
  return [...ribbons.filter((ribbon) => !overlaps(ribbon)), { across: (from + to) / 2, along, width: to - from }];
};

/** One falling ribbon: a ballistic curtain from its part of the lip down into the pool. */
const writeSheet = (writer: MeshWriter, fall: Waterfall, extra: number[], ribbon: LipRibbon) => {
  const first = writer.positions.length / 3;
  const height = fall.top - fall.bottom;
  const sideX = -fall.directionZ;
  const sideZ = fall.directionX;
  for (let row = 0; row <= SHEET_ROWS; row += 1) {
    const along = row / SHEET_ROWS;
    const forward = ribbon.along + getSheetForward(fall, along);
    const y = fall.top + SHEET_LIFT - (height + SHEET_LIFT + SHEET_SINK) * along;
    const halfWidth = (ribbon.width / 2) * (0.92 + 0.18 * along);
    for (let column = 0; column <= SHEET_COLUMNS; column += 1) {
      const across = column / SHEET_COLUMNS;
      const offset = ribbon.across + (across - 0.5) * 2 * halfWidth;
      writer.positions.push(
        fall.x + fall.directionX * forward + sideX * offset,
        y,
        fall.z + fall.directionZ * forward + sideZ * offset
      );
      writer.uvs.push(across, along);
      writer.extra.push(...extra);
    }
  }
  for (let row = 0; row < SHEET_ROWS; row += 1) {
    for (let column = 0; column < SHEET_COLUMNS; column += 1) {
      const a = first + row * (SHEET_COLUMNS + 1) + column;
      const b = a + SHEET_COLUMNS + 1;
      writer.indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
};

/** The foam disc where the sheet hits the pool, drifting towards the pool centre. */
const writeFoam = (writer: MeshWriter, fall: Waterfall, extra: number[]) => {
  const first = writer.positions.length / 3;
  const foot = getSheetForward(fall, 1);
  const centreX = fall.x + fall.directionX * foot * 0.6 + (fall.poolX - fall.x) * 0.35;
  const centreZ = fall.z + fall.directionZ * foot * 0.6 + (fall.poolZ - fall.z) * 0.35;
  const radius = Math.min(
    fall.poolRadius,
    fall.width / 2 + FOAM_BASE_RADIUS + (fall.top - fall.bottom) * FOAM_PER_HEIGHT
  );
  const y = fall.bottom + FOAM_LIFT;
  writer.positions.push(centreX, y, centreZ);
  writer.uvs.push(0, 0);
  writer.extra.push(...extra);
  for (let ring = 1; ring <= FOAM_RINGS; ring += 1) {
    const share = ring / FOAM_RINGS;
    for (let segment = 0; segment < FOAM_SEGMENTS; segment += 1) {
      const angle = (segment / FOAM_SEGMENTS) * Math.PI * 2;
      writer.positions.push(
        centreX + Math.cos(angle) * radius * share,
        y,
        centreZ + Math.sin(angle) * radius * share
      );
      writer.uvs.push(share, segment / FOAM_SEGMENTS);
      writer.extra.push(...extra);
    }
  }
  for (let segment = 0; segment < FOAM_SEGMENTS; segment += 1) {
    const next = (segment + 1) % FOAM_SEGMENTS;
    writer.indices.push(first, first + 1 + next, first + 1 + segment);
    for (let ring = 1; ring < FOAM_RINGS; ring += 1) {
      const inner = first + 1 + (ring - 1) * FOAM_SEGMENTS;
      const outer = inner + FOAM_SEGMENTS;
      writer.indices.push(inner + segment, inner + next, outer + segment);
      writer.indices.push(inner + next, outer + next, outer + segment);
    }
  }
};

/** Every waterfall of the world as sheet + foam geometry. */
export const buildWaterfallMesh = (world: WorldData): WaterfallMeshData => {
  const writer: MeshWriter = { extra: [], indices: [], positions: [], uvs: [] };
  world.waterfalls.forEach((fall, index) => {
    const fog = getFogVisibility(world, fall.x, fall.z);
    const height = fall.top - fall.bottom;
    const seed = (index * GOLDEN_RATIO) % 1;
    for (const ribbon of getLipRibbons(world, fall)) {
      writeSheet(writer, fall, [WATERFALL_PART.sheet, fog, height, seed], ribbon);
    }
    writeFoam(writer, fall, [WATERFALL_PART.foam, fog, height, seed]);
  });
  return {
    extra: Float32Array.from(writer.extra),
    indices: Uint32Array.from(writer.indices),
    positions: Float32Array.from(writer.positions),
    triangles: writer.indices.length / 3,
    uvs: Float32Array.from(writer.uvs)
  };
};
