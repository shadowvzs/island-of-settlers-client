import { type GridSize, sampleBilinear } from "../../shared/world/grid-geometry";
import { createFbm, smoothstep } from "../../shared/world/noise";
import { deriveSeed } from "../../shared/world/rng";
import type { WorldData } from "../../shared/world/world-data";

/**
 * Upright rock faces (MC-02, render only). The island draws its mountains with the terrain mesh
 * itself (no raised skin since 2026-10-11), so tall steep faces are stood upright by shifting the
 * terrain's render vertices horizontally toward the face's lip: the face keeps its lip (crests and
 * ridges stay sharp), its foot moves in and the ground in front of it stretches. Heights, picking,
 * walking, building and saves keep the heightfield; only the drawn surface moves (0 extra
 * triangles on every preset). A pure function of the heights, so chunk seams stay watertight.
 */

/** Share of the lip distance a fully upright face moves toward its lip (0 keeps the old surface). */
export const UPRIGHT_SHARE = 0.85;
/**
 * Largest shift (cells): it saturates smoothly, so the upper face stands upright and a long face
 * keeps a sloping, buttressed base (peaks do not shrink into needles).
 */
const SHIFT_LIMIT = 3;
/** Mean face slope (rise per run) where a face starts to stand up, and where it is fully upright. */
const FACE_SLOPE: [number, number] = [0.85, 1.7];
/** Face height (foot to lip) over which it starts to stand up: short banks stay as they are. */
const FACE_RISE: [number, number] = [1.5, 3.5];
/** The face ends (foot, lip) where the slope falls below this. */
const FLAT_SLOPE = 0.55;
const MARCH_STEP = 0.25;
/** Farthest march (cells) to the foot or the lip. */
const MARCH_LIMIT = 8;
/** Shores and river banks keep their surface (cells): the water's edge stays where it is. */
const WATER_OPEN: [number, number] = [1.5, 3];
/** Steepness of the vertex itself below which it never moves. */
const MOVING_SLOPE = 0.5;
/**
 * Smallest local area ratio of the moved surface (an upright face compresses to 1 - UPRIGHT_SHARE):
 * shifts that converge further (folds at convex spurs) are scaled back below it.
 */
const MIN_AREA_RATIO = 0.1;
/**
 * Rock relief of upright faces: the shift swells and shrinks along the wall by up to this share,
 * so a face stands out in buttresses and sinks into recesses (vertical ribs about RELIEF_SPACING
 * apart) instead of being one flat plane. Part of the shift field, so the fold clamp covers it.
 */
const RELIEF_SHARE = 0.32;
const RELIEF_SPACING = 2.2;
/** Extra vertices computed around a region (the fold clamp reads neighbours, twice). */
const HALO = 3;
/**
 * Probe (cells) beyond the lip: level ground there is a plateau edge (the face stands upright), ground
 * falling away is a ridge or a peak, which keeps most of its pyramid (CREST_SHARE of the shift).
 */
const BEYOND_PROBE = 1.5;
const CREST_SHARE = 0.2;
const CREST_DROP: [number, number] = [-1.6, -0.4];
/**
 * Probes (cells) below the foot: ground rising again there is a bowl, a cirque or a gorge, which
 * keeps its sloping walls (an upright wall there would hollow the massif into an arena).
 */
const BOWL_PROBES = [1, 2, 3, 4, 5, 6, 8, 10] as const;
const BOWL_RISE: [number, number] = [0.4, 1.8];
/**
 * Plan curvature (divergence of the uphill directions, 1 / radius in cells) over which a face
 * curving around its foot keeps its slope: the headwall of a bowl or cirque never stands upright.
 */
const HEADWALL_CURVATURE: [number, number] = [0.05, 0.22];

