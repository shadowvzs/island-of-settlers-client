import { MATERIAL, type WorldData } from "../../../shared/world/world-data";
import { getSlopeAt, type HabitatScore,toPoint } from "./critter-habitats";
import { type CritterTerrain,getMaterialShare, getSandShare } from "./critter-terrain";

/** Fresh water (a river or a pool above the sea), deep enough for a frog to dive into. */
const isFreshWater = (world: WorldData, vertex: number) =>
  world.waterDepth[vertex]! > 0.06 && world.waterSurface[vertex]! > world.seaLevel + 0.1;

/** A vertex and its neighbours within `reach` vertices: does any satisfy `test`? */
const hasNeighbour = (
  world: WorldData,
  vertex: number,
  reach: number,
  test: (neighbour: number) => boolean
) => {
  const stride = world.cellsX + 1;
  const { x, z } = toPoint(world, vertex);
  for (let dz = -reach; dz <= reach; dz += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const nx = Math.min(world.cellsX, Math.max(0, x + dx));
      const nz = Math.min(world.cellsZ, Math.max(0, z + dz));
      if (test(nz * stride + nx)) return true;
    }
  }
  return false;
};

const isDry = (world: WorldData, vertex: number) => world.waterDepth[vertex]! <= 0.01;

/** Meadows and forest edges with grass (hedgehogs): gentle, dry, a few trees around at most. */
export const scoreMeadowEdge: HabitatScore = (terrain: CritterTerrain, vertex) => {
  const { world } = terrain;
  if (!isDry(world, vertex) || getSlopeAt(world, vertex) > 0.4) return 0;
  const grass =
    getMaterialShare(world, vertex, MATERIAL.grass) +
    getMaterialShare(world, vertex, MATERIAL.lushGrass);
  if (grass < 0.45) return 0;
  const { x, z } = toPoint(world, vertex);
  const forest = terrain.forest(x, z);
  if (forest > 0.5) return 0;
  return forest > 0.05 ? 1 : 0.5;
};

/** River and pond banks (frogs): dry ground right beside fresh water, gentle. */
export const scoreFrogBank: HabitatScore = ({ world }, vertex) => {
  if (!isDry(world, vertex) || getSlopeAt(world, vertex) > 0.5) return 0;
  return hasNeighbour(world, vertex, 1, (next) => isFreshWater(world, next)) ? 1 : 0;
};

/** Sand at the sea's water line (crabs): not at a river mouth. */
export const scoreCrabBeach: HabitatScore = ({ world }, vertex) => {
  if (!isDry(world, vertex) || getSandShare(world, vertex) < 0.5) return 0;
  const coast = world.coastDistance[vertex]!;
  if (coast > 2.5 || world.riverDistance[vertex]! < 3) return 0;
  return 1;
};

/**
 * Coastal rocks and quiet beaches at the water's edge (seals haul out): stony shore best, sand
 * less, never at a river mouth or on a steep face.
 */
export const scoreSealShore: HabitatScore = ({ world }, vertex) => {
  if (world.waterDepth[vertex]! > 0.04 || world.riverDistance[vertex]! < 5) return 0;
  const coast = world.coastDistance[vertex]!;
  if (coast > 1.6 || coast < -0.5 || getSlopeAt(world, vertex) > 0.6) return 0;
  if (!hasNeighbour(world, vertex, 2, next => world.waterDepth[next]! > .12)) return 0;
  const stone =
    getMaterialShare(world, vertex, MATERIAL.rock) +
    getMaterialShare(world, vertex, MATERIAL.gravel);
  if (stone > 0.25) return 1;
  return getSandShare(world, vertex) > 0.5 ? 0.35 : 0;
};

/** Calm fresh water (dragonflies): the still-water field, pools and slow rivers. */
export const scoreStillWater: HabitatScore = ({ still, world }, vertex) => {
  if (world.waterDepth[vertex]! < 0.05 || world.waterDepth[vertex]! > 1.2) return 0;
  return still[vertex]! < 0.4 ? 0 : still[vertex]!;
};
