import {
  forEachVertexNear,
  getCellCount,
  getVertexSlope,
  getVertexStepRise,
  type GridSize
} from "../grid-geometry";
import { createFbm, smoothstep } from "../noise";
import { deriveSeed } from "../rng";
import { computeDistanceField } from "./distance-field";
import { REFERENCE_CELLS, scaleCount } from "./world-scale";

/** What the mine gravel placement reads (vertex layers, the start and the open border test). */
export interface MineTerrain {
  depositBandScale?: number;
  coastDistance: Float32Array;
  heights: Float32Array;
  isNearOpenBorder: (x: number, z: number) => boolean;
  plateauMask: Float32Array;
  riverDistance: Float32Array;
  start: { x: number; z: number };
  waterDepth: Float32Array;
}

/** What the flank steps read (createFlankRock). */
type FlankTerrain = Pick<MineTerrain, "coastDistance" | "heights" | "riverDistance" | "waterDepth">;

/** Mountain mass that counts as the massif (the rock the gravel rings). */
const MASSIF_LEVEL = 0.6;
/**
 * Gravel ground of the ore deposits: an even band around every massif (or hill top), its base
 * width and the noise added to it (cells). Deposits grow inside it (gameplay); only the deposits
 * and the visible band (APRON) become mine land.
 */
const DEPOSIT_BAND = { noise: 3.5, width: 4 } as const;
/**
 * Visible gravel band around the massif (cells): `narrow` all along the foot, up to `wide` more
 * below tall rock (rising `relief` above the foot), broken into tongues by noise (talus fans
 * spill out, gentle rock keeps a thin rim; grass and soil reach up between them).
 */
const APRON = { narrow: 1.5, relief: [1.5, 6], wide: 4.5 } as const;
/** Tall rock is looked up this far (cells) around a foot vertex. */
const RELIEF_REACH = 5;
/** Ground steeper than this is rock (the material rule), above SNOW_LINE the peaks stay white. */
const MAX_SLOPE = 0.72;
const SNOW_LINE = 7;
/** River banks, the coast and the start settlement stay as they are. */
const RIVER_CLEARANCE = 1.5;
const COAST_CLEARANCE = 2;
const START_CLEARANCE = 12;
/** Without a rock face a few hill tops are ringed instead (count, spacing, disc radius). */
const KNOLL = { perReference: 1.5, radius: 2, spacing: 30 } as const;
/** Rock faces smaller than this (vertices) are lone steep spots, not a massif. */
const MIN_ROCK_VERTICES = 40;
/**
 * Mine ground touching the massif rock: `peak` (a mine ground share that makes the gravel lead
 * without a hard one cell jump from the rock) up to `full` cells, gone at `reach`.
 */
const CONTACT = { full: 1.5, peak: 0.45, reach: 2.3 } as const;
/**
 * Steps of a massif's flank (createFlankRock): the height difference to a neighbour vertex that
 * makes a terrace step, the gap (cells) between two steps of one flank, and its reach (cells)
 * from the massif rock.
 */
const FLANK = { gap: 3, reach: 20, stepRise: 0.9 } as const;
/** Farthest rock (cells) the between test sees: FLANK.gap vertices along a diagonal. */
const FLANK_LINE_REACH = FLANK.gap * Math.SQRT2;
/** Gravel pieces smaller than this (cells) are dropped. */
const MIN_PIECE_CELLS = 6;

/**
 * Hill tops for a map without rock faces: the highest land vertices, KNOLL.spacing apart, up to
 * KNOLL.perReference per 128 x 128; each rings a small disc around it.
 */
const createKnolls = (grid: GridSize, terrain: MineTerrain) => {
  const stride = grid.cellsX + 1;
  const land = [...terrain.heights.keys()].filter((vertex) => terrain.waterDepth[vertex] === 0);
  land.sort((a, b) => terrain.heights[b]! - terrain.heights[a]! || a - b);
  const tops: { x: number; z: number }[] = [];
  const limit = scaleCount(grid, KNOLL.perReference);
  for (const vertex of land) {
    if (tops.length >= limit) break;
    const top = { x: vertex % stride, z: Math.floor(vertex / stride) };
    if (tops.every((other) => Math.hypot(other.x - top.x, other.z - top.z) >= KNOLL.spacing)) {
      tops.push(top);
    }
  }
  return (vertex: number) => {
    const x = vertex % stride;
    const z = Math.floor(vertex / stride);
    return tops.some((top) => Math.hypot(top.x - x, top.z - z) <= KNOLL.radius);
  };
};

