import { type CellRegion,getVertexSlope } from "../../grid-geometry";
import { readSplatWeights, writeSplatWeights } from "../../ground-buffer";
import { smoothstep } from "../../noise";
import { MATERIAL, MATERIAL_COUNT, type WorldData } from "../../world-data";
import { blendTowardMaterial } from "../ground-paint";
import { getMountainShelfShare } from "./mountain-vegetation";
import type { TerrainEditState } from "./terrain-edit-state";
import { type LakeInfo, type LakeShaping,measureLakes, shapeLakes } from "./terrain-lakes";
import { getTotalRing, getTotalRise } from "./terrain-stamps";

/** Share of the apron's open ground (not rock or snow) turned to mine gravel. */
const RING_GROUND = 1;
/** Ground the apron keeps: rock faces and snow. */
const KEPT_BY_APRON: readonly number[] = [MATERIAL.mine, MATERIAL.rock, MATERIAL.snow];
/** Share of a lake bed and of its dry bank turned to sand. */
const LAKE_SAND = { bank: 0.6, bed: 0.85 } as const;

/** Splat scratch (no allocation per vertex). */
const weights = new Float32Array(MATERIAL_COUNT);

/**
 * Raised ground turns to rock on steep faces and high up, to snow above the snow line (the
 * generator's rules).
 */
const applyRiseGround = (world: WorldData, vertex: number, rise: number) => {
  const stride = world.cellsX + 1;
  const influence = smoothstep(0, 0.4, rise);
  const height = world.heights[vertex]!;
  const slope = getVertexSlope(world, world.heights, vertex % stride, Math.floor(vertex / stride));
  const snow = smoothstep(7, 7.8, height);
  const rock = Math.min(1, smoothstep(0.75, 1.2, slope) + smoothstep(5, 7, height) * 0.55);
  blendTowardMaterial(weights, MATERIAL.rock, rock * (1 - snow * 0.7) * influence);
  blendTowardMaterial(weights, MATERIAL.snow, snow * influence);
};

/**
 * The apron: open ground between and around the stamped rocks (grass, soil, gravel) turns to
 * mine gravel by its share, rock faces and snow stay (the generator's apron rule), so the rock
 * contact band finds no green ground there to turn into soil.
 */
const shiftOpenToMine = (share: number) => {
  if (share <= 0) return;
  let moved = 0;
  for (let material = 0; material < MATERIAL_COUNT; material += 1) {
    if (KEPT_BY_APRON.includes(material)) continue;
    moved += weights[material]! * share;
    weights[material] = weights[material]! * (1 - share);
  }
  weights[MATERIAL.mine] = weights[MATERIAL.mine]! + moved;
};

/**
 * Ground of a vertex from its base: the rise's rock and snow, the apron's mine gravel, a
 * lake's sandy bed and bank.
 */
const deriveSplat = (
  world: WorldData,
  state: TerrainEditState,
  vertex: number,
  lake: LakeShaping
) => {
  readSplatWeights(state.base!.splat, vertex, weights);
  const rise = state.rise![vertex]!;
  if (rise > 0) applyRiseGround(world, vertex, rise);
  const x = vertex % (world.cellsX + 1);
  const z = Math.floor(vertex / (world.cellsX + 1));
  const shelf = getMountainShelfShare(state.stamps, x, z, world.heights[vertex]!,
    getVertexSlope(world, world.heights, x, z));
  shiftOpenToMine(state.ring![vertex]! * RING_GROUND * (1 - shelf));
  const sand = lake.surface === null ? lake.bank * LAKE_SAND.bank : LAKE_SAND.bed;
  if (sand > 0) blendTowardMaterial(weights, MATERIAL.sand, sand);
  writeSplatWeights(world.splat, vertex, weights);
};

/** Water over a vertex: a lake's surface, else the original surface (sea, river). */
const applyWater = (
  world: WorldData,
  state: TerrainEditState,
  vertex: number,
  lake: LakeShaping
) => {
  const surface = lake.surface ?? state.base!.waterSurface[vertex]!;
  const depth = Math.max(0, surface - world.heights[vertex]!);
  const oldDepth = world.waterDepth[vertex]!;
  const changed = depth > 0 !== oldDepth > 0 ||
    ((depth > 0 || oldDepth > 0) &&
      (Math.abs(depth - oldDepth) > 0.00001 || Math.abs(surface - world.waterSurface[vertex]!) > 0.00001));
  world.waterSurface[vertex] = surface;
  world.waterDepth[vertex] = depth;
  world.lakeWater![vertex] = lake.isLake ? 1 : 0;
  return changed;
};

/** What the vertex pass changed. */
export interface VertexPass {
  /** Vertices any stamp shapes now or shaped before. */
  vertices: number[];
  /** Water appeared or went somewhere (lakes, islets). */
  waterChanged: boolean;
}

/** Vertices of a cell region (its cells' corners). */
export const toVertexBounds = (cells: CellRegion) => ({
  ...cells,
  maxX: cells.maxX + 1,
  maxZ: cells.maxZ + 1
});

/** Whether the vertex is shaped by a stamp now or was before (else it keeps its edits). */
const isShaped = (
  state: TerrainEditState,
  vertex: number,
  rise: number,
  ring: number,
  lake: LakeShaping
) =>
  rise > 0 ||
  ring > 0 ||
  lake.reached ||
  state.rise![vertex]! > 0 ||
  state.ring![vertex]! > 0 ||
  state.lake![vertex] === 1;

/** One vertex from the base and the stamps; false when no stamp shapes it (left as it is). */
const shapeVertex = (
  world: WorldData,
  state: TerrainEditState,
  lakes: readonly LakeInfo[],
  point: { vertex: number; x: number; z: number }
) => {
  const { vertex, x, z } = point;
  const rise = getTotalRise(state.stamps, x, z);
  const ring = getTotalRing(state.stamps, x, z);
  const lake = shapeLakes(lakes, x, z, state.base!.heights[vertex]! + rise);
  if (!isShaped(state, vertex, rise, ring, lake)) return null;
  world.heights[vertex] = lake.height;
  state.rise![vertex] = rise;
  state.ring![vertex] = ring;
  state.lake![vertex] = lake.reached ? 1 : 0;
  return lake;
};

/**
 * Heights, water and ground of the region's vertices from the base and every stamp: the merged
 * rise of the mountains, the lakes' beds and water, the ground they leave. Vertices no stamp
 * shapes (now or before) keep any other edits.
 */
export const shapeRegion = (
  world: WorldData,
  state: TerrainEditState,
  cells: CellRegion
): VertexPass => {
  const lakes = measureLakes(world, state.base!, state.stamps);
  const stride = world.cellsX + 1;
  const bounds = toVertexBounds(cells);
  const shaped: { lake: LakeShaping; vertex: number }[] = [];
  for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const vertex = z * stride + x;
      const lake = shapeVertex(world, state, lakes, { vertex, x, z });
      if (lake) shaped.push({ lake, vertex });
    }
  }
  let waterChanged = false;
  for (const { lake, vertex } of shaped) {
    waterChanged = applyWater(world, state, vertex, lake) || waterChanged;
    deriveSplat(world, state, vertex, lake);
  }
  return { vertices: shaped.map(({ vertex }) => vertex), waterChanged };
};
