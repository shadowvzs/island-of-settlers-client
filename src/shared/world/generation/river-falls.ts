import type { GridSize } from "../grid-geometry";
import type { Waterfall } from "../world-data";
import { getMouthDistance, MOUTH_LENGTH, type RiverPoint, SAMPLE_SPACING } from "./river-line";

/** Surface drop (between two samples) from which the step is a waterfall. */
export const WATERFALL_DROP = 0.6;
/**
 * Smaller surface drop of a cascade ledge (river-profile.ts): a low fall with a short sheet,
 * little mist (none on Minimal) and a small plunge pool.
 */
export const LEDGE_DROP = 0.25;
/** Drops on the next samples still belong to the same fall (a cliff over a few samples). */
const FALL_CONTINUES = 0.08;
const MAX_FALL_SAMPLES = 4;
/** Plunge pool radius: the river radius at the foot times this, plus a little. */
const POOL_SCALE = 1.7;
const POOL_EXTRA = 0.4;
/** Pool basin depth below the river bed, and the slope of its walls. */
const POOL_DEPTH = 0.55;
const POOL_WALL_SLOPE = 0.9;
const POOL_WALL_WIDTH = 2;
const POOL_FLOW = 0.8;
/** Ledge pools: smaller, and never reaching past the next lip (step-pool spacing). */
const LEDGE_POOL_SCALE = 1.25;
const LEDGE_POOL_EXTRA = 0.2;
/** A pool reaches this many radii downstream of its lip (centre 0.8 radius past the foot). */
const POOL_CENTRE_SHARE = 0.8;
const POOL_REACH = POOL_CENTRE_SHARE + 1;
/** The smallest ledge pool is the sheet's half width plus this. */
const LEDGE_POOL_MARGIN = 0.15;

/** What the falls need of a carved river (river-carving.ts CarvedRiver). */
export interface FallingRiver {
  /** First sample on the coastline: no cascade ledges in the estuary above it. */
  mouthStep: number;
  points: RiverPoint[];
  profile: Float32Array;
  radius: Float32Array;
}

/** Last sample of a fall starting at `step`: following drops of a cliff over a few samples. */
const findFallEnd = (profile: Float32Array, step: number) => {
  let end = step;
  while (
    end + 1 < profile.length &&
    end - step < MAX_FALL_SAMPLES &&
    profile[end]! - profile[end + 1]! > FALL_CONTINUES
  ) {
    end += 1;
  }
  return end;
};

/** The fall's top sample and its last falling sample. */
interface FallSpan {
  end: number;
  top: number;
}

/** A low cascade step rather than a waterfall. */
export const isLedgeFall = (fall: Waterfall) => fall.top - fall.bottom < WATERFALL_DROP;

/**
 * Plunge pool radius: waterfalls scour wide pools; a ledge keeps a small one that ends before the
 * next lip downstream (at least as wide as its sheet).
 */
const getPoolRadius = (river: FallingRiver, span: FallSpan, nextTop: number | undefined) => {
  const { profile, radius } = river;
  const { end, top } = span;
  if (profile[top]! - profile[end]! >= WATERFALL_DROP) return radius[end]! * POOL_SCALE + POOL_EXTRA;
  const pool = radius[end]! * LEDGE_POOL_SCALE + LEDGE_POOL_EXTRA;
  if (nextTop === undefined) return pool;
  const room = ((nextTop - end) * SAMPLE_SPACING) / POOL_REACH;
  return Math.max(radius[top]! + LEDGE_POOL_MARGIN, Math.min(pool, room));
};

const createWaterfall = (river: FallingRiver, span: FallSpan, nextTop?: number): Waterfall => {
  const { points, profile, radius } = river;
  const { end, top } = span;
  const from = points[top]!;
  const to = points[end]!;
  const before = points[Math.max(0, top - 2)]!;
  const after = points[Math.min(points.length - 1, end + 2)]!;
  const length = Math.hypot(after.x - before.x, after.z - before.z) || 1;
  const directionX = (after.x - before.x) / length;
  const directionZ = (after.z - before.z) / length;
  const poolRadius = getPoolRadius(river, span, nextTop);
  return {
    bottom: profile[end]!,
    directionX,
    directionZ,
    poolRadius,
    poolX: to.x + directionX * poolRadius * POOL_CENTRE_SHARE,
    poolZ: to.z + directionZ * poolRadius * POOL_CENTRE_SHARE,
    top: profile[top]!,
    width: radius[top]! * 2,
    x: (from.x + to.x) / 2,
    z: (from.z + to.z) / 2
  };
};

/**
 * Every step of the water level of at least LEDGE_DROP. A waterfall continues over the following
 * drops of its cliff; a ledge is a single step.
 */
const findFallSpans = ({ mouthStep, profile }: FallingRiver) => {
  const spans: FallSpan[] = [];
  for (let step = 1; step < profile.length; step += 1) {
    const drop = profile[step - 1]! - profile[step]!;
    if (drop < LEDGE_DROP) continue;
    /** The estuary sinks smoothly into the sea: its steeper samples are no ledges. */
    if (drop < WATERFALL_DROP && getMouthDistance(step, mouthStep) < MOUTH_LENGTH) continue;
    const end = drop >= WATERFALL_DROP ? findFallEnd(profile, step) : step;
    spans.push({ end, top: step - 1 });
    step = end;
  }
  return spans;
};

/** The falls of a river: waterfalls (drop of WATERFALL_DROP and more) and cascade ledges. */
export const findWaterfalls = (river: FallingRiver): Waterfall[] => {
  const spans = findFallSpans(river);
  return spans.map((span, index) => createWaterfall(river, span, spans[index + 1]?.top));
};

