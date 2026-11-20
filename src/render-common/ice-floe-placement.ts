import { sampleBilinear, sampleSmooth } from "../shared/world/grid-geometry";
import { createSimplexNoise, type Noise2, smoothstep } from "../shared/world/noise";
import { createRandom, deriveSeed, type Random } from "../shared/world/rng";
import type { WorldData } from "../shared/world/world-data";

/**
 * Winter ice floes (presentation only): where real 3D floes float on a winter map. Calm,
 * shallow nearshore sea water from the world's water layout (depth, coast distance, flow) times
 * the winter share; denser close to the shore, a few loose floes further out, never overlapping
 * each other, the shore or the kept-open water (ice-floe-openings.ts). Never feeds the simulation.
 */
export interface IceFloe {
  /** Floe centre (world cells). */
  x: number;
  z: number;
  /** Mean outline radius (cells). */
  radius: number;
  /** Water depth at the centre (the floe rides the swell by it). */
  depth: number;
  /** Shallowest water under the outline, for the submerged depth clamp. */
  minDepth: number;
  /** Water surface height at the centre. */
  surface: number;
  /** 0 close to the shore .. 1 at the outer edge of the ice belt. */
  offshore: number;
  seed: number;
}

export type IceFloeWorld = Pick<WorldData, "cellsX" | "cellsZ" | "coastDistance" | "flow" | "heights" | "seed"
  | "waterSurface">;

/** Winter 0..1 at a point (the snow map) and kept-open water 0..1 (ice-floe-openings.ts bytes / 255). */
export interface IceFloeMasks {
  open: (x: number, z: number) => number;
  winter: (x: number, z: number) => number;
}

const MAX_FLOES = 360;
const ATTEMPTS = 60_000;
/** Ice belt: full density up to BELT_CORE cells offshore, gone after BELT_REACH cells. */
const BELT_CORE = 2.5;
const BELT_REACH = 9;
/** Cells per ice patch: the belt gathers into packed bays and drifting fields with open coast between. */
const PATCH_SCALE = 22;
/** Gap kept between neighbouring floes and between a floe and the shoreline (cells). */
const FLOE_GAP = 0.18;
const SHORE_GAP = 0.25;
/** Shallowest water a floe rim may stand in (its submerged part needs room above the seabed). */
const MIN_RIM_DEPTH = 0.16;
const MAX_FLOW = 0.12;
const RIM_SAMPLES = 10;
const HASH_CELL = 4;

const getDepth = (world: IceFloeWorld, x: number, z: number) =>
  sampleBilinear(world, world.waterSurface, x, z) - sampleSmooth(world, world.heights, x, z);

const getFlow = (world: IceFloeWorld, x: number, z: number) => {
  const vertex = Math.round(z) * (world.cellsX + 1) + Math.round(x);
  return Math.hypot(world.flow[vertex * 2] ?? 0, world.flow[vertex * 2 + 1] ?? 0);
};

/** Ice belt density 0..1 at a water point (0 on land, in currents and outside winter). */
const getBeltDensity = (world: IceFloeWorld, masks: IceFloeMasks, patches: Noise2, x: number, z: number) => {
  const offshore = -sampleBilinear(world, world.coastDistance, x, z);
  if (offshore <= 0) return 0;
  if (getFlow(world, x, z) > MAX_FLOW) return 0;
  const winter = smoothstep(0.35, 0.8, masks.winter(x, z));
  const belt = 1 - smoothstep(BELT_CORE, BELT_REACH, offshore);
  const patch = smoothstep(-0.2, 0.3, patches(x / PATCH_SCALE, z / PATCH_SCALE));
  return winter * belt * patch * (1 - masks.open(x, z));
};