/**
 * Massif rock vertices (1): steep mountain ground in pieces of MIN_ROCK_VERTICES or more; smooth
 * high hills and lone steep spots are no massif.
 */
export const createMassifRock = (grid: GridSize, heights: Float32Array, mountain: Float32Array) => {
  const stride = grid.cellsX + 1;
  const rock = Uint8Array.from(mountain, (mass, vertex) => {
    if (mass < MASSIF_LEVEL) return 0;
    const slope = getVertexSlope(grid, heights, vertex % stride, Math.floor(vertex / stride));
    return slope >= MAX_SLOPE ? 1 : 0;
  });
  const vertexGrid = { cellsX: stride, cellsZ: grid.cellsZ + 1 };
  for (const piece of findCellPieces(vertexGrid, rock)) {
    if (piece.length < MIN_ROCK_VERTICES) piece.forEach((vertex) => (rock[vertex] = 0));
  }
  return rock;
};

/**
 * Vertices the gravel rings: the massif rock, or the hill tops where the map has no rock face
 * at all.
 */
const createSources = (grid: GridSize, terrain: MineTerrain, rock: Uint8Array) => {
  if (rock.includes(1)) return (vertex: number) => rock[vertex] === 1;
  return createKnolls(grid, terrain);
};

/** Whether a vertex can carry mine gravel: dry, below the snow line, no rock face. */
export const isGravelGround = (
  grid: GridSize,
  layers: { heights: Float32Array; waterDepth: Float32Array },
  vertex: number
) => {
  const stride = grid.cellsX + 1;
  const x = vertex % stride;
  const z = Math.floor(vertex / stride);
  return (
    layers.waterDepth[vertex] === 0 &&
    layers.heights[vertex]! < SNOW_LINE &&
    getVertexSlope(grid, layers.heights, x, z) < MAX_SLOPE
  );
};

/** Ground (not rock, water, river bank, coast, peak snow, start or a plateau) at a vertex. */
const isOpenGround = (grid: GridSize, terrain: MineTerrain, vertex: number) => {
  const stride = grid.cellsX + 1;
  const x = vertex % stride;
  const z = Math.floor(vertex / stride);
  return (
    isGravelGround(grid, terrain, vertex) &&
    terrain.riverDistance[vertex]! >= RIVER_CLEARANCE &&
    terrain.coastDistance[vertex]! >= COAST_CLEARANCE &&
    terrain.plateauMask[vertex]! < 0.05 &&
    Math.hypot(x - terrain.start.x, z - terrain.start.z) >= START_CLEARANCE &&
    !terrain.isNearOpenBorder(x, z)
  );
};

/** One pass of a sliding maximum (radius `reach`) along x or z of a vertex layer. */
const slideMaximum = (grid: GridSize, values: Float32Array, reach: number, alongX: boolean) => {
  const stride = grid.cellsX + 1;
  const rows = grid.cellsZ + 1;
  const [length, lines] = alongX ? [stride, rows] : [rows, stride];
  const [step, lineStep] = alongX ? [1, stride] : [stride, 1];
  const result = new Float32Array(values.length);
  for (let line = 0; line < lines; line += 1) {
    for (let at = 0; at < length; at += 1) {
      let highest = -Infinity;
      const last = Math.min(length - 1, at + reach);
      for (let near = Math.max(0, at - reach); near <= last; near += 1) {
        highest = Math.max(highest, values[line * lineStep + near * step]!);
      }
      result[line * lineStep + at * step] = highest;
    }
  }
  return result;
};

/**
 * Rock relief per vertex: how far the highest massif rock within RELIEF_REACH cells (a square)
 * rises above the vertex (0 without rock around).
 */
export const createRockRelief = (grid: GridSize, heights: Float32Array, rock: Uint8Array) => {
  const rockHeights = Float32Array.from(heights, (height, vertex) =>
    rock[vertex] === 1 ? height : -Infinity
  );
  const rows = slideMaximum(grid, rockHeights, RELIEF_REACH, true);
  const highest = slideMaximum(grid, rows, RELIEF_REACH, false);
  return Float32Array.from(highest, (top, vertex) => Math.max(0, top - heights[vertex]!));
};

