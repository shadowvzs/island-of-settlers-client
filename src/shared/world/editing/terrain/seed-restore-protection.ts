import { banditCampPlan } from "../../../../render-common/buildings/bandit-camp-plan";
import { getBuildingDefinition } from "../../../../render-common/buildings/building-catalog";
import type { CellRegion } from "../../grid-geometry";
import type { WorldData } from "../../world-data";
import type { TerrainEditState } from "./terrain-edit-state";
import { getStampBounds } from "./terrain-stamps";

/** Protect complete source geometry and cubic interpolation neighbourhoods, including editor drafts. */
export const seedRestoreProtectedVertices = (world: WorldData, state: TerrainEditState, region: CellRegion) => {
  const protectedVertices = new Set<number>(), stride = world.cellsX + 1;
  const rectangle = (left: number, top: number, right: number, bottom: number, halo = 3) => {
    if (right + halo < region.minX || left - halo > region.maxX + 1 ||
      bottom + halo < region.minZ || top - halo > region.maxZ + 1) return;
    for (let z = Math.max(0, Math.floor(top - halo)); z <= Math.min(world.cellsZ, Math.ceil(bottom + halo)); z++)
      for (let x = Math.max(0, Math.floor(left - halo)); x <= Math.min(world.cellsX, Math.ceil(right + halo)); x++)
        protectedVertices.add(z * stride + x);
  };
  const plot = (entry: { x: number; z: number; rotation: number }, cells: readonly number[]) => {
    const width = cells[entry.rotation % 2 ? 1 : 0]!, depth = cells[entry.rotation % 2 ? 0 : 1]!;
    rectangle(entry.x - width / 2, entry.z - depth / 2, entry.x + width / 2, entry.z + depth / 2, 4);
  };
  const scenario = world.scenario;
  if (scenario?.headquarters) plot(scenario.headquarters, getBuildingDefinition(0).gridFootprint);
  if (scenario?.harbourPlot) plot(scenario.harbourPlot, getBuildingDefinition(39).gridFootprint);
  for (const building of scenario?.buildings ?? []) plot(building, building.bandit === undefined ?
    getBuildingDefinition(building.type).gridFootprint : banditCampPlan(building.bandit).cells);
  for (const road of scenario?.roads ?? []) rectangle(Math.min(road.start.x, road.end.x),
    Math.min(road.start.z, road.end.z), Math.max(road.start.x, road.end.x), Math.max(road.start.z, road.end.z));
  for (const unit of scenario?.units ?? []) for (const point of [unit, ...unit.patrol ?? []])
    rectangle(point.x, point.z, point.x, point.z);
  for (const source of [...world.colonyStoneDeposits ?? [], ...scenario?.marbleDeposits ?? []])
    rectangle(source.x - 1, source.z - 1, source.x + 1, source.z + 1);
  for (let z = Math.max(0, region.minZ - 3); z <= Math.min(world.cellsZ - 1, region.maxZ + 3); z++)
    for (let x = Math.max(0, region.minX - 3); x <= Math.min(world.cellsX - 1, region.maxX + 3); x++)
      if (world.mineZone[z * world.cellsX + x] || world.settlementGroundClearance?.[z * world.cellsX + x])
        rectangle(x, z, x + 1, z + 1);
  for (const river of [...world.authoredRivers ?? [], ...world.generatedRivers ?? []]) for (const patch of river.patches) {
    const x = patch.vertex % stride, z = Math.floor(patch.vertex / stride);
    rectangle(x, z, x, z);
  }
  // Authored stamp identities survive unchanged; only generated or already baked terrain is eligible.
  for (const stamp of state.stamps) {
    const bounds = getStampBounds(stamp);
    rectangle(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ);
  }
  return protectedVertices;
};
