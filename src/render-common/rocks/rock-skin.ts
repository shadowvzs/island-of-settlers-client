import { smoothstep } from "../../shared/world/noise";
import { getRockSkinCover } from "../../shared/world/rock-cover";
import { toByte } from "../color";
import { normalize, type Vec3 } from "../props/mesh-builder";
import { computeVertexNormals, smoothNormals } from "./helpers";
import { buildRockLodIndices } from "./rock-lod";
import { MACRO_FORM_SKIN, packTintByte, type RockMeshData } from "./rock-mesh";
import { getGradient, getWetness, type RockTerrain } from "./rock-terrain";
import {
  getLooseCover,
  getOverhang,
  getUpward,
  getWallExposure,
  getWeathering
} from "./rock-zones";
import {
  createSkinFields,
  getFootFactor,
  getGullyShare,
  getStrataStep,
  getTalusOffset,
  getWallFactor,
  getWallForms,
  getWallLevel,
  type SkinFields,
  WALL_ROW,
  type WallForms
} from "./skin-relief";
import {
  type EdgeSplit,
  findLevelCrossing,
  type LevelPoint,
  listLevelCrossings,
  type SkinGrid,
  tessellateSkinGrid} from "./skin-tessellation";

/** Grid resolution of the skin (vertices per cell edge); gentle 2 x 2 blocks use half of it. */
const RESOLUTION = 4;
/** Whole-island quality choice: all neighbouring chunks use the same seam grid. */
export type RockSkinDetail = "full" | "coarse";
const COARSE_RESOLUTION = 2;
/** Slope (rise per run) from which a block keeps the full resolution (plates, walls). */
const DETAIL_SLOPE = 1.6;
/** Most splits of one base edge (rows on a near vertical face of about 5 units per base step). */
const SKIN_MAX_SPLIT = 12;
/** Weight below which a skin quad is left out (all four corners). */
const SKIN_MIN_WEIGHT = 0.05;
/** Lift of the skin over the ground where it is sculpted, and its sink depth at the fringe. */
const SKIN_LIFT = 0.02;
const FRINGE_SINK = 0.3;
const NO_WALL: WallForms = { joint: 0, offset: 0 };
/** Neighbour faces for area-weighted normals and two smoothing passes on chunk borders. */
const NORMAL_HALO = 2;

/** River beds the skin leaves open (cells from the bed): water runs in the carved channel. */
const RIVER_OPEN: [number, number] = [0.6, 1.6];

/** 0 in a river bed .. 1 clear of it (1 where the terrain has no water data). */
const getRiverOpening = (terrain: RockTerrain, x: number, z: number) =>
  smoothstep(RIVER_OPEN[0], RIVER_OPEN[1], terrain.river?.(x, z) ?? Infinity);

/** Broad face gradient spans small terrace shelves; flat summits and plateaus stay clear. */
const getFaceGradient = (terrain: RockTerrain, x: number, z: number, local: [number, number]) => {
  const highland = smoothstep(3.5, 5.5, terrain.height(x, z));
  if (highland === 0 || terrain.isBuildLand?.(x, z)) return local;
  const radius = 1.1;
  const dx = (terrain.height(x + radius, z) - terrain.height(x - radius, z)) / (radius * 2);
  const dz = (terrain.height(x, z + radius) - terrain.height(x, z - radius)) / (radius * 2);
  const blend = highland * 0.85;
  return [local[0] * (1 - blend) + dx * blend, local[1] * (1 - blend) + dz * blend] as [
    number,
    number
  ];
};

/** Placement and ground-contact cover: the original gameplay surface slope. */
export const getSkinWeight = (terrain: RockTerrain, x: number, z: number) =>
  getRockSkinCover(Math.hypot(...getGradient(terrain, x, z)), terrain.mountain(x, z)) *
  getRiverOpening(terrain, x, z);