/** Visible band width (cells) at a vertex: narrow along the foot, tongues below tall rock. */
const getApronReach = (relief: number, tongue: number) =>
  APRON.narrow + APRON.wide * smoothstep(APRON.relief[0], APRON.relief[1], relief) * tongue;

/**
 * Gravel vertices of the two bands around (or inside) the massifs, on open ground: `deposit`
 * the even band the deposits grow in, `apron` the visible broken band (the deposit band
 * around hill tops, which have no rock face).
 */
const createVertexBands = (
  grid: GridSize,
  seed: number,
  terrain: MineTerrain,
  rock: Uint8Array
) => {
  const distance = computeDistanceField(grid, createSources(grid, terrain, rock));
  const noise = createFbm(deriveSeed(seed, "mine-apron"), { octaves: 3 });
  const stride = grid.cellsX + 1;
  /** The noise at a vertex, `scale` times per reference map (offset: an independent pattern). */
  const sampleNoise = (vertex: number, scale: number, offset = 0) =>
    noise(
      ((vertex % stride) / REFERENCE_CELLS) * scale + offset,
      (Math.floor(vertex / stride) / REFERENCE_CELLS) * scale - offset
    );
  const widthScale = terrain.depositBandScale ?? 1;
  const deposit = Uint8Array.from(distance, (cells, vertex) => {
    if (cells > (DEPOSIT_BAND.width + DEPOSIT_BAND.noise) * widthScale) return 0;
    const band = smoothstep(-0.5, 0.5, sampleNoise(vertex, 9));
    const reach = (DEPOSIT_BAND.width + DEPOSIT_BAND.noise * band) * widthScale;
    return cells <= reach && isOpenGround(grid, terrain, vertex) ? 1 : 0;
  });
  if (!rock.includes(1)) return { apron: deposit, deposit };
  const relief = createRockRelief(grid, terrain.heights, rock);
  const apron = deposit.map((inBand, vertex) => {
    if (inBand === 0) return 0;
    const tongue = smoothstep(-0.3, 0.4, sampleNoise(vertex, 16, 31));
    return distance[vertex]! <= getApronReach(relief[vertex]!, tongue) ? 1 : 0;
  });
  return { apron, deposit };
};

/** Cells of the 4-connected piece containing `first` among the marked cells. */
const collectPiece = (grid: GridSize, marked: Uint8Array, seen: Uint8Array, first: number) => {
  const piece = [first];
  seen[first] = 1;
  for (let head = 0; head < piece.length; head += 1) {
    const cell = piece[head]!;
    const x = cell % grid.cellsX;
    const next = [x > 0 ? cell - 1 : -1, x < grid.cellsX - 1 ? cell + 1 : -1];
    for (const neighbour of [...next, cell - grid.cellsX, cell + grid.cellsX]) {
      if (neighbour < 0 || neighbour >= marked.length) continue;
      if (seen[neighbour] === 1 || marked[neighbour] !== 1) continue;
      seen[neighbour] = 1;
      piece.push(neighbour);
    }
  }
  return piece;
};

/** The 4-connected pieces of the marked cells (in cell order; a vertex grid works too). */
export const findCellPieces = (grid: GridSize, marked: Uint8Array) => {
  const seen = new Uint8Array(marked.length);
  const pieces: number[][] = [];
  for (let cell = 0; cell < marked.length; cell += 1) {
    if (marked[cell] !== 1 || seen[cell] === 1) continue;
    pieces.push(collectPiece(grid, marked, seen, cell));
  }
  return pieces;
};

/**
 * Open ground cells (1): every corner is open ground (not rock, water, river bank, coast, peak
 * snow, the start or a plateau). A deposit may spread over them when its gravel is too narrow.
 */
export const createOpenGround = (grid: GridSize, terrain: MineTerrain) => {
  const stride = grid.cellsX + 1;
  return Uint8Array.from({ length: getCellCount(grid) }, (_, cell) => {
    const corner = Math.floor(cell / grid.cellsX) * stride + (cell % grid.cellsX);
    const corners = [corner, corner + 1, corner + stride, corner + stride + 1];
    return corners.every((vertex) => isOpenGround(grid, terrain, vertex)) ? 1 : 0;
  });
};