/** Inclusive vertex region (world vertex coordinates). */
export interface VertexRegion {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

type Heights = (x: number, z: number) => number;

const slopeAt = (height: Heights, x: number, z: number) =>
  Math.hypot(height(x + .5, z) - height(x - .5, z), height(x, z + .5) - height(x, z - .5));

/** Walks along (dirX, dirZ) while the ground keeps rising (sign 1) or falling (-1) steeply. */
const marchFace = (height: Heights, x: number, z: number, dirX: number, dirZ: number, sign: number) => {
  let distance = 0, current = height(x, z), slope = slopeAt(height, x, z);
  while (distance < MARCH_LIMIT) {
    const nextX = x + dirX * (distance + MARCH_STEP) * sign;
    const nextZ = z + dirZ * (distance + MARCH_STEP) * sign;
    const next = height(nextX, nextZ);
    if ((next - current) * sign <= 0) break;
    const nextSlope = slopeAt(height, nextX, nextZ);
    if (nextSlope < FLAT_SLOPE) {
      const share = (slope - FLAT_SLOPE) / Math.max(1e-6, slope - nextSlope);
      return { distance: distance + MARCH_STEP * share, height: current + (next - current) * share };
    }
    distance += MARCH_STEP;
    current = next;
    slope = nextSlope;
  }
  return { distance, height: current };
};

interface FaceEnd {
  distance: number;
  height: number;
}

/** 1 at a plateau edge .. CREST_SHARE where the ground falls away beyond the lip (ridges, peaks). */
const getLipShare = (height: Heights, x: number, z: number, dirX: number, dirZ: number, lip: FaceEnd) => {
  const reach = lip.distance + BEYOND_PROBE;
  const beyond = height(x + dirX * reach, z + dirZ * reach) - lip.height;
  return CREST_SHARE + (1 - CREST_SHARE) * smoothstep(CREST_DROP[0], CREST_DROP[1], beyond);
};

/** 1 where the ground below the foot opens out .. 0 where it rises again (bowl, cirque, gorge). */
const getFootOpening = (height: Heights, x: number, z: number, dirX: number, dirZ: number, foot: FaceEnd) => {
  let rise = 0;
  for (const probe of BOWL_PROBES) {
    const reach = foot.distance + probe;
    rise = Math.max(rise, height(x - dirX * reach, z - dirZ * reach) - foot.height);
  }
  return 1 - smoothstep(BOWL_RISE[0], BOWL_RISE[1], rise);
};

const uphillAt = (height: Heights, x: number, z: number) => {
  const gradientX = height(x + .5, z) - height(x - .5, z), gradientZ = height(x, z + .5) - height(x, z - .5);
  const length = Math.hypot(gradientX, gradientZ) || 1;
  return [gradientX / length, gradientZ / length] as const;
};

/**
 * 1 on straight faces and spur noses .. 0 on faces curving around their foot (bowl headwalls): the
 * turn of the uphill direction one cell to either side along the contour (plan curvature).
 */
const getPlanOpening = (height: Heights, x: number, z: number, dirX: number, dirZ: number) => {
  const tangentX = -dirZ, tangentZ = dirX;
  const [leftX, leftZ] = uphillAt(height, x - tangentX, z - tangentZ);
  const [rightX, rightZ] = uphillAt(height, x + tangentX, z + tangentZ);
  const curvature = ((rightX - leftX) * tangentX + (rightZ - leftZ) * tangentZ) / 2;
  return 1 - smoothstep(HEADWALL_CURVATURE[0], HEADWALL_CURVATURE[1], curvature);
};

type Relief = (x: number, z: number) => number;

/** -RELIEF_SHARE .. RELIEF_SHARE per vertex: buttresses (more upright) and recesses along a wall. */
const createRelief = (seed: number): Relief => {
  const noise = createFbm(deriveSeed(seed, "face-relief"), { octaves: 3 });
  return (x, z) => Math.max(-1, Math.min(1, noise(x / RELIEF_SPACING, z / RELIEF_SPACING) * 1.6)) * RELIEF_SHARE;
};

/** Raw shift (toward the lip) of one vertex, before smoothing and the fold clamp. */
const getRawShift = (world: WorldData, height: Heights, relief: Relief, x: number, z: number): [number, number] => {
  const gradientX = height(x + .5, z) - height(x - .5, z);
  const gradientZ = height(x, z + .5) - height(x, z - .5);
  const slope = Math.hypot(gradientX, gradientZ);
  if (slope < MOVING_SLOPE) return [0, 0];
  const water = Math.min(sampleBilinear(world, world.coastDistance, x, z), sampleBilinear(world, world.riverDistance, x, z));
  const open = smoothstep(WATER_OPEN[0], WATER_OPEN[1], water);
  if (open <= 0) return [0, 0];
  const dirX = gradientX / slope, dirZ = gradientZ / slope;
  const lip = marchFace(height, x, z, dirX, dirZ, 1);
  const foot = marchFace(height, x, z, dirX, dirZ, -1);
  const rise = lip.height - foot.height, run = lip.distance + foot.distance;
  if (run <= 0) return [0, 0];
  const wall = smoothstep(FACE_SLOPE[0], FACE_SLOPE[1], rise / run) * smoothstep(FACE_RISE[0], FACE_RISE[1], rise) *
    getLipShare(height, x, z, dirX, dirZ, lip) * getFootOpening(height, x, z, dirX, dirZ, foot) *
    getPlanOpening(height, x, z, dirX, dirZ);
  if (wall <= 0) return [0, 0];
  const shift = SHIFT_LIMIT * (1 - Math.exp(-UPRIGHT_SHARE * lip.distance / SHIFT_LIMIT)) * wall * open *
    (1 + relief(x, z));
  return [dirX * shift, dirZ * shift];
};

interface LocalField {
  columns: number;
  rows: number;
  shiftX: Float32Array;
  shiftZ: Float32Array;
  x0: number;
  z0: number;
}

/** Scales shifts back where neighbouring shifts converge so far that the surface would fold. */
const clampFolds = (field: LocalField) => {
  const { columns, rows, shiftX, shiftZ } = field;
  const scale = new Float32Array(shiftX.length).fill(1);
  for (let row = 1; row < rows - 1; row += 1) for (let column = 1; column < columns - 1; column += 1) {
    const index = row * columns + column;
    const dxx = (shiftX[index + 1]! - shiftX[index - 1]!) / 2, dxz = (shiftX[index + columns]! - shiftX[index - columns]!) / 2;
    const dzx = (shiftZ[index + 1]! - shiftZ[index - 1]!) / 2, dzz = (shiftZ[index + columns]! - shiftZ[index - columns]!) / 2;
    const area = (1 + dxx) * (1 + dzz) - dxz * dzx;
    if (area >= MIN_AREA_RATIO) continue;
    const keep = Math.max(0, area) / MIN_AREA_RATIO;
    for (const neighbour of [index, index - 1, index + 1, index - columns, index + columns])
      scale[neighbour] = Math.min(scale[neighbour]!, keep);
  }
  for (let index = 0; index < scale.length; index += 1) {
    shiftX[index] = shiftX[index]! * scale[index]!;
    shiftZ[index] = shiftZ[index]! * scale[index]!;
  }
};

/** The upright shifts of a vertex region (plus its halo), fold clamped. */
const createLocalField = (world: WorldData, region: VertexRegion): LocalField => {
  const x0 = region.minX - HALO, z0 = region.minZ - HALO;
  const columns = region.maxX - region.minX + 1 + HALO * 2, rows = region.maxZ - region.minZ + 1 + HALO * 2;
  const shiftX = new Float32Array(columns * rows), shiftZ = new Float32Array(columns * rows);
  const height: Heights = (x, z) => sampleBilinear(world, world.heights, x, z);
  const relief = createRelief(world.seed ?? 0);
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const x = Math.min(world.cellsX, Math.max(0, x0 + column)), z = Math.min(world.cellsZ, Math.max(0, z0 + row));
    const [moveX, moveZ] = getRawShift(world, height, relief, x, z);
    shiftX[row * columns + column] = moveX;
    shiftZ[row * columns + column] = moveZ;
  }
  const field = { columns, rows, shiftX, shiftZ, x0, z0 };
  clampFolds(field);
  clampFolds(field);
  return field;
};

