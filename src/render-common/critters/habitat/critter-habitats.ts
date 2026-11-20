import { getVertexSlope } from "../../../shared/world/grid-geometry";
import type { WorldData } from "../../../shared/world/world-data";
import { type CritterTerrain,getSandShare } from "./critter-terrain";

/**
 * Habitat scores per vertex (0 unsuitable .. 1 ideal) of the decorative critters' homes. Each
 * critter colony picks its sites from one of them (critter-sites.ts).
 */
export type HabitatScore = (terrain: CritterTerrain, vertex: number) => number;

const isRiverWater = (world: WorldData, vertex: number) =>
  world.riverDistance[vertex]! <= 1.5 && world.waterSurface[vertex]! > world.seaLevel + 0.1;

/** Smallest water depth of a vertex and its 8 neighbours (room to swim around). */
const getOpenDepth = (world: WorldData, vertex: number) => {
  const stride = world.cellsX + 1;
  const x = vertex % stride;
  const z = Math.floor(vertex / stride);
  let shallowest = Infinity;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = Math.min(world.cellsX, Math.max(0, x + dx));
      const nz = Math.min(world.cellsZ, Math.max(0, z + dz));
      shallowest = Math.min(shallowest, world.waterDepth[nz * stride + nx]!);
    }
  }
  return shallowest;
};

/** Calm fresh water with room around: slow river stretches, settled pools (ducks). */
export const scoreCalmWater: HabitatScore = ({ still, world }, vertex) => {
  if (still[vertex]! < 0.45 || world.waterDepth[vertex]! < 0.2) return 0;
  return getOpenDepth(world, vertex) > 0.08 ? still[vertex]! : 0;
};

/** Shallow water at a bank, calm rivers best, sea shallows too (wading herons). */
export const scoreShallows: HabitatScore = ({ still, world }, vertex) => {
  const depth = world.waterDepth[vertex]!;
  if (depth < 0.04 || depth > 0.24) return 0;
  if (world.coastDistance[vertex]! < -2.5) return 0;
  const river = isRiverWater(world, vertex);
  return river ? 0.45 + 0.55 * still[vertex]! : 0.35;
};

/** Sandy sea beach a few cells from the water line (gulls). */
export const scoreBeach: HabitatScore = ({ world }, vertex) => {
  if (world.waterDepth[vertex]! > 0.01) return 0;
  const coast = world.coastDistance[vertex]!;
  if (coast > 4 || world.riverDistance[vertex]! < 2.5) return 0;
  return getSandShare(world, vertex) > 0.45 ? 1 : 0;
};

/** River water deep enough for trout to leap from. */
export const scoreRiverFish: HabitatScore = ({ world }, vertex) =>
  world.waterDepth[vertex]! >= 0.25 && isRiverWater(world, vertex) ? 1 : 0;

/** Open sea a few cells off the shore (mackerel leaping). */
export const scoreSeaFish: HabitatScore = ({ world }, vertex) => {
  if (world.waterDepth[vertex]! < 0.6 || world.riverDistance[vertex]! < 3) return 0;
  const coast = world.coastDistance[vertex]!;
  return coast <= -2 && coast >= -9 ? 1 : 0;
};

/** World point of a vertex. */
export const toPoint = (world: WorldData, vertex: number) => ({
  x: vertex % (world.cellsX + 1),
  z: Math.floor(vertex / (world.cellsX + 1))
});

/** Ground slope (rise per run) at a vertex. */
export const getSlopeAt = (world: WorldData, vertex: number) => {
  const { x, z } = toPoint(world, vertex);
  return getVertexSlope(world, world.heights, x, z);
};

/** Dry, not steep ground (a land animal's den or day bed). */
const isDryFlat = (world: WorldData, vertex: number) =>
  world.waterDepth[vertex]! <= 0.01 && getSlopeAt(world, vertex) < 0.45;

/** Forest edges and small woods next to meadows (fox). */
export const scoreForestEdge: HabitatScore = (terrain, vertex) => {
  if (!isDryFlat(terrain.world, vertex)) return 0;
  const { x, z } = toPoint(terrain.world, vertex);
  const forest = terrain.forest(x, z);
  if (forest < 0.15 || forest > 0.7) return 0;
  return 1 - Math.abs(forest - 0.42) * 2;
};

/**
 * Open woods with glades (boars root among the trees; the closed canopy would hide them from
 * the camera, so the densest woods score low).
 */
export const scoreOpenWoods: HabitatScore = (terrain, vertex) => {
  if (!isDryFlat(terrain.world, vertex)) return 0;
  const { x, z } = toPoint(terrain.world, vertex);
  const forest = terrain.forest(x, z);
  if (forest < 0.3 || forest > 0.72) return 0;
  return 1 - Math.abs(forest - 0.48) * 2;
};

/** Forest near the mountains (wolves, the bear). */
export const scoreMountainForest: HabitatScore = (terrain, vertex) => {
  if (!isDryFlat(terrain.world, vertex)) return 0;
  const { x, z } = toPoint(terrain.world, vertex);
  const forest = terrain.forest(x, z);
  const rocky = terrain.rocky(x, z);
  if (forest < 0.3 || rocky < 0.12) return 0;
  return Math.min(1, forest * 0.6 + rocky);
};

/** Any wood with trees to climb (squirrels). */
export const scoreWoods: HabitatScore = (terrain, vertex) => {
  if (!isDryFlat(terrain.world, vertex)) return 0;
  const { x, z } = toPoint(terrain.world, vertex);
  return terrain.forest(x, z) < 0.35 ? 0 : 1;
};
