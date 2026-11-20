import { displayFogAt } from "../../shared/world/fog-display";
import { FOG, ORE, type WorldData } from "../../shared/world/world-data";

/** Below this zoom the mine outlines are not drawn (a cell diamond is 64 px wide at zoom 1). */
export const MIN_SPOT_ZOOM = 0.55;
export interface ViewBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export const getBuildViewBounds = (outline: readonly { x: number; z: number }[]): ViewBounds => ({
  minX: Math.min(...outline.map((point) => point.x)),
  maxX: Math.max(...outline.map((point) => point.x)),
  minZ: Math.min(...outline.map((point) => point.z)),
  maxZ: Math.max(...outline.map((point) => point.z))
});
/** The surveyed, explored ore left in a cell (null: none or unknown to the player). */
const knownOreAt = (world: WorldData, cell: number) => {
  if (displayFogAt(world, cell) === FOG.hidden || !(world.oreAmount[cell]! > 0)) return null;
  const zone = world.mineZones[world.mineZone[cell]! - 1];
  return zone?.surveyed && zone.ore !== ORE.none ? zone.ore : null;
};

/** Slot filtering must never reveal an unsurveyed mineral through type-specific placement checks. */
export const hasKnownMineDeposit = (
  world: WorldData,
  typeId: number,
  plot: { x: number; z: number; width: number; depth: number }
) => {
  const required = [ORE.granite, ORE.coal, ORE.iron, ORE.gold][typeId - 10];
  if (required === undefined) return false;
  for (let z = plot.z - plot.depth / 2; z < plot.z + plot.depth / 2; z++) {
    for (let x = plot.x - plot.width / 2; x < plot.x + plot.width / 2; x++) {
      if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) continue;
      if (knownOreAt(world, z * world.cellsX + x) === required) return true;
    }
  }
  return false;
};
