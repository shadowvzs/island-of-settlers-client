import { sampleMountainTemplate } from "../editing/terrain/mountain-template";
import { type GridSize,readVertex } from "../grid-geometry";
import { createFbm, smoothstep } from "../noise";
import { createRandom, deriveSeed, type Random } from "../rng";
import { featureCellRuns, type GeneratedFeatureIdentity,validGeneratedFeatureIdentities } from "./generated-feature-identities";
import {
  type Cirque,
  createMassifShape,
  type MassifShape,
  type Ridge,
  smoothMax} from "./mountain-ridges";
import { getLinearScale } from "./world-scale";

/**
 * Mountains built from structure, not from noise: broad massifs with a ridgeline (peaks and
 * saddles), spurs down to the lowland, cirques at the valley heads, a steep cliff side and a
 * gentle back slope (mountain-ridges.ts). Noise only roughens the result; erosion later cuts the
 * channels, and the slope limiter keeps every face believable.
 */
interface Massif extends MassifShape {
  /** Distance from the centre beyond which the massif adds no height. */
  reach: number;
  source?: { height: number; radius: number; angle: number };
  x: number;
  z: number;
}

/** Concave flank profile: steeper below the crest, easing out to the lowland. */
const FLANK_CURVE = 1.5;
/** Massif centres keep this far (cells, before the size factor) from each other. */
const CENTRE_SPACING = 46;
/** Cells of coast / border room a centre needs (before the size factor). */
const CENTRE_ROOM = 22;
/** Steepest rise per cell of coast room: mountains at the shore become sea cliffs, not walls. */
const ROOM_RISE = 0.8;
const ROOM_SOFTNESS = 1.5;

interface Centre {
  /** Mountain mask at the centre (0..1). */
  strength: number;
  x: number;
  z: number;
}

/** Lowest centre score: no massif where the mask is weak. */
const MIN_CENTRE_SCORE = 0.3;

/** Centre score: the mountain mask, preferring spots where the coast leaves room for a massif. */
const scoreCentre = (strength: number, room: number, size: number) =>
  strength * (0.5 + 0.5 * smoothstep(CENTRE_ROOM * size * 0.5, CENTRE_ROOM * size, room));

/** Massif centres: the strongest mountain mask spots with room, kept well apart. */
const pickCentres = (grid: GridSize, mask: Float32Array, room: Float32Array, count: number) => {
  const size = getSizeFactor(grid);
  const spacing = CENTRE_SPACING * size;
  const centres: Centre[] = [];
  for (let pick = 0; pick < count; pick += 1) {
    let best = { score: MIN_CENTRE_SCORE, strength: 0, x: -1, z: -1 };
    for (let z = 10; z < grid.cellsZ - 10; z += 3) {
      for (let x = 10; x < grid.cellsX - 10; x += 3) {
        if (centres.some((centre) => Math.hypot(centre.x - x, centre.z - z) <= spacing)) continue;
        const strength = readVertex(grid, mask, x, z);
        const score = scoreCentre(strength, readVertex(grid, room, x, z), size);
        if (score > best.score) best = { score, strength, x, z };
      }
    }
    if (best.x < 0) break;
    centres.push({ strength: best.strength, x: best.x, z: best.z });
  }
  return centres;
};

/** Cells around a centre over which the room gradient (the inland direction) is measured. */
const INLAND_PROBE = 8;

/** Direction of growing room (inland) at a centre; random where the room is level. */
const getInland = (grid: GridSize, room: Float32Array, centre: Centre, random: Random) => {
  const read = (dx: number, dz: number) =>
    readVertex(grid, room, centre.x + dx * INLAND_PROBE, centre.z + dz * INLAND_PROBE);
  const gradientX = read(1, 0) - read(-1, 0);
  const gradientZ = read(0, 1) - read(0, -1);
  if (Math.hypot(gradientX, gradientZ) < 0.5) return random() * Math.PI * 2;
  return Math.atan2(gradientZ, gradientX);
};

/** The crest runs along the coast (across the inland direction), turned a little at random. */
const getAxis = (inland: number, random: Random) => inland + Math.PI / 2 + (random() - 0.5) * 0.8;

