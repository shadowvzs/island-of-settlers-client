/**
 * D08: per-vertex wind hierarchy of a decoration plant (trunk < branch < leaf), baked once per
 * template. Every weight is a continuous function of the vertex position, so parts that touch
 * (trunk and branch, twig and leaf, pot rim and stem) move together and nothing detaches.
 * Pure CPU (worker-safe); the High-only shader lives in renderers/three/plants/decoration-wind-sway.ts.
 */

/**
 * Structures never move; wood bends; foliage (leaves, flowers, fruit) also flutters about its
 * attachment. Flowers use the same flutter field as the leaves and stalks they sit on.
 */
export type DecorationSwayPart = "foliage" | "structure" | "wood";

/** Height (world units) of a world tree: decoration plants this tall sway like the trees around them. */
export const SWAY_REFERENCE_HEIGHT = 2.75;
/**
 * Distance from the nearest wood over which a leaf goes from pinned to full flutter: at least
 * 0.08 world units, longer on tall plants (palm fronds meet the crown further from the trunk).
 */
export const SWAY_ATTACH_SPAN = .08;
const ATTACH_SPAN_PER_HEIGHT = .06;
/** Smallest share of the tree sway a low plant keeps (shrubs and flowers barely bend). */
const MIN_SIZE_FACTOR = .25;
/** Wood vertices kept per grid cell for the nearest-wood search (tube rings are dense). */
const WOOD_SAMPLES_PER_CELL = 6;

const STRUCTURE_PART = /pot|soil|ceramic|planter|stone|frame|trellis|iron|plinth/;
const WOOD_PART = /bark|wood|stem|trunk|limb|branch|culm/;
const FOLIAGE_PART =
  /leaf|leaves|foliage|green|frond|needle|spray|petal|pollen|blossom|flower|fruit|bunch|floret|bud|calyx|bearing/;

/**
 * Part of a template mesh by its name. The order matters ("flowering-bark" is wood,
 * "pot" and "soil" are structures before anything else); `undefined` (unknown part) keeps the whole template static.
 */
export const decorationSwayPart = (name: string): DecorationSwayPart | undefined => {
  const lower = name.toLowerCase();
  if (STRUCTURE_PART.test(lower)) return "structure";
  if (WOOD_PART.test(lower)) return "wood";
  if (FOLIAGE_PART.test(lower)) return "foliage";
  return undefined;
};

export interface DecorationSwaySource {
  part: DecorationSwayPart;
  /** xyz per vertex, template space (y up, ground or pot base below). */
  positions: ArrayLike<number>;
}

interface PlantFrame {
  attachSpan: number;
  base: number;
  height: number;
  radius: number;
  sizeFactor: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/** Plants are rooted at the ground (0) or at the top of their pot and soil. */
const plantFrame = (sources: readonly DecorationSwaySource[]): PlantFrame => {
  let base = 0, top = -Infinity, radius = .01;
  for (const { part, positions } of sources) for (let index = 0; index < positions.length; index += 3) {
    const y = positions[index + 1]!;
    if (part === "structure") { base = Math.max(base, y); continue; }
    top = Math.max(top, y);
    radius = Math.max(radius, Math.hypot(positions[index]!, positions[index + 2]!));
  }
  const height = Math.max(.05, top - base);
  return { attachSpan: Math.max(SWAY_ATTACH_SPAN, height * ATTACH_SPAN_PER_HEIGHT), base, height, radius,
    sizeFactor: Math.min(1, Math.max(MIN_SIZE_FACTOR, height / SWAY_REFERENCE_HEIGHT)) };
};

const cellKey = (x: number, y: number, z: number) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);

/** Sparse grid of wood vertices: the nearest-wood distance pins each leaf at its twig. */
interface WoodGrid {
  cells: Map<number, number[]>;
  span: number;
}

const createWoodGrid = (sources: readonly DecorationSwaySource[], span: number): WoodGrid => {
  const cells = new Map<number, number[]>();
  for (const { part, positions } of sources) {
    if (part !== "wood") continue;
    for (let index = 0; index < positions.length; index += 3) {
      const x = positions[index]!, y = positions[index + 1]!, z = positions[index + 2]!;
      const key = cellKey(Math.floor(x / span), Math.floor(y / span), Math.floor(z / span));
      const cell = cells.get(key) ?? [];
      if (cell.length >= WOOD_SAMPLES_PER_CELL * 3) continue;
      cell.push(x, y, z); cells.set(key, cell);
    }
  }
  return { cells, span };
};

/** Distance to the nearest sampled wood point, capped at the attach span. */
const woodDistance = ({ cells, span }: WoodGrid, x: number, y: number, z: number) => {
  const cx = Math.floor(x / span), cy = Math.floor(y / span), cz = Math.floor(z / span);
  let nearest = span * span;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const cell = cells.get(cellKey(cx + dx, cy + dy, cz + dz));
    if (!cell) continue;
    for (let index = 0; index < cell.length; index += 3) {
      const ox = cell[index]! - x, oy = cell[index + 1]! - y, oz = cell[index + 2]! - z;
      nearest = Math.min(nearest, ox * ox + oy * oy + oz * oz);
    }
  }
  return Math.sqrt(nearest);
};

/**
 * Leaf flutter: 0 where a leaf touches wood, 1 a span away. A plant without wood parts pins its
 * leaves by height instead (rosettes and tufts rise from the soil).
 */
const leafFlutter = (wood: WoodGrid, x: number, y: number, z: number, rise: number) => {
  if (wood.cells.size === 0) return smoothstep(0, .3, rise);
  return woodDistance(wood, x, y, z) / wood.span;
};

/**
 * Normalised weights per vertex (xyz = bend, branch, flutter), one array per source; structures
 * get `undefined` and keep their original static material.
 * - bend: (height above the base / plant height)^2, scaled by the plant size: the trunk is rooted.
 * - branch: grows with the distance from the trunk axis, so only branches and crowns add sway.
 * - flutter: foliage only, pinned where it touches wood.
 */
export const decorationSwayWeights = (sources: readonly DecorationSwaySource[]) => {
  const frame = plantFrame(sources), wood = createWoodGrid(sources, frame.attachSpan);
  return sources.map(({ part, positions }) => {
    if (part === "structure") return undefined;
    const weights = new Uint8Array(positions.length);
    for (let index = 0; index < positions.length; index += 3) {
      const x = positions[index]!, y = positions[index + 1]!, z = positions[index + 2]!;
      const rise = clamp01((y - frame.base) / frame.height);
      const branch = rise * smoothstep(.15, 1, Math.hypot(x, z) / frame.radius);
      const flutter = part === "foliage" ? leafFlutter(wood, x, y, z, rise) : 0;
      weights[index] = Math.round(rise * rise * frame.sizeFactor * 255);
      weights[index + 1] = Math.round(branch * 255);
      weights[index + 2] = Math.round(clamp01(flutter) * 255);
    }
    return weights;
  });
};