const sampleField = (field: LocalField, values: Float32Array, x: number, z: number) => {
  const u = Math.min(field.columns - 1.0001, Math.max(0, x - field.x0));
  const v = Math.min(field.rows - 1.0001, Math.max(0, z - field.z0));
  const column = Math.floor(u), row = Math.floor(v), fu = u - column, fv = v - row;
  const index = row * field.columns + column;
  const top = values[index]! * (1 - fu) + values[index + 1]! * fu;
  const bottom = values[index + field.columns]! * (1 - fu) + values[index + field.columns + 1]! * fu;
  return top * (1 - fv) + bottom * fv;
};

/** Writes the drawn offset of (x, z): the upright shift toward the lip. */
const writeOffset = (field: LocalField, x: number, z: number, out: Float32Array) => {
  out[0] = sampleField(field, field.shiftX, x, z);
  out[1] = sampleField(field, field.shiftZ, x, z);
};

/** Spacing of the samples that give a moved vertex its normal (the render mesh spacing). */
const NORMAL_STEP = 0.5;
/** Shift (cells) over which the moved surface's normal fully replaces the heightfield normal. */
const NORMAL_BLEND = 0.2;
/** Sample offsets of the normal: east, west, south, north. */
const NORMAL_OFFSETS = [[NORMAL_STEP, 0], [-NORMAL_STEP, 0], [0, NORMAL_STEP], [0, -NORMAL_STEP]] as const;