/** Mine ground share at a distance (cells) from the rock it touches (see CONTACT). */
const getContactShare = (cells: number) =>
  CONTACT.peak * (1 - smoothstep(CONTACT.full, CONTACT.reach, cells));

/**
 * A step of a flank (vertex): dry, off the coast and the river banks, on a steep slope or at the
 * edge (top or foot) of a terrace step, where the renderer stands rock slabs.
 */
const isFlankStep = (grid: GridSize, terrain: FlankTerrain, vertex: number) => {
  if (terrain.waterDepth[vertex]! > 0) return false;
  if (terrain.coastDistance[vertex]! < COAST_CLEARANCE) return false;
  if (terrain.riverDistance[vertex]! < RIVER_CLEARANCE) return false;
  const stride = grid.cellsX + 1;
  const x = vertex % stride;
  const z = Math.floor(vertex / stride);
  if (getVertexSlope(grid, terrain.heights, x, z) >= MAX_SLOPE) return true;
  return getVertexStepRise(grid, terrain.heights, x, z) >= FLANK.stepRise;
};

/**
 * Flank vertices (1): the steps of the massif below its rock (terrace steps and gully walls
 * outside the massif level of mountain mass). A step belongs to the massif when it lies within
 * FLANK.gap of its rock or of another of its steps, up to FLANK.reach from the rock.
 */
export const createFlankRock = (grid: GridSize, terrain: FlankTerrain, rock: Uint8Array) => {
  const distance = computeDistanceField(grid, (vertex) => rock[vertex] === 1);
  const steps = Uint8Array.from(distance, (cells, vertex) => {
    if (cells <= 0 || cells > FLANK.reach) return 0;
    return isFlankStep(grid, terrain, vertex) ? 1 : 0;
  });
  const flank = Uint8Array.from(steps, (step, vertex) =>
    step === 1 && distance[vertex]! <= FLANK.gap ? 1 : 0
  );
  const queue = [...flank.keys()].filter((vertex) => flank[vertex] === 1);
  for (let head = 0; head < queue.length; head += 1) {
    forEachVertexNear(grid, queue[head]!, FLANK.gap, (near) => {
      if (steps[near] !== 1 || flank[near] === 1) return;
      flank[near] = 1;
      queue.push(near);
    });
  }
  return flank;
};

/** Lines through a vertex (both ways): along x, along z and both diagonals. */
const LINES = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1]
] as const;

/** Whether a rock vertex lies within FLANK.gap vertices of (x, z) along (stepX, stepZ). */
const hasRockAlong = (
  grid: GridSize,
  rock: Uint8Array,
  vertex: number,
  stepX: number,
  stepZ: number
) => {
  const stride = grid.cellsX + 1;
  const x = vertex % stride;
  const z = Math.floor(vertex / stride);
  for (let step = 1; step <= FLANK.gap; step += 1) {
    const nearX = x + stepX * step;
    const nearZ = z + stepZ * step;
    if (nearX < 0 || nearZ < 0 || nearX > grid.cellsX || nearZ > grid.cellsZ) return false;
    if (rock[nearZ * stride + nearX] === 1) return true;
  }
  return false;
};

/** Ground between two rocks: rock on both sides of one line through the vertex (FLANK.gap). */
export const isBetweenRock = (grid: GridSize, rock: Uint8Array, vertex: number) =>
  LINES.some(
    ([stepX, stepZ]) =>
      hasRockAlong(grid, rock, vertex, stepX, stepZ) &&
      hasRockAlong(grid, rock, vertex, -stepX, -stepZ)
  );

/** Mine ground share per vertex of the dry ground (no rock face, snow or water) touching rock. */
const createRockContact = (grid: GridSize, terrain: MineTerrain, rock: Uint8Array) => {
  const distance = computeDistanceField(grid, (vertex) => rock[vertex] === 1);
  return Float32Array.from(distance, (cells, vertex) => {
    const share = getContactShare(cells);
    return share > 0 && isGravelGround(grid, terrain, vertex) ? share : 0;
  });
};

/**
 * Mine ground share per vertex of the open ground around the mountain rock (the massif rock and
 * its flank steps): touching it (see CONTACT) or lying between two of its rocks (full share).
 */