/** Farthest ridge point plus the run-out of its flank: the massif's horizontal extent. */
const getMassifReach = (centre: Centre, ridges: Ridge[]) => {
  let reach = 0;
  for (const ridge of ridges) {
    const run = Math.max(...ridge.crest) / Math.min(...ridge.slopes);
    for (const [x, z] of ridge.points) {
      reach = Math.max(reach, Math.hypot(x - centre.x, z - centre.z) + run);
    }
  }
  return reach;
};

interface MassifScale {
  height: number;
  size: number;
}

const createMassif = (
  centre: Centre,
  inland: number,
  scale: MassifScale,
  noiseSeed: number,
  random: Random
): Massif => {
  const height = (8 + random() * 4 + smoothstep(0.5, 0.9, centre.strength) * 2) * scale.height;
  const axis = getAxis(inland, random);
  const seed = { axis, height, inland, size: scale.size, x: centre.x, z: centre.z };
  const shape = createMassifShape(seed, noiseSeed, random);
  return { ...shape, reach: getMassifReach(centre, shape.ridges), x: centre.x, z: centre.z };
};

const getFlankHeight = (crest: number, distance: number, slope: number) => {
  const t = (distance * slope) / crest;
  return t >= 1 ? 0 : crest * Math.pow(1 - t, FLANK_CURVE);
};