/** Render cover includes narrow mountain shelves, while placement keeps its original contract. */
export const getRenderedSkinWeight = (terrain: RockTerrain, x: number, z: number) => {
  const local = getGradient(terrain, x, z);
  let slope = Math.hypot(...local);
  const highland = smoothstep(3.5, 5.5, terrain.height(x, z));
  if (highland > 0 && !terrain.isBuildLand?.(x, z)) {
    // A shelf between steep sides belongs to the same rock face. Its local slope may
    // vanish, but ending and sinking the skin there carves rectangular fringe wells.
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        const nearby = Math.hypot(...getGradient(terrain, x + dx * 0.75, z + dz * 0.75));
        slope = Math.max(slope, nearby * highland);
      }
    }
  }
  return getRockSkinCover(slope, terrain.mountain(x, z)) * getRiverOpening(terrain, x, z);
};

/** Mountain feet keep the cliff slab pass away too: those low separate plates looked glued
 * beside the massif. The talus pass owns fallen rock within this narrow foot margin.
 */
export const isMountainSkin = (terrain: RockTerrain, x: number, z: number) => {
  if (terrain.mountain(x, z) > 0.02) return true;
  const reach = 3;
  for (let direction = 0; direction < 8; direction += 1) {
    const angle = direction * Math.PI / 4;
    if (terrain.mountain(x + Math.cos(angle) * reach, z + Math.sin(angle) * reach) > 0.15) return true;
  }
  return false;
};

interface SkinVertex {
  /** 0 open plate .. 1 inside a fracture (deeper and wider between formations). */
  crack: number;
  /** 0 .. 1 on the talus apron below a wall. */
  foot: number;
  /** 0 .. 1 inside an erosion channel. */
  gully: number;
  /** 0 .. 1 inside a vertical joint between wall columns. */
  joint: number;
  position: Vec3;
  /** 0 slope .. 1 wall. */
  wall: number;
  weight: number;
}

/** Relief of the gentle skin: plates, strata steps, crack grooves and erosion channels. */
const getSlopeRelief = ([x, y, z]: Vec3, plateOffset: number, crack: number, gully: number) =>
  plateOffset + getStrataStep(y, x, z) - crack * 0.4 - gully * 0.25;

const sampleSkin = (terrain: RockTerrain, fields: SkinFields, x: number, z: number): SkinVertex => {
  const gradient = getGradient(terrain, x, z);
  const faceGradient = getFaceGradient(terrain, x, z, gradient);
  const slope = Math.hypot(...faceGradient);
  const weight = getRenderedSkinWeight(terrain, x, z);
  const normal = normalize([-faceGradient[0], 1, -faceGradient[1]]);
  const groundHeight = terrain.height(x, z);
  const wall = getWallFactor(slope);
  const ground: Vec3 = [x, groundHeight, z];
  const plate = fields.plates(ground);
  const crack =
    smoothstep(0.08 + plate.fracture * 0.17, 0.02, plate.edge) * plate.fracture * (1 - wall * 0.7);
  const gully = getGullyShare(fields.gullies, x, z);
  const forms = wall > 0 ? getWallForms(fields, x, ground[1], z) : NO_WALL;
  const foot = weight > 0 ? getFootFactor(terrain, x, z, gradient) : 0;
  const relief =
    getSlopeRelief(ground, plate.offset, crack, gully) * (1 - wall * 0.75) +
    forms.offset * wall +
    getTalusOffset(fields, x, z) * foot;
  /**
   * Fractures and channels cut in, but never below the ground (no holes in the skin). The fringe
   * sinks into the ground, so the skin ends along an organic seam with the terrain instead of the
   * stair-stepped outline of its last quads.
   */
  const lift = SKIN_LIFT - (SKIN_LIFT + FRINGE_SINK) * smoothstep(0.35, SKIN_MIN_WEIGHT, weight);
  const offset = Math.max(0.05, relief) * weight + lift;
  return {
    crack,
    foot,
    gully,
    joint: forms.joint,
    position: [x + normal[0] * offset, ground[1] + normal[1] * offset, z + normal[2] * offset],
    wall,
    weight
  };
};

/** The sculpted skin's surface point over (x, z) (the mountain builder embeds its masses in it). */
export const sampleSkinSurface = (
  terrain: RockTerrain,
  fields: SkinFields,
  x: number,
  z: number
): Vec3 => sampleSkin(terrain, fields, x, z).position;

/**
 * Zone masks of a skin vertex: fresh rock on walls and high steep faces, weathering in cracks,
 * joints, gullies and on shelves, gravel at the fringe, on the talus apron and in channel beds,
 * shade under lips.
 */
