import type { WorldData } from "../world/world-data";
import { isOwnBuilding } from "./settlement-home";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

interface LandmassLabels {
  revision: number;
  labels: Int32Array;
}

const cache = new WeakMap<WorldData, LandmassLabels>();

const labelsFor = (world: WorldData) => {
  const revision = world.terrainRevision ?? 0;
  const cached = cache.get(world);
  if (cached?.revision === revision) return cached.labels;
  const stride = world.cellsX + 1;
  const labels = new Int32Array(world.heights.length).fill(-1);
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== -1 || world.heights[start]! <= world.seaLevel) continue;
    const stack = [start];
    labels[start] = start;
    while (stack.length) {
      const index = stack.pop()!;
      const x = index % stride;
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < world.cellsX ? index + 1 : -1,
        index - stride,
        index + stride
      ];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || neighbour >= labels.length || labels[neighbour] !== -1 ||
          world.heights[neighbour]! <= world.seaLevel) continue;
        labels[neighbour] = start;
        stack.push(neighbour);
      }
    }
  }
  cache.set(world, { labels, revision });
  return labels;
};

/** Terrain landmass label at a point, or -1 over sea / outside the map. */
export const landmassLabelAt = (world: WorldData, point: SettlementPoint) => {
  const x = Math.floor(point.x);
  const z = Math.floor(point.z);
  if (x < 0 || z < 0 || x > world.cellsX || z > world.cellsZ) return -1;
  return labelsFor(world)[z * (world.cellsX + 1) + x] ?? -1;
};

/** Two places are on the same dry-terrain component (four-neighbour land, not road connectivity). */
export const sameLandmass = (world: WorldData, first: SettlementPoint, second: SettlementPoint) => {
  const a = landmassLabelAt(world, first);
  return a >= 0 && a === landmassLabelAt(world, second);
};

const isCurrentPlayerBuilding = (building: SettlementBuilding) =>
  isOwnBuilding(building);

/**
 * Whether the current player already has any building (planned or completed) on this landmass.
 * Another player's or a neutral compound's presence does not count.
 */
export const hasPlayerBuildingOnLandmass = (
  context: Pick<SettlementContext, "buildings" | "options">,
  point: SettlementPoint,
  excludeUid?: number
) => {
  const { world } = context.options;
  return context.buildings.some(building => building.uid !== excludeUid &&
    isCurrentPlayerBuilding(building) && sameLandmass(world, point, building));
};

/** Completion-time anchor rule: this harbour is the player's first building on its landmass. */
export const isFirstSettlementOnLandmass = (
  context: Pick<SettlementContext, "buildings" | "options">,
  building: SettlementBuilding
) => !hasPlayerBuildingOnLandmass(context, building, building.uid);