/** Height of one ridge at a point: crest at the nearest segment, the flank profile of that side. */
const getRidgeHeight = (ridge: Ridge, x: number, z: number) => {
  let best = 0;
  for (let index = 0; index < ridge.points.length - 1; index += 1) {
    const [ax, az] = ridge.points[index]!;
    const [bx, bz] = ridge.points[index + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const distance = Math.hypot(x - ax - dx * t, z - az - dz * t);
    const side = dx * (z - az) - dz * (x - ax) > 0 ? 0 : 1;
    const crest = ridge.crest[index]! + (ridge.crest[index + 1]! - ridge.crest[index]!) * t;
    best = Math.max(best, getFlankHeight(crest, distance, ridge.slopes[side]!));
  }
  return best;
};

/** A cirque caps the ground with a bowl: flat floor, steepening headwall up to its rim. */
const applyCirque = (height: number, cirque: Cirque, x: number, z: number) => {
  const reach = Math.hypot(x - cirque.x, z - cirque.z) / cirque.radius;
  if (reach >= 1.2 || height <= cirque.floor) return height;
  const bowl = cirque.floor + reach * reach * (cirque.rim - cirque.floor);
  return Math.min(height, bowl);
};

const getMassifHeight = (massif: Massif, x: number, z: number) => {
  if (Math.hypot(x - massif.x, z - massif.z) >= massif.reach) return 0;
  if (massif.source) {
    const { angle, height, radius } = massif.source;
    const dx = (x - massif.x) / radius, dz = (z - massif.z) / radius;
    return height * sampleMountainTemplate(dx * Math.cos(angle) - dz * Math.sin(angle),
      dx * Math.sin(angle) + dz * Math.cos(angle));
  }
  let height = 0;
  for (const ridge of massif.ridges) {
    const ridgeHeight = getRidgeHeight(ridge, x, z);
    if (ridgeHeight > 0) height = smoothMax(height, ridgeHeight, 1.2);
  }
  for (const cirque of massif.cirques) height = applyCirque(height, cirque, x, z);
  return height;
};

/** Massifs per reference grid (128 x 128); more on bigger maps, each the same size. */
const MASSIFS_PER_REFERENCE = 1.75;

/**
 * Massif count factor of the mountain amount: none at 0, linear up to the default, then half as
 * steep (x1.4 at the maximum), so "Many" mountains still leave the island its building land.
 */
const getCountFactor = (amount: number) => (amount <= 1 ? amount : 1 + (amount - 1) * 0.4);

/** Land share of the reference island the massif count was tuned on. */
const REFERENCE_LAND_SHARE = 0.5;

/** The mountain option and the land share of the map (archipelagos have less land). */
export interface MountainRelief {
  amount: number;
  landShare: number;
  /** Planned upland islands ask for one massif each (where their mask and room allow it). */
  minimumCount?: number;
  scale?: number;
}

/**
 * Massifs for the map, its land and the mountain amount, rounded half down: a 64 x 64 map keeps
 * a single massif even at the maximum amount (two would bury its building land).
 */
const getMassifCount = (grid: GridSize, { amount, landShare, minimumCount = 0 }: MountainRelief) => {
  const land = landShare / REFERENCE_LAND_SHARE;
  const exact = MASSIFS_PER_REFERENCE * getLinearScale(grid) ** 2 * land * getCountFactor(amount);
  return Math.max(minimumCount, Math.round(exact + 0.1));
};

/** Below the reference map size the massifs shrink a little (to 0.6 on 64 x 64). */
const getSizeFactor = (grid: GridSize) => Math.min(1, Math.max(0.6, getLinearScale(grid)));

/**
 * Massif scale: the height grows with the mountain amount (1 at the default, 1.15 at the maximum
 * 2); the size factor shrinks the footprint on small maps, so a small island is not one mountain.
 */
const getMassifScale = (grid: GridSize, amount: number): MassifScale => ({
  height: amount <= 1 ? 0.75 + amount * 0.25 : 1 + (amount - 1) * 0.15,
  size: getSizeFactor(grid)
});

/** The coast room caps the rise smoothly (a smooth minimum, no crease). */
const capByRoom = (height: number, room: number) =>
  Math.max(0, -smoothMax(-height, -room * ROOM_RISE, ROOM_SOFTNESS));

/**
 * Mountain heights per vertex (0 away from the massifs), roughened by noise relative to their
 * height so crests stay crisp but faces get broad bulges and bays; `room` (cells to the coast or
 * the map border) caps the rise, so a massif near the sea ends in steep coast, not in a wall.
 */
export const createMountainHeights = (
  grid: GridSize,
  seed: number,
  mask: Float32Array,
  room: Float32Array,
  relief: MountainRelief,
  capture?: (features: GeneratedFeatureIdentity[]) => void
) => {
  const random = createRandom(deriveSeed(seed, "mountain-masses"));
  const baseScale = getMassifScale(grid, relief.amount), factor = relief.scale ?? 1;
  const scale = { height: baseScale.height * factor, size: baseScale.size * factor };
  const centres = pickCentres(grid, mask, room, getMassifCount(grid, relief));
  const noiseSeed = deriveSeed(seed, "mountain-crests");
  const sourceRandom = createRandom(deriveSeed(seed, "mountain-source-massifs"));
  const massifs = centres.map((centre, index) => {
    const inland = getInland(grid, room, centre, random);
    const massif = createMassif(centre, inland, scale, noiseSeed, random);
    // Whole processed source silhouettes on large maps; ordinary erosion, slope caps,
    // plateau and river placement subsequently operate on the same authoritative heights.
    // Smaller maps keep their scarce building ground and legacy start-resource layout.
    if (Math.min(grid.cellsX, grid.cellsZ) >= 256 && index % 3 === 0) {
      massif.source = { angle: sourceRandom() * Math.PI * 2,
        height: Math.max(...massif.ridges.flatMap(ridge => ridge.crest)) * .9,
        radius: Math.min(massif.reach, 28 * scale.size) };
    }
    return massif;
  });
  const supports = capture ? massifs.map(() => new Set<number>()) : [];
  const rough = createFbm(deriveSeed(seed, "mountain-rough"), { octaves: 4 });
  const heights = new Float32Array((grid.cellsX + 1) * (grid.cellsZ + 1));
  let index = 0;
  for (let z = 0; z <= grid.cellsZ; z += 1) {
    for (let x = 0; x <= grid.cellsX; x += 1) {
      let height = 0;
      for (let source = 0; source < massifs.length; source++) {
        const rise = getMassifHeight(massifs[source]!, x, z);
        height = Math.max(height, rise);
        if (capture && rise > .001 && room[index]! > 0 && capByRoom(rise, room[index]!) > .001) {
          for (const dz of [-1, 0]) for (const dx of [-1, 0]) {
            const cx = x + dx, cz = z + dz;
            if (cx >= 0 && cz >= 0 && cx < grid.cellsX && cz < grid.cellsZ)
              supports[source]!.add(cz * grid.cellsX + cx);
          }
        }
      }
      heights[index] =
        height > 0 ? capByRoom(height * (1 + rough(x * 0.09, z * 0.09) * 0.12), room[index]!) : 0;
      index += 1;
    }
  }
  if (capture) {
    const features: GeneratedFeatureIdentity[] = massifs.flatMap((massif, i) => supports[i]!.size ? [{
      version: 1, id: i + 1, source: "massif", kind: "relief", x: massif.x, z: massif.z,
      runs: featureCellRuns(supports[i]!)
    }] : []);
    capture(validGeneratedFeatureIdentities(features, grid) ? features : []);
  }
  return heights;
};