const createFlankContact = (grid: GridSize, terrain: MineTerrain, rock: Uint8Array) => {
  const flank = createFlankRock(grid, terrain, rock);
  const mountainRock = flank.map((step, vertex) => Math.max(step, rock[vertex]!));
  const distance = computeDistanceField(grid, (vertex) => mountainRock[vertex] === 1);
  return Float32Array.from(distance, (cells, vertex) => {
    if (cells > FLANK_LINE_REACH || !isOpenGround(grid, terrain, vertex)) return 0;
    if (isBetweenRock(grid, mountainRock, vertex)) return CONTACT.peak;
    return getContactShare(cells);
  });
};

/** One 3 x 3 box blur pass over a vertex layer (edges repeat). */
export const blurVertices = (grid: GridSize, values: Float32Array) => {
  const stride = grid.cellsX + 1;
  const rows = grid.cellsZ + 1;
  const at = (x: number, z: number) =>
    values[Math.min(rows - 1, Math.max(0, z)) * stride + Math.min(stride - 1, Math.max(0, x))]!;
  return Float32Array.from(values, (_, index) => {
    const x = index % stride;
    const z = Math.floor(index / stride);
    let sum = 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) sum += at(x + dx, z + dz);
    }
    return sum / 9;
  });
};

/**
 * Feathers the outer edge of the contact over one more vertex of open ground, so the gravel
 * fades into the grass instead of stepping (the splat is blurred before the mine ground lands).
 */
const featherContact = (grid: GridSize, terrain: MineTerrain, shares: Float32Array) => {
  const soft = blurVertices(grid, shares);
  return shares.map((share, vertex) =>
    isGravelGround(grid, terrain, vertex) ? Math.max(share, soft[vertex]!) : share
  );
};

/**
 * Mine ground per vertex where it touches the massif rock (see CONTACT), on dry open ground.
 * Mountain rock borders only mine gravel (rock -> mine gravel -> soil or green), also where the
 * apron itself stays away (plateaus, the start, the coast); water and river beds keep their
 * ground. Its flank steps border it too and the ground between two of its rocks (shelves,
 * gullies) is mine gravel, so no soil lies between two rock steps of one mountain
 * (createFlankContact, on the apron's open ground only).
 */
const createMassifContact = (grid: GridSize, terrain: MineTerrain, rock: Uint8Array) => {
  const flank = createFlankContact(grid, terrain, rock);
  const shares = createRockContact(grid, terrain, rock).map((share, vertex) =>
    Math.max(share, flank[vertex]!)
  );
  return featherContact(grid, terrain, shares);
};

/** Cells (1) whose four corners are all band vertices, without pieces under MIN_PIECE_CELLS. */
const toBandCells = (grid: GridSize, vertexBand: Uint8Array) => {
  const stride = grid.cellsX + 1;
  const band = new Uint8Array(getCellCount(grid));
  for (let cell = 0; cell < band.length; cell += 1) {
    const corner = Math.floor(cell / grid.cellsX) * stride + (cell % grid.cellsX);
    const corners = [corner, corner + 1, corner + stride, corner + stride + 1];
    band[cell] = corners.every((vertex) => vertexBand[vertex] === 1) ? 1 : 0;
  }
  for (const piece of findCellPieces(grid, band)) {
    if (piece.length < MIN_PIECE_CELLS) piece.forEach((cell) => (band[cell] = 0));
  }
  return band;
};

/**
 * Mine gravel cells (1) around every massif, never on rock, water, river banks, the coast, the
 * start settlement, building plateaus or the snowy peaks: `apron` the visible broken band
 * (narrow along the foot, tongues below tall rock), `deposit` the even band the ore deposits
 * grow in; plus the gravel share of the vertices touching the massif rock and between its rocks
 * (see createMassifContact).
 */
export const createMineApron = (
  grid: GridSize,
  seed: number,
  terrain: MineTerrain,
  mountain: Float32Array
) => {
  const rock = createMassifRock(grid, terrain.heights, mountain);
  const bands = createVertexBands(grid, seed, terrain, rock);
  return {
    apron: toBandCells(grid, bands.apron),
    contact: createMassifContact(grid, terrain, rock),
    deposit: toBandCells(grid, bands.deposit)
  };
};