const getSkinMasks = (terrain: RockTerrain, vertex: SkinVertex, normal: Vec3) => {
  const [x, , z] = vertex.position;
  const upward = getUpward(normal[1]);
  const moisture = terrain.moisture(x, z);
  const joint = vertex.joint * vertex.wall;
  const cavity = Math.min(
    1,
    vertex.crack * 0.4 +
      vertex.gully * 0.25 +
      joint * 0.35 +
      getOverhang(normal[1]) * 0.45 +
      vertex.foot * 0.3 +
      smoothstep(0.6, 0.1, vertex.weight) * 0.3
  );
  const altitude = smoothstep(0.2, 0.9, terrain.mountain(x, z));
  const slopeExposure =
    smoothstep(0.3, 1, vertex.weight) * (0.35 + altitude * 0.65) * (1 - vertex.gully * 0.7);
  const exposure =
    Math.max(slopeExposure, getWallExposure(vertex.wall, altitude, vertex.joint)) *
    (1 - vertex.foot * 0.8);
  const contact = Math.max(smoothstep(0.7, 0.05, vertex.weight), vertex.foot);
  return {
    cavity,
    loose: Math.min(1, getLooseCover(contact, upward) + vertex.gully * upward * 0.4),
    moss:
      upward * 0.55 * moisture +
      vertex.crack * 0.25 +
      (vertex.gully * 0.25 + joint * 0.2) * moisture,
    weathering: getWeathering({ cavity, exposure, moisture, upward })
  };
};

/** Smallest gap of a split point to its edge's ends (keeps triangles from collapsing). */
const SPLIT_MARGIN = 0.02;

/**
 * Split points of a steep edge where it crosses the wall levels (rows of constant height);
 * gentle edges (rising less than a row) stay whole.
 */
const splitAtLevels = (terrain: RockTerrain, from: LevelPoint, to: LevelPoint): EdgeSplit[] => {
  const rise = terrain.height(to.x, to.z) - terrain.height(from.x, from.z);
  if (Math.abs(rise) <= WALL_ROW) return [];
  const levelAt = (t: number) => {
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    return getWallLevel(x, terrain.height(x, z), z);
  };
  return listLevelCrossings(from.level, to.level, SKIN_MAX_SPLIT)
    .map((level) => {
      const t = findLevelCrossing([from.level, to.level], level, levelAt);
      return { level, t: Math.min(1 - SPLIT_MARGIN, Math.max(SPLIT_MARGIN, t)) };
    })
    .sort((a, b) => a.t - b.t);
};

/**
 * Whether a 2 x 2 block keeps the full grid resolution: somewhere in it the slope reaches
 * DETAIL_SLOPE (below it the skin is faded and only its broad relief shows). Cached per block,
 * blocks outside the area included (they decide the shared sides).
 */
const createBlockDetail = (terrain: RockTerrain, grid: SkinGrid) => {
  const known = new Map<string, boolean>();
  return (blockColumn: number, blockRow: number) => {
    const key = `${blockColumn},${blockRow}`;
    const cached = known.get(key);
    if (cached !== undefined) return cached;
    let detailed = false;
    for (let index = 0; index < 9 && !detailed; index += 1) {
      const x = grid.x + (blockColumn * 2 + (index % 3)) * grid.step;
      const z = grid.z + (blockRow * 2 + Math.floor(index / 3)) * grid.step;
      detailed = Math.hypot(...getGradient(terrain, x, z)) >= DETAIL_SLOPE;
    }
    known.set(key, detailed);
    return detailed;
  };
};