export interface FaceUpright {
  /** False when no vertex of the region moves (the sampler can skip the field entirely). */
  active: boolean;
  /** Horizontal shift of the drawn surface at (x, z), written into `out` ([dx, dz]). */
  shift: (x: number, z: number, out: Float32Array) => void;
  /**
   * The moved surface's normal at (x, z) blended over `normal` (in place, unit length) where the
   * surface moves; `ground` is the drawn height function.
   */
  bendNormal: (x: number, z: number, ground: Heights, normal: Float32Array, offset: number) => void;
}

const NO_UPRIGHT: FaceUpright = { active: false, bendNormal: () => undefined, shift: (_x, _z, out) => out.fill(0) };

/** Unit normal of the moved surface from its four neighbour points ([x, y, z] each, E W S N). */
const getMovedNormal = (points: Float32Array) => {
  const ax = points[0]! - points[3]!, ay = points[1]! - points[4]!, az = points[2]! - points[5]!;
  const bx = points[6]! - points[9]!, by = points[7]! - points[10]!, bz = points[8]! - points[11]!;
  const nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length] as const;
};

const blendNormal = (normal: Float32Array, offset: number, moved: readonly number[], blend: number) => {
  const x = normal[offset]! + (moved[0]! - normal[offset]!) * blend;
  const y = normal[offset + 1]! + (moved[1]! - normal[offset + 1]!) * blend;
  const z = normal[offset + 2]! + (moved[2]! - normal[offset + 2]!) * blend;
  const length = Math.hypot(x, y, z) || 1;
  normal[offset] = x / length;
  normal[offset + 1] = y / length;
  normal[offset + 2] = z / length;
};

/**
 * The upright field of a vertex region (a terrain chunk): the region plus a halo is computed, so a
 * vertex shared by two chunks gets the same shift and normal in both.
 */
export const createFaceUpright = (world: WorldData, region: VertexRegion): FaceUpright => {
  if (UPRIGHT_SHARE <= 0) return NO_UPRIGHT;
  const field = createLocalField(world, region);
  if (!field.shiftX.some(value => value !== 0) && !field.shiftZ.some(value => value !== 0)) return NO_UPRIGHT;
  const points = new Float32Array(12), offset = new Float32Array(2);
  return {
    active: true,
    bendNormal: (x, z, ground, normal, normalOffset) => {
      let largest = 0;
      NORMAL_OFFSETS.forEach(([dx, dz]) => {
        const sampleX = x + dx, sampleZ = z + dz;
        largest = Math.max(largest, Math.hypot(sampleField(field, field.shiftX, sampleX, sampleZ),
          sampleField(field, field.shiftZ, sampleX, sampleZ)));
      });
      const blend = smoothstep(0, NORMAL_BLEND, largest);
      if (blend <= 0) return;
      NORMAL_OFFSETS.forEach(([dx, dz], index) => {
        const sampleX = x + dx, sampleZ = z + dz, height = ground(sampleX, sampleZ);
        writeOffset(field, sampleX, sampleZ, offset);
        points[index * 3] = sampleX + offset[0]!;
        points[index * 3 + 1] = height;
        points[index * 3 + 2] = sampleZ + offset[1]!;
      });
      blendNormal(normal, normalOffset, getMovedNormal(points), blend);
    },
    shift: (x, z, out) => writeOffset(field, x, z, out)
  };
};

/** The vertex region of a grid area (cells), clamped to the map. */
export const toVertexRegion = (grid: GridSize, minX: number, minZ: number, maxX: number, maxZ: number): VertexRegion => ({
  maxX: Math.min(grid.cellsX, maxX), maxZ: Math.min(grid.cellsZ, maxZ),
  minX: Math.max(0, minX), minZ: Math.max(0, minZ)
});