interface PoolLayers {
  flow: Float32Array;
  mask: Uint8Array;
  surface: Float32Array;
}

/** Ground height of the plunge pool basin and its walls at a distance from the pool centre. */
const getPoolTarget = (fall: Waterfall, distance: number) => {
  if (distance <= fall.poolRadius) {
    return fall.bottom - 0.1 - POOL_DEPTH * (1 - (distance / fall.poolRadius) ** 2);
  }
  return fall.bottom + 0.05 + (distance - fall.poolRadius) * POOL_WALL_SLOPE;
};

/**
 * Plunge pool below a fall: a round, deeper basin at the foot (only downstream of the lip),
 * filled to the level below the fall.
 */
export const carvePlungePool = (
  grid: GridSize,
  heights: Float32Array,
  fall: Waterfall,
  layers: PoolLayers
) => {
  const stride = grid.cellsX + 1;
  const reach = fall.poolRadius + POOL_WALL_WIDTH;
  const fromX = Math.max(0, Math.ceil(fall.poolX - reach));
  const toX = Math.min(grid.cellsX, Math.floor(fall.poolX + reach));
  const fromZ = Math.max(0, Math.ceil(fall.poolZ - reach));
  const toZ = Math.min(grid.cellsZ, Math.floor(fall.poolZ + reach));
  for (let vertexZ = fromZ; vertexZ <= toZ; vertexZ += 1) {
    for (let vertexX = fromX; vertexX <= toX; vertexX += 1) {
      const downstream =
        (vertexX - fall.x) * fall.directionX + (vertexZ - fall.z) * fall.directionZ;
      const distance = Math.hypot(vertexX - fall.poolX, vertexZ - fall.poolZ);
      if (downstream <= 0 || distance > reach) continue;
      const index = vertexZ * stride + vertexX;
      heights[index] = Math.min(heights[index]!, getPoolTarget(fall, distance));
      if (distance > fall.poolRadius) continue;
      layers.mask[index] = 1;
      const surface = layers.surface[index]!;
      layers.surface[index] = Number.isNaN(surface) ? fall.bottom : Math.min(surface, fall.bottom);
      layers.flow[index * 2] = fall.directionX * POOL_FLOW;
      layers.flow[index * 2 + 1] = fall.directionZ * POOL_FLOW;
    }
  }
};

/** Lip banks: upstream (cells) of the lip line and how far beyond the sheet (cells) the banks reach. */
const LIP_UPSTREAM = 1.5;
const LIP_DOWNSTREAM = 1.5;
const LIP_BANK_REACH = 3;
/** Lip banks stand this far above the upper water (dry, like a levee). */
const LIP_BANK_RISE = 0.12;

/** Full bank thickness (cells) beside the notch and downstream of the lip, then the slope it eases off at. */
const LIP_BANK_CORE = 1;
const LIP_BANK_TAPER = 0.9;

/**
 * How far below the full bank height dry ground may stay: the bank keeps two cells of full height
 * beside the notch and eases into the slope beyond (no flat box). Upper pool water is always raised.
 */
const getBankTaper = (beyondSheet: number, along: number, isUpperPool: boolean) => {
  if (isUpperPool) return 0;
  const sideways = Math.max(0, beyondSheet - LIP_BANK_CORE);
  const downstream = Math.max(0, along - LIP_BANK_CORE / 2);
  return (sideways + downstream) * LIP_BANK_TAPER;
};

/** Water of another level than the upper pool (the lower pool, a higher reach) keeps its bed. */
const isOtherWater = (level: number, ground: number, fall: Waterfall) =>
  level > ground && Math.abs(level - fall.top) > 0.01;

/**
 * The upper pool spills only through the fall's notch: beside the sheet the ground at the lip
 * rises just above the upper water (dry bank, out of the bed mask), so no flat pool edge
 * overhangs the drop beside the fall. Dry ground up to 1.5 cells downstream rises with it: the bank
 * is at least two height-map cells thick, so the rendered (smoothed) ground keeps it.
 */
export const raiseLipBanks = (
  grid: GridSize,
  heights: Float32Array,
  fall: Waterfall,
  { mask, surface }: Pick<PoolLayers, "mask" | "surface">
) => {
  const stride = grid.cellsX + 1;
  const half = fall.width / 2;
  const reach = half + LIP_BANK_REACH;
  const fromX = Math.max(0, Math.ceil(fall.x - reach));
  const toX = Math.min(grid.cellsX, Math.floor(fall.x + reach));
  const fromZ = Math.max(0, Math.ceil(fall.z - reach));
  const toZ = Math.min(grid.cellsZ, Math.floor(fall.z + reach));
  for (let vertexZ = fromZ; vertexZ <= toZ; vertexZ += 1) {
    for (let vertexX = fromX; vertexX <= toX; vertexX += 1) {
      const offsetX = vertexX - fall.x;
      const offsetZ = vertexZ - fall.z;
      const along = offsetX * fall.directionX + offsetZ * fall.directionZ;
      const across = Math.abs(offsetZ * fall.directionX - offsetX * fall.directionZ);
      if (along < -LIP_UPSTREAM || along > LIP_DOWNSTREAM || across <= half || across > reach) continue;
      const index = vertexZ * stride + vertexX;
      if (isOtherWater(surface[index]!, heights[index]!, fall)) continue;
      const taper = getBankTaper(across - half, along, Math.abs(surface[index]! - fall.top) <= 0.01);
      heights[index] = Math.max(heights[index]!, fall.top + LIP_BANK_RISE - taper);
      mask[index] = 0;
    }
  }
};