/** The skin's adaptive tessellation: rock quads, strips up steep faces, coarse gentle blocks. */
const tessellateSkin = (
  terrain: RockTerrain,
  area: { x: number; z: number; size: number },
  detail: RockSkinDetail
) => {
  const resolution = detail === "coarse" ? COARSE_RESOLUTION : RESOLUTION;
  const columns = area.size * resolution;
  const grid: SkinGrid = { columns, rows: columns, step: 1 / resolution, x: area.x, z: area.z };
  const weights = new Float32Array((columns + 1) * (columns + 1));
  weights.forEach((_, index) => {
    const x = area.x + (index % (columns + 1)) * grid.step;
    const z = area.z + Math.floor(index / (columns + 1)) * grid.step;
    weights[index] = getRenderedSkinWeight(terrain, x, z);
  });
  const at = (column: number, row: number) => weights[row * (columns + 1) + column]!;
  return tessellateSkinGrid({
    grid,
    includes: (column, row) =>
      Math.max(
        at(column, row),
        at(column + 1, row),
        at(column, row + 1),
        at(column + 1, row + 1)
      ) >= SKIN_MIN_WEIGHT,
    isDetailed: createBlockDetail(terrain, grid),
    level: (x, z) => getWallLevel(x, terrain.height(x, z), z),
    split: (from, to) => splitAtLevels(terrain, from, to)
  });
};

const createMeshData = (count: number, indices: number[]): RockMeshData => ({
  extra: new Uint8Array(count * 4),
  indices: Uint32Array.from(indices),
  mask: new Uint8Array(count * 4),
  normals: new Float32Array(count * 3),
  positions: new Float32Array(count * 3),
  triangles: indices.length / 3,
  vertexCount: count
});

/**
 * Sculpted rock skin over the rocky mountain slopes of one area: an adaptively split grid (rows
 * up steep faces) lifted off the ground by the plate, strata and crack functions on slopes and by
 * buttresses, columns and strata beds on walls, faded out where the slope stops being rock.
 * Same vertex format as the rock meshes, so the rock material draws it.
 */
export const buildRockSkin = (
  terrain: RockTerrain,
  area: { x: number; z: number; size: number },
  seed: number,
  tint: (x: number, z: number) => number,
  detail: RockSkinDetail = "full"
): RockMeshData | null => {
  // Keep the halo aligned to the global half-cell blocks, so neighbouring chunks tessellate
  // the same faces. Only the normal calculation uses it; emitted triangles stay in the area.
  const halo = detail === "coarse" ? NORMAL_HALO * 2 : NORMAL_HALO;
  const { indices, points } = tessellateSkin(terrain, {
    size: area.size + halo * 2,
    x: area.x - halo,
    z: area.z - halo
  }, detail);
  if (indices.length === 0) return null;
  const fields = createSkinFields(seed);
  const vertices: SkinVertex[] = [];
  for (let index = 0; index < points.length; index += 2) {
    vertices.push(sampleSkin(terrain, fields, points[index]!, points[index + 1]!));
  }
  const positions = Float32Array.from(vertices.flatMap((vertex) => vertex.position));
  const smooth = smoothNormals(computeVertexNormals(positions, indices), indices);
  const retained: number[] = [];
  const remapped: number[] = [];
  const known = new Map<number, number>();
  const inside = (vertex: number) => {
    const x = points[vertex * 2]!;
    const z = points[vertex * 2 + 1]!;
    return x >= area.x && x <= area.x + area.size && z >= area.z && z <= area.z + area.size;
  };
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = indices.slice(offset, offset + 3);
    if (!triangle.every(inside)) continue;
    for (const vertex of triangle) {
      let target = known.get(vertex);
      if (target === undefined) {
        target = retained.length;
        known.set(vertex, target);
        retained.push(vertex);
      }
      remapped.push(target);
    }
  }
  if (remapped.length === 0) return null;
  const data = createMeshData(retained.length, remapped);
  retained.forEach((source, index) => {
    const vertex = vertices[source]!;
    data.positions.set(vertex.position, index * 3);
    const [x, , z] = vertex.position;
    const normal: Vec3 = [smooth[source * 3]!, smooth[source * 3 + 1]!, smooth[source * 3 + 2]!];
    const masks = getSkinMasks(terrain, vertex, normal);
    data.normals.set(normal, index * 3);
    data.mask.set(
      [
        packTintByte(tint(x, z) * 0.5 + 0.5, false),
        toByte(masks.moss),
        toByte(masks.loose),
        toByte(masks.cavity)
      ],
      index * 4
    );
    data.extra.set(
      [
        MACRO_FORM_SKIN,
        toByte(terrain.visibility(x, z)),
        toByte(masks.weathering),
        toByte(getWetness(terrain, x, z))
      ],
      index * 4
    );
  });
  data.lodIndices = buildRockLodIndices(data);
  return data;
};