/** Shallowest water depth along the outline, or -1 when the outline reaches the shore. */
const getRimDepth = (world: IceFloeWorld, x: number, z: number, radius: number) => {
  let shallowest = Infinity;
  const reach = radius + SHORE_GAP;
  for (let sample = 0; sample < RIM_SAMPLES; sample++) {
    const angle = (sample / RIM_SAMPLES) * Math.PI * 2;
    const rimX = x + Math.cos(angle) * reach, rimZ = z + Math.sin(angle) * reach;
    if (rimX < 1 || rimZ < 1 || rimX > world.cellsX - 1 || rimZ > world.cellsZ - 1) return -1;
    if (sampleBilinear(world, world.coastDistance, rimX, rimZ) >= -0.05) return -1;
    shallowest = Math.min(shallowest, getDepth(world, rimX, rimZ));
  }
  return shallowest;
};

/** Spatial hash of the accepted floes: the overlap test only visits neighbouring buckets. */
const createFloeHash = () => {
  const buckets = new Map<number, IceFloe[]>();
  const key = (bucketX: number, bucketZ: number) => bucketZ * 4096 + bucketX;
  const overlaps = (x: number, z: number, radius: number) => {
    const bucketX = Math.floor(x / HASH_CELL), bucketZ = Math.floor(z / HASH_CELL);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        for (const floe of buckets.get(key(bucketX + dx, bucketZ + dz)) ?? [])
          if (Math.hypot(floe.x - x, floe.z - z) < floe.radius + radius + FLOE_GAP) return true;
    return false;
  };
  const add = (floe: IceFloe) => {
    const bucket = key(Math.floor(floe.x / HASH_CELL), Math.floor(floe.z / HASH_CELL));
    const list = buckets.get(bucket);
    if (list) list.push(floe);
    else buckets.set(bucket, [floe]);
  };
  return { add, overlaps };
};

/** Large shore-fast pans first, then medium floes, then small brash filling the gaps. */
const FLOE_PASSES = [
  { maxRadius: 2.1, minRadius: 1.25, share: 0.3 },
  { maxRadius: 1.25, minRadius: 0.7, share: 0.35 },
  { maxRadius: 0.7, minRadius: 0.38, share: 0.35 }
] as const;

interface PlacementContext {
  masks: IceFloeMasks;
  patches: Noise2;
  random: Random;
  world: IceFloeWorld;
}

const tryFloe = (
  { masks, patches, random, world }: PlacementContext, pass: (typeof FLOE_PASSES)[number]
): IceFloe | null => {
  const x = 1 + random() * (world.cellsX - 2), z = 1 + random() * (world.cellsZ - 2);
  const density = getBeltDensity(world, masks, patches, x, z);
  if (density <= 0.02 || random() > density * density) return null;
  const offshore = Math.min(1, -sampleBilinear(world, world.coastDistance, x, z) / BELT_REACH);
  // Big pans hug the shore; out in the belt the floes break into smaller pieces.
  const shrink = 1 - 0.45 * offshore;
  const radius = (pass.minRadius + random() * (pass.maxRadius - pass.minRadius)) * shrink;
  const minDepth = getRimDepth(world, x, z, radius);
  if (minDepth < MIN_RIM_DEPTH) return null;
  return {
    depth: getDepth(world, x, z), minDepth, offshore, radius, seed: random(),
    surface: sampleBilinear(world, world.waterSurface, x, z), x, z
  };
};

export const placeIceFloes = (world: IceFloeWorld, masks: IceFloeMasks, maxFloes = MAX_FLOES): IceFloe[] => {
  const context: PlacementContext = {
    masks, patches: createSimplexNoise(deriveSeed(world.seed, "ice-floe-patches-v1")),
    random: createRandom(deriveSeed(world.seed, "ice-floes-v1")), world
  };
  const hash = createFloeHash();
  const floes: IceFloe[] = [];
  for (const pass of FLOE_PASSES) {
    const target = floes.length + Math.round(maxFloes * pass.share);
    for (let attempt = 0; attempt < ATTEMPTS && floes.length < target; attempt++) {
      const floe = tryFloe(context, pass);
      if (!floe || hash.overlaps(floe.x, floe.z, floe.radius)) continue;
      hash.add(floe);
      floes.push(floe);
    }
  }
  return floes;
};
